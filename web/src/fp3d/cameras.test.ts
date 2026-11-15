// WS17 K1 (U8) acceptance: chase/overhead camera pose maths, smoothing, terrain clearance, mode
// switching (keys + button, reduced motion = cuts) and the clock shared with the HUD. CPU only:
// 3D visuals are judged by RR, not here.
import { afterEach, describe, expect, it } from 'vitest'
import designRaw from '../../../config/design.yaml'
import { hudConfigFromYaml } from '../hud/index'
import { missionClock } from '../state/mission'
import { all, byTag, installDom, type FakeNode } from '../ui/testing/dom'
import { t as copy } from '../ui/copy'
import { TOKENS } from '../ui/tokens'
import {
  applyPose,
  CameraRig,
  cameraParams,
  installCameras,
  mountCameraSwitch,
  PRESET_MODE,
  sceneClock,
  sharesMissionClock,
  type CameraHookFrame,
  type CameraParams,
} from './cameras'
import { blendPose, ChaseFollower, chasePose, easeInOut, firstPersonPose, fromScene, headingDir, overheadPose, smoothDamp, type CamPose, type Ground, type Vec3 } from './chase'
import { FP3D_CONFIG } from './config'
import { cameraPosition } from './terrain'

const P: CameraParams = cameraParams(designRaw, FP3D_CONFIG)
const anchor = { x: 1000, y: 2000, h: -2500 }
const flat: Ground = { anchor, heightAt: () => -2500 }
// rolling terrain with a steep 300 m ridge, for the clearance checks
const hilly: Ground = {
  anchor,
  heightAt: (x, y) => -2500 + 40 * Math.sin(x / 70) * Math.cos(y / 55) + 300 * Math.exp(-(((x - 1300) / 60) ** 2)),
}
const close = (a: Vec3, b: Vec3, eps = 1e-6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], -Math.log10(eps)))
const absHeight = (g: Ground, p: CamPose) => p.eye[1] + g.anchor.h
const groundUnder = (g: Ground, p: CamPose) => g.heightAt(...fromScene(g.anchor, p.eye))

describe('config (nothing new: design.yaml camera, tokens motion, hud eye height)', () => {
  it('reads the follow and overhead presets and the camera motion token', () => {
    const d = designRaw as { camera: { presets: { follow: Record<string, number> } } }
    expect(P.behindM).toBe(d.camera.presets.follow.behind_m)
    expect(P.aboveM).toBe(d.camera.presets.follow.above_m)
    expect(P.lookaheadM).toBe(d.camera.presets.follow.lookahead_m)
    expect(P.overheadM).toBeCloseTo(Math.hypot(P.behindM, P.aboveM), 9)
    expect(P.transitionMs).toBe(TOKENS.motion.cameraMs[0])
    expect(P.smoothS).toBe(TOKENS.motion.cameraMs[0] / 1000)
    expect(P.clearanceM).toBe(FP3D_CONFIG.eyeHeightM)
    expect(P.maxSpeed).toBe(Math.max(...FP3D_CONFIG.playbackSpeeds))
  })
  it('refuses an overhead preset that is not north up / straight down', () => {
    const d = structuredClone(designRaw) as { camera: { presets: { overhead: { pitch: number } } } }
    d.camera.presets.overhead.pitch = 30
    expect(() => cameraParams(d, FP3D_CONFIG)).toThrow(/overhead/)
  })
})

describe('critically damped smoothing', () => {
  it('converges without overshoot, at 30 and 60 fps alike', () => {
    for (const fps of [30, 60]) {
      let x = 0
      let v = 0
      let prev = -Infinity
      for (let i = 0; i < fps * 5 * P.smoothS; i++) {
        ;[x, v] = smoothDamp(x, 1, v, P.smoothS, 1 / fps)
        expect(x).toBeGreaterThanOrEqual(prev)
        expect(x).toBeLessThanOrEqual(1)
        prev = x
      }
      expect(x).toBeGreaterThan(0.99)
    }
  })
  it('one long frame never passes the target; zero dt changes nothing', () => {
    expect(smoothDamp(0, 1, 0, 1, 50)[0]).toBeLessThanOrEqual(1)
    expect(smoothDamp(0.3, 1, 0.2, 1, 0)).toEqual([0.3, 0.2])
  })
  it('ease-in-out: 0, ½, 1 and monotonic', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 12)
    expect(easeInOut(1)).toBe(1)
    for (let u = 0; u < 1; u += 0.05) expect(easeInOut(u + 0.05)).toBeGreaterThanOrEqual(easeInOut(u))
  })
})

describe('chase pose: offset behind and above the crew', () => {
  it('heading north on flat ground: eye behind (south) and above, looking ahead', () => {
    const p = chasePose(flat, 1100, 2100, headingDir(0), P)
    close(p.eye, [100, P.aboveM, -(100 - P.behindM)])
    close(p.target, [100, 0, -(100 + P.lookaheadM)])
    close(p.up, [0, 1, 0])
  })
  it('heading east: eye to the west of the crew', () => {
    const p = chasePose(flat, 1100, 2100, headingDir(90), P)
    close(p.eye, [100 - P.behindM, P.aboveM, -100])
    close(p.target, [100 + P.lookaheadM, 0, -100])
  })
  it('the follower settles on that pose for a constant heading', () => {
    const f = new ChaseFollower()
    let p: CamPose = f.update(hilly, 1100, 2100, 37, 1 / 60, P)
    for (let i = 0; i < 600; i++) p = f.update(hilly, 1100, 2100, 37, 1 / 60, P)
    const want = chasePose(hilly, 1100, 2100, headingDir(37), P)
    close(p.eye, want.eye, 1e-3)
    close(p.target, want.target, 1e-3)
  })
  it('a 90° turn swings the camera smoothly, converging within 5 smoothing times', () => {
    const f = new ChaseFollower()
    f.update(flat, 1100, 2100, 0, 1 / 60, P)
    f.update(flat, 1100, 2100, 90, 1 / 60, P)
    const d1 = f.direction!
    const a1 = (Math.atan2(d1[0], d1[1]) * 180) / Math.PI
    expect(a1).toBeGreaterThan(0)
    expect(a1).toBeLessThan(10) // one frame later: barely moved, no snap
    let prev = a1
    for (let i = 0; i < 60 * 5 * P.smoothS; i++) {
      f.update(flat, 1100, 2100, 90, 1 / 60, P)
      const d = f.direction!
      const a = (Math.atan2(d[0], d[1]) * 180) / Math.PI
      expect(a).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = a
    }
    expect(prev).toBeGreaterThan(89.5)
  })
  it('follows the crew position exactly (no positional lag at any playback speed)', () => {
    const f = new ChaseFollower()
    for (let i = 0; i < 50; i++) {
      const x = 1000 + 37 * i // a fast step every frame
      const p = f.update(flat, x, 2000, 90, 1 / 60, P)
      expect(p.eye[0] + anchor.x).toBeCloseTo(x - P.behindM, 6)
    }
  })
})

describe('terrain clearance: never below the drawn surface', () => {
  it('chase eye stays ≥ clearance above the terrain at sampled route points and headings', () => {
    const f = new ChaseFollower()
    let n = 0
    for (let k = 0; k < 2000; k++) {
      const x = 900 + 0.4 * k
      const y = 2000 + 60 * Math.sin(k / 90)
      const heading = (k * 7) % 360 // erratic headings stress the smoothing
      const p = f.update(hilly, x, y, heading, 1 / 60, P)
      expect(absHeight(hilly, p)).toBeGreaterThanOrEqual(groundUnder(hilly, p) + P.clearanceM - 1e-9)
      if (absHeight(hilly, p) - groundUnder(hilly, p) < P.aboveM) n++
    }
    // the ridge does force the floor at some samples (the test exercises the clamp)
    expect(n).toBeGreaterThan(0)
  })
  it('a ridge right behind the crew raises the eye above it', () => {
    const p = chasePose(hilly, 1300 + P.behindM, 2000, headingDir(90), P)
    expect(absHeight(hilly, p)).toBeGreaterThanOrEqual(hilly.heightAt(1300, 2000) + P.clearanceM)
  })
  it('overhead: straight above the crew, north up, clear of the ground', () => {
    const p = overheadPose(hilly, 1234, 1987, P.overheadM, P.clearanceM)
    close(p.eye, [234, hilly.heightAt(1234, 1987) + P.overheadM - anchor.h, 13])
    close(p.target, [234, hilly.heightAt(1234, 1987) - anchor.h, 13])
    close(p.up, [0, 0, -1])
  })
  it('first-person pose is WS8 terrain.ts cameraPosition at eye height (validated geometry)', () => {
    const terrainLike = { heightAt: hilly.heightAt } as Parameters<typeof cameraPosition>[0]
    const p = firstPersonPose(hilly, 1234, 1987, 30, FP3D_CONFIG.eyeHeightM)
    close(p.eye, cameraPosition(terrainLike, anchor, 1234, 1987, FP3D_CONFIG.eyeHeightM) as Vec3)
    expect(p.target[1]).toBe(p.eye[1])
  })
})

// ---- the rig ---------------------------------------------------------------------------------

const frame = (t: number, x = 1100, heading = 90, dtMs = 1000 / 60, g: Ground = hilly) => ({ t, pose: { x, y: 2000, headingDeg: heading }, ground: g, dtMs })

function run(rig: CameraRig, n: number, t0 = 0, g: Ground = hilly): { poses: (CamPose | null)[]; t: number } {
  const poses: (CamPose | null)[] = []
  let t = t0
  for (let i = 0; i < n; i++) {
    t += 0.001
    poses.push(rig.frame(frame(t, 1100 + i * 0.1, 90, 1000 / 60, g)))
  }
  return { poses, t }
}

describe('camera rig: mode switching', () => {
  it('starts in first person and leaves WS8’s camera untouched (null)', () => {
    const rig = new CameraRig(P, { reducedMotion: () => false })
    expect(rig.mode).toBe('firstPerson')
    expect(run(rig, 5).poses.every((p) => p === null)).toBe(true)
  })
  it('switching eases from the first-person pose to the chase pose over the camera-move time', () => {
    const rig = new CameraRig(P, { reducedMotion: () => false })
    let { t } = run(rig, 3)
    const fp = firstPersonPose(hilly, 1100 + 0.3, 2000, 90, P.eyeHeightM)
    rig.setMode('chase')
    expect(rig.transitioning).toBe(true)
    const first = rig.frame(frame((t += 0.001), 1100.3))!
    // first frame: still at (about) the first-person eye
    expect(Math.hypot(first.eye[0] - fp.eye[0], first.eye[1] - fp.eye[1], first.eye[2] - fp.eye[2])).toBeLessThan(1)
    const frames = Math.ceil(P.transitionMs / (1000 / 60)) + 1
    let p: CamPose | null = null
    for (let i = 0; i < frames; i++) {
      p = rig.frame(frame((t += 0.001), 1100.3))
      expect(absHeight(hilly, p!)).toBeGreaterThanOrEqual(groundUnder(hilly, p!) + P.clearanceM - 1e-9)
    }
    expect(rig.transitioning).toBe(false)
    const want = chasePose(hilly, 1100.3, 2000, headingDir(90), P)
    close(p!.eye, want.eye, 1e-3)
  })
  it('reduced motion: the switch is an instant cut', () => {
    const rig = new CameraRig(P, { reducedMotion: () => true })
    const { t } = run(rig, 3)
    rig.setMode('overhead')
    expect(rig.transitioning).toBe(false)
    const p = rig.frame(frame(t + 0.001, 1100.3))!
    close(p.eye, overheadPose(hilly, 1100.3, 2000, P.overheadM, P.clearanceM).eye)
  })
  it('back to first person: one exact first-person pose (up restored), then hands back to WS8', () => {
    const rig = new CameraRig(P, { reducedMotion: () => true })
    let { t } = run(rig, 2)
    rig.setMode('overhead')
    rig.frame(frame((t += 0.001)))
    rig.setMode('firstPerson')
    const p = rig.frame(frame((t += 0.001)))!
    close(p.eye, firstPersonPose(hilly, 1100, 2000, 90, P.eyeHeightM).eye)
    close(p.up, [0, 1, 0])
    expect(rig.frame(frame((t += 0.001)))).toBeNull()
  })
  it('any input cancels a camera move at once', () => {
    const rig = new CameraRig(P, { reducedMotion: () => false })
    let { t } = run(rig, 2)
    rig.setMode('overhead')
    rig.frame(frame((t += 0.001)))
    rig.cancel()
    const p = rig.frame(frame((t += 0.001)))!
    close(p.eye, overheadPose(hilly, 1100, 2000, P.overheadM, P.clearanceM).eye)
  })
  it('a clock seek cuts (no swing across the map)', () => {
    const rig = new CameraRig(P, { reducedMotion: () => false })
    let { t } = run(rig, 2)
    rig.setMode('chase')
    for (let i = 0; i < 200; i++) rig.frame(frame((t += 0.001), 1100, 0))
    // seek: t jumps 60 min, heading now 180
    const p = rig.frame(frame(t + 60, 1100, 180))!
    close(p.eye, chasePose(hilly, 1100, 2000, headingDir(180), P).eye, 1e-6)
  })
  it('cycle order is first person → chase → overhead → first person', () => {
    const rig = new CameraRig(P)
    const seen: string[] = []
    rig.onChange((m) => seen.push(m))
    rig.cycle()
    rig.cycle()
    rig.cycle()
    expect(seen).toEqual(['chase', 'overhead', 'firstPerson'])
  })
  it('blend keeps a unit up vector between overhead (north) and the other cameras (vertical)', () => {
    const a: CamPose = { eye: [0, 0, 0], target: [0, 0, -1], up: [0, 1, 0] }
    const b: CamPose = { eye: [0, 10, 0], target: [0, 0, 0], up: [0, 0, -1] }
    const m = blendPose(a, b, 0.5)
    expect(Math.hypot(...m.up)).toBeCloseTo(1, 12)
  })
})

// ---- keys, button, hook ------------------------------------------------------------------------

class FakeWin {
  private ls = new Map<string, Set<(e: Event) => void>>()
  addEventListener(k: string, f: (e: Event) => void) {
    if (!this.ls.has(k)) this.ls.set(k, new Set())
    this.ls.get(k)!.add(f)
  }
  removeEventListener(k: string, f: (e: Event) => void) {
    this.ls.get(k)?.delete(f)
  }
  shortcut(preset: number): boolean {
    const e = new CustomEvent('hl:shortcut', { detail: { action: 'camera', preset }, cancelable: true })
    for (const f of this.ls.get('hl:shortcut') ?? []) f(e)
    return e.defaultPrevented
  }
  count(k: string) {
    return this.ls.get(k)?.size ?? 0
  }
}

function fakeCamera() {
  const c = { pos: [0, 0, 0] as Vec3, upv: [0, 1, 0] as Vec3, look: null as Vec3 | null }
  return {
    c,
    cam: {
      position: { set: (x: number, y: number, z: number) => (c.pos = [x, y, z]) },
      up: { set: (x: number, y: number, z: number) => (c.upv = [x, y, z]) },
      lookAt: (x: number, y: number, z: number) => void (c.look = [x, y, z]),
    },
  }
}

describe('switch control: keys (shell camera presets) and buttons', () => {
  afterEach(() => missionClock.pause())

  it('preset keys 1 / 3 / 5 = overhead / first person / chase; 2 and 4 are left alone', () => {
    expect(PRESET_MODE).toEqual({ 1: 'overhead', 3: 'firstPerson', 5: 'chase' })
    const win = new FakeWin()
    const { container } = installDom()
    const hook = installCameras(FP3D_CONFIG, { win, doc: container.ownerDocument as never })
    expect(win.shortcut(5)).toBe(true)
    expect(hook.rig.mode).toBe('chase')
    expect(win.shortcut(1)).toBe(true)
    expect(hook.rig.mode).toBe('overhead')
    expect(win.shortcut(2)).toBe(false)
    expect(win.shortcut(4)).toBe(false)
    expect(hook.rig.mode).toBe('overhead')
    expect(win.shortcut(3)).toBe(true)
    expect(hook.rig.mode).toBe('firstPerson')
    hook.dispose()
    expect(win.count('hl:shortcut')).toBe(0)
  })

  it('three buttons with the copy labels, aria-pressed follows the mode, click switches', () => {
    const { container } = installDom()
    const rig = new CameraRig(P)
    const sw = mountCameraSwitch(container as unknown as HTMLElement, rig, container.ownerDocument as never)
    const buttons = byTag(container, 'button')
    expect(buttons.map((b) => b.textContent)).toEqual([copy('camera.firstPerson'), copy('camera.chase'), copy('camera.overhead')])
    const pressed = () => buttons.map((b) => b.getAttribute('aria-pressed'))
    expect(pressed()).toEqual(['true', 'false', 'false'])
    buttons[2].dispatch('click')
    expect(rig.mode).toBe('overhead')
    expect(pressed()).toEqual(['false', 'false', 'true'])
    sw.dispose()
    expect(all(container, () => true).length).toBe(0)
  })

  it('the hook mounts the switch in the scene root on the first frame and drives the camera', () => {
    const win = new FakeWin()
    const { container } = installDom()
    const hook = installCameras(FP3D_CONFIG, { win, doc: container.ownerDocument as never })
    const { c, cam } = fakeCamera()
    const f: CameraHookFrame = { t: 1, pose: { x: 1100, y: 2000, headingDeg: 90 }, terrain: hilly, anchor, dtMs: 16, root: container as unknown as HTMLElement }
    hook.onCamera(cam, f)
    expect(byTag(container, 'button').length).toBe(3)
    expect(c.look).toBeNull() // first person: WS8's camera untouched
    hook.rig.setMode('overhead')
    hook.rig.cancel()
    hook.onCamera(cam, { ...f, t: 1.001 })
    close(c.pos, overheadPose(hilly, 1100, 2000, P.overheadM, P.clearanceM).eye)
    close(c.upv, [0, 0, -1])
    // pointer input on the scene cancels a move (listener on the root)
    hook.rig.setMode('chase')
    expect(hook.rig.transitioning).toBe(true)
    ;(container as FakeNode).dispatch('pointerdown')
    expect(hook.rig.transitioning).toBe(false)
    hook.dispose()
    expect(byTag(container, 'button').length).toBe(0)
  })

  it('applyPose sets up before lookAt', () => {
    const order: string[] = []
    applyPose(
      { position: { set: () => order.push('pos') }, up: { set: () => order.push('up') }, lookAt: () => void order.push('look') },
      { eye: [0, 1, 0], target: [0, 0, 0], up: [0, 0, -1] },
    )
    expect(order).toEqual(['up', 'pos', 'look'])
  })
})

describe('same clock as the HUD (WS15 A3 mission clock)', () => {
  afterEach(() => {
    missionClock.pause()
    missionClock.seek(0)
  })
  it('the 3D scene and the HUD both resolve to the one mission clock', () => {
    expect(sharesMissionClock(FP3D_CONFIG)).toBe(true)
    // the HUD's rule (hud/hud.ts) with the HUD's own config
    const hud = hudConfigFromYaml()
    expect(sharesMissionClock(hud)).toBe(true)
    expect(sceneClock(FP3D_CONFIG)).toBe(missionClock)
    const hook = installCameras(FP3D_CONFIG, { win: new FakeWin() })
    expect(hook.clock).toBe(missionClock)
    hook.dispose()
  })
  it('a fresh mission clock starts playing (WS8’s autoplay); one paused mid-EVA stays put', () => {
    missionClock.pause()
    missionClock.seek(0)
    sceneClock(FP3D_CONFIG)
    expect(missionClock.playing).toBe(true)
    missionClock.pause()
    missionClock.seek(42)
    sceneClock(FP3D_CONFIG)
    expect(missionClock.playing).toBe(false)
    expect(missionClock.t).toBe(42)
  })
  it('another config gets a private clock, as before', () => {
    const c = sceneClock({ ...FP3D_CONFIG, evaMin: FP3D_CONFIG.evaMin + 1 })
    expect(c).not.toBe(missionClock)
  })
  it('the chase camera follows the crew at the mission clock time (seek on the shared clock moves it)', () => {
    const rig = new CameraRig(P, { reducedMotion: () => true })
    rig.setMode('chase')
    // a straight route east at 1 m per EVA minute, read at the mission clock's t
    const at = (t: number) => frame(t, 1000 + t, 90, 16, flat)
    missionClock.seek(10)
    const a = rig.frame(at(missionClock.t))!
    missionClock.seek(100)
    const b = rig.frame(at(missionClock.t))!
    expect(b.eye[0] - a.eye[0]).toBeCloseTo(90, 6)
  })
})
