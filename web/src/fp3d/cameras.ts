// WS17 (U8): camera switching for the 3D scene: first-person (WS8, F20, unchanged), chase and
// overhead. Pure controller (CameraRig) + a small DOM switch + the hook WS8's view calls each frame.
// No Three.js import: the camera is driven through a structural type, so this module stays small
// and testable; it loads only with the /hud3d slot (lazy), never on the 2D pages.
//
// Clock: the scene and the HUD read the same mission clock (WS15 A3, web/src/state/mission.ts);
// see sceneClock().
import designRaw from '../../../config/design.yaml'
import { missionClock } from '../state/mission'
import { PlaybackClock, type ClockDriver } from '../state/clock'
import { ui } from '../state/ui'
import { t as copy } from '../ui/copy'
import { TOKENS } from '../ui/tokens'
import { blendPose, ChaseFollower, easeInOut, firstPersonPose, floorAt, fromScene, overheadPose, type CamPose, type ChaseParams, type Ground } from './chase'
import type { Fp3dConfig } from './config'

export type CameraMode = 'firstPerson' | 'chase' | 'overhead'
/** Button and cycle order. */
export const CAMERA_MODES: readonly CameraMode[] = ['firstPerson', 'chase', 'overhead']

/**
 * DESIGN §4.4 / U16 camera presets (keys 1–5, announced by the shell as `hl:shortcut` camera
 * events) as they apply in the 3D scene: 1 overhead (north up, 0° tilt), 3 low altitude (near the
 * ground) = first person, 5 follow the crew = chase. 2 (isometric) and 4 (focus on selection) have
 * no 3D meaning and are left to other listeners.
 */
export const PRESET_MODE: Readonly<Record<number, CameraMode>> = { 1: 'overhead', 3: 'firstPerson', 5: 'chase' }

/** copy.json keys of the mode labels */
export const MODE_COPY = { firstPerson: 'camera.firstPerson', chase: 'camera.chase', overhead: 'camera.overhead' } as const

export interface CameraParams extends ChaseParams {
  /** overhead eye height above the crew's ground (m) */
  overheadM: number
  /** camera-switch transition (ms), DESIGN §3.4 camera move */
  transitionMs: number
  /** first-person eye height (m), WS8's (hud.yaml eye_height_m) */
  eyeHeightM: number
  /** fastest playback (EVA min per real min): a larger clock step in one frame is a seek */
  maxSpeed: number
}

type Obj = Record<string, unknown>
function num(root: unknown, path: string): number {
  let cur: unknown = root
  for (const k of path.split('.')) {
    if (!cur || typeof cur !== 'object' || !(k in (cur as Obj))) throw new Error(`config value missing: config/design.yaml: ${path}`)
    cur = (cur as Obj)[k]
  }
  if (typeof cur !== 'number' || !Number.isFinite(cur)) throw new Error(`config value not a number: config/design.yaml: ${path}`)
  return cur
}

/**
 * Camera parameters, all from config or tokens (nothing new):
 * - chase = design.yaml camera.presets.follow (behind_m, above_m, lookahead_m);
 * - overhead = presets.overhead (pitch 0 = straight down, bearing 0 = north up) at the chase
 *   camera's distance from the crew, √(behind² + above²);
 * - smoothing time and switch transition = tokens motion.cameraMs (lower end, 1.2 s);
 * - terrain clearance = the first-person eye height (hud.yaml eye_height_m): no camera sits lower
 *   over the ground than the validated first-person eye.
 */
export function cameraParams(design: unknown, fp: Pick<Fp3dConfig, 'eyeHeightM' | 'playbackSpeeds'>, cameraMs: readonly number[] = TOKENS.motion.cameraMs): CameraParams {
  const behindM = num(design, 'camera.presets.follow.behind_m')
  const aboveM = num(design, 'camera.presets.follow.above_m')
  if (num(design, 'camera.presets.overhead.pitch') !== 0 || num(design, 'camera.presets.overhead.bearing') !== 0) {
    throw new Error('config/design.yaml camera.presets.overhead: the 3D overhead camera is north up, straight down (pitch 0, bearing 0)')
  }
  return {
    behindM,
    aboveM,
    lookaheadM: num(design, 'camera.presets.follow.lookahead_m'),
    clearanceM: fp.eyeHeightM,
    smoothS: cameraMs[0] / 1000,
    overheadM: Math.hypot(behindM, aboveM),
    transitionMs: cameraMs[0],
    eyeHeightM: fp.eyeHeightM,
    maxSpeed: Math.max(...fp.playbackSpeeds),
  }
}

/** One frame of the scene, as WS8's view knows it (route pose at the clock time). */
export interface SceneFrame {
  /** EVA minute (the clock's t) */
  t: number
  pose: { x: number; y: number; headingDeg: number }
  ground: Ground
  /** real time since the last frame (ms) */
  dtMs: number
}

interface Transition {
  from: CamPose
  startMs: number | null
}

/**
 * The camera controller. frame() returns the pose to apply, or null when WS8's first-person camera
 * should be left exactly as WS8 set it (first-person mode, settled).
 */
export class CameraRig {
  readonly params: CameraParams
  private m: CameraMode = 'firstPerson'
  private readonly follower = new ChaseFollower()
  private last: CamPose | null = null
  private lastT = Number.NaN
  private trans: Transition | null = null
  private elapsedMs = 0
  /** first-person: one more pose to emit (restores the up vector after another mode) */
  private fpPending = false
  private readonly reduced: () => boolean
  private readonly listeners = new Set<(m: CameraMode) => void>()

  constructor(params: CameraParams, opts: { reducedMotion?: () => boolean } = {}) {
    this.params = params
    this.reduced = opts.reducedMotion ?? (() => ui.reducedMotion.peek())
  }

  get mode(): CameraMode {
    return this.m
  }

  get transitioning(): boolean {
    return this.trans !== null
  }

  onChange(fn: (m: CameraMode) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Switch camera: an eased move (DESIGN §3.4), or a cut under reduced motion. */
  setMode(m: CameraMode): void {
    if (m === this.m) return
    this.m = m
    if (m === 'chase') this.follower.reset()
    this.trans = this.last && !this.reduced() ? { from: this.last, startMs: null } : null
    this.fpPending = m === 'firstPerson'
    for (const fn of this.listeners) fn(m)
  }

  /** Next mode in CAMERA_MODES order (the switch button's cycle). */
  cycle(): void {
    this.setMode(CAMERA_MODES[(CAMERA_MODES.indexOf(this.m) + 1) % CAMERA_MODES.length])
  }

  /** Any input cancels a camera move at once (DESIGN §3.4): jump to its end. */
  cancel(): void {
    this.trans = null
  }

  private target(f: SceneFrame, dtS: number): CamPose {
    const p = this.params
    const { x, y, headingDeg } = f.pose
    if (this.m === 'chase') return this.follower.update(f.ground, x, y, headingDeg, dtS, p)
    if (this.m === 'overhead') return overheadPose(f.ground, x, y, p.overheadM, p.clearanceM)
    return firstPersonPose(f.ground, x, y, headingDeg, p.eyeHeightM)
  }

  frame(f: SceneFrame): CamPose | null {
    const p = this.params
    const dtMs = Math.max(0, f.dtMs)
    this.elapsedMs += dtMs
    // a clock step larger than the fastest playback can make in this frame is a seek: cut
    const seek = Number.isFinite(this.lastT) && Math.abs(f.t - this.lastT) > (p.maxSpeed * dtMs) / 60000 + 1e-9
    this.lastT = f.t
    if (seek) {
      this.follower.reset()
      this.trans = null
    }
    if (this.trans && this.reduced()) this.trans = null
    let pose = this.target(f, dtMs / 1000)
    if (this.trans) {
      this.trans.startMs ??= this.elapsedMs - dtMs
      const u = (this.elapsedMs - this.trans.startMs) / p.transitionMs
      if (u >= 1) this.trans = null
      else {
        pose = blendPose(this.trans.from, pose, easeInOut(u))
        // the straight blend may cut through a ridge: keep the clearance on the way
        const [ex, ey] = fromScene(f.ground.anchor, pose.eye)
        const minY = floorAt(f.ground, ex, ey, p.clearanceM) - f.ground.anchor.h
        if (pose.eye[1] < minY) pose = { ...pose, eye: [pose.eye[0], minY, pose.eye[2]] }
      }
    }
    if (this.m === 'firstPerson' && !this.trans) {
      if (!this.fpPending) {
        this.last = firstPersonPose(f.ground, f.pose.x, f.pose.y, f.pose.headingDeg, p.eyeHeightM)
        return null
      }
      this.fpPending = false
    }
    this.last = pose
    return pose
  }
}

/** The camera as WS8's view holds it (THREE.PerspectiveCamera satisfies this). */
export interface CameraLike {
  position: { set(x: number, y: number, z: number): unknown }
  up: { set(x: number, y: number, z: number): unknown }
  lookAt(x: number, y: number, z: number): void
}

export function applyPose(camera: CameraLike, p: CamPose): void {
  camera.up.set(...p.up)
  camera.position.set(...p.eye)
  camera.lookAt(...p.target)
}

/**
 * The clock the 3D scene runs on: the one mission clock (WS15 A3) whenever the scene's config
 * builds the same clock (crew.yaml eva_h, hud.yaml playback speeds), which is the HUD's own rule
 * (hud/hud.ts); a caller with another config gets a private clock, as before.
 */
export function sharesMissionClock(cfg: Pick<Fp3dConfig, 'evaMin' | 'playbackSpeeds' | 'defaultSpeed'>, clock: ClockDriver = missionClock): boolean {
  return clock.tMax === cfg.evaMin && clock.speeds.join() === cfg.playbackSpeeds.join() && cfg.playbackSpeeds.includes(cfg.defaultSpeed)
}

export function sceneClock(cfg: Pick<Fp3dConfig, 'evaMin' | 'playbackSpeeds' | 'defaultSpeed'>): ClockDriver {
  if (!sharesMissionClock(cfg)) {
    const c = new PlaybackClock(cfg.evaMin, cfg.playbackSpeeds, cfg.defaultSpeed)
    c.play()
    return c
  }
  // WS8's view played its own clock on mount; keep that first impression on a fresh clock only
  // (a clock paused mid-EVA on another view stays where the user left it)
  if (!missionClock.playing && missionClock.t === 0) missionClock.play()
  return missionClock
}

// ---- switch control (button group) -------------------------------------------------------------

interface DocLike {
  createElement(tag: string): HTMLElement
  createTextNode(text: string): Text
}

/**
 * Three toggle buttons (first person / chase / overhead), aria-pressed on the active one. Placed
 * in the scene's top-right corner, above the canvas, styled with tokens only.
 */
export function mountCameraSwitch(host: HTMLElement, rig: CameraRig, doc: DocLike = document): { el: HTMLElement; dispose(): void } {
  const el = doc.createElement('div')
  el.className = 'fp3d-cameras'
  el.setAttribute('role', 'group')
  el.setAttribute('aria-label', copy('shortcuts.cameraPresets'))
  el.style.cssText =
    'position:absolute;top:var(--space-2);right:var(--space-3);z-index:4;display:flex;gap:var(--space-1);font:var(--font-weight-label) var(--font-size-small)/var(--line-height-small) var(--font-text)'
  const buttons = new Map<CameraMode, HTMLElement>()
  const key = Object.fromEntries(Object.entries(PRESET_MODE).map(([k, m]) => [m, k])) as Record<CameraMode, string>
  for (const m of CAMERA_MODES) {
    const b = doc.createElement('button')
    b.setAttribute('type', 'button')
    b.className = 'fp3d-camera'
    b.setAttribute('data-mode', m)
    b.appendChild(doc.createTextNode(copy(MODE_COPY[m])))
    b.setAttribute('title', `${copy(MODE_COPY[m])} (${key[m]})`)
    b.style.cssText =
      'padding:var(--space-1) var(--space-2);border-radius:var(--radius-input);border:1px solid var(--color-card-border);background:var(--color-card);color:var(--color-text);cursor:pointer'
    b.addEventListener('click', () => rig.setMode(m))
    buttons.set(m, b)
    el.appendChild(b)
  }
  const sync = (cur: CameraMode) => {
    for (const [m, b] of buttons) {
      b.setAttribute('aria-pressed', String(m === cur))
      b.style.outline = m === cur ? '2px solid var(--color-select)' : 'none'
    }
  }
  sync(rig.mode)
  const off = rig.onChange(sync)
  host.appendChild(el)
  return {
    el,
    dispose() {
      off()
      el.remove()
    },
  }
}

// ---- the hook WS8's view calls ----------------------------------------------------------------

/** What WS8's frame loop passes to onCamera (view.ts after the first-person pose is set). */
export interface CameraHookFrame {
  t: number
  pose: { x: number; y: number; headingDeg: number }
  terrain: { heightAt(x: number, y: number): number }
  anchor: { x: number; y: number; h: number }
  dtMs: number
  /** the scene's root element (.fp3d), where the switch is mounted */
  root: HTMLElement
}

export interface CameraHook {
  /** the clock to give WS8's view (the shared mission clock) */
  clock: ClockDriver
  rig: CameraRig
  /** call each frame after WS8 sets the first-person camera, before rendering */
  onCamera(camera: CameraLike, f: CameraHookFrame): void
  dispose(): void
}

interface EventTargetLike {
  addEventListener(type: string, fn: (e: Event) => void, opts?: unknown): void
  removeEventListener(type: string, fn: (e: Event) => void, opts?: unknown): void
}

/**
 * Install the cameras for one mounted 3D view. Keys come through the shell's `hl:shortcut` camera
 * events (DESIGN §4.4 presets, PRESET_MODE); the switch is mounted on the first frame inside the
 * scene root, so a 2D fallback (which removes that root) is unchanged.
 */
export function installCameras(cfg: Fp3dConfig, opts: { win?: EventTargetLike; design?: unknown; doc?: DocLike } = {}): CameraHook {
  const win = opts.win ?? window
  const rig = new CameraRig(cameraParams(opts.design ?? designRaw, cfg))
  const clock = sceneClock(cfg)
  let switcher: { dispose(): void } | null = null
  let root: HTMLElement | null = null
  const onShortcut = (e: Event) => {
    const d = (e as CustomEvent<{ action?: string; preset?: number }>).detail
    if (d?.action !== 'camera' || typeof d.preset !== 'number') return
    const m = PRESET_MODE[d.preset]
    if (!m) return
    rig.setMode(m)
    e.preventDefault()
  }
  const onInput = () => rig.cancel()
  win.addEventListener('hl:shortcut', onShortcut)
  return {
    clock,
    rig,
    onCamera(camera, f) {
      if (!switcher) {
        root = f.root
        switcher = mountCameraSwitch(f.root, rig, opts.doc)
        for (const k of ['pointerdown', 'wheel', 'keydown']) f.root.addEventListener(k, onInput, { passive: true })
      }
      const p = rig.frame({ t: f.t, pose: f.pose, ground: { anchor: f.anchor, heightAt: (x, y) => f.terrain.heightAt(x, y) }, dtMs: f.dtMs })
      if (p) applyPose(camera, p)
    },
    dispose() {
      win.removeEventListener('hl:shortcut', onShortcut)
      if (root) for (const k of ['pointerdown', 'wheel', 'keydown']) root.removeEventListener(k, onInput)
      switcher?.dispose()
      switcher = null
    },
  }
}
