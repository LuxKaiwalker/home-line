// WS17 K2 (U8, D73) acceptance: the crew pair built in code. Positions follow the route at the
// mission clock (leader = WS8's route pose, the same position as the HUD), partner offset, terrain
// height, speed from the timeline (0 at stations), walk cycle (none under reduced motion), no
// texture images, disposal, and the mount helper on K1's onCamera hook. CPU only: how the figures
// look and move is judged by RR, never here.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as THREE from 'three'
import { parse } from 'yaml'
import { describe, expect, it, vi } from 'vitest'
import designRaw from '../../../config/design.yaml'
import { TOKENS } from '../ui/tokens'
import type { CameraHook } from './cameras'
import { FP3D_CONFIG } from './config'
import { arcAt, Crew, crewParams, crewPlacements, FIGURE, limbPose, speedAt, toScene, WalkCycle, type CrewParams } from './crew'
import { installCrew, type CrewSceneFrame } from './crewMount'
import { parseEqc } from './geo'
import { buildRoute, type RoutePath, type TimelineEvent } from './path'

const REPO = resolve(__dirname, '../../..')
const P: CrewParams = crewParams(designRaw, FP3D_CONFIG)
const eqc = parseEqc('+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs')
const deg = (m: number) => (m / 3396190) * (180 / Math.PI)
// pad -> S1 (100 m east in 10 min), dwell at S1 until 40, S1 -> pad side (50 m north, 5 min; per-vertex times)
const fc = {
  features: [
    { geometry: { type: 'LineString', coordinates: [[0, 0], [deg(100), 0]] }, properties: { from: 'pad', to: 'S1', t_start_min: 0, t_end_min: 10 } },
    {
      geometry: { type: 'LineString', coordinates: [[deg(100), 0], [deg(100), deg(20)], [deg(100), deg(50)]] },
      properties: { from: 'S1', to: 'pad', t_start_min: 40, t_end_min: 45, times_min: [40, 41, 45] },
    },
  ],
}
const route = buildRoute(fc, null, eqc, FP3D_CONFIG.lookAheadM)
const anchor = { x: 0, y: 0, h: -2500 }
const hills = { heightAt: (x: number, y: number) => -2500 + 3 * Math.sin(x / 7) + 2 * Math.cos(y / 5) }
const headingVec = (h: number) => [Math.sin((h * Math.PI) / 180), Math.cos((h * Math.PI) / 180)]

function realRoute(): RoutePath | null {
  const dir = [resolve(REPO, 'web/public/data'), resolve(REPO, 'web/public/data-dummy')].find((d) => existsSync(resolve(d, 'route_nom_104.geojson')))
  if (!dir) return null
  const site = parse(readFileSync(resolve(REPO, 'config/site.yaml'), 'utf8'))
  const tlPath = resolve(dir, 'timeline_nom_104.json')
  const tl = existsSync(tlPath) ? (JSON.parse(readFileSync(tlPath, 'utf8')) as TimelineEvent[]) : null
  return buildRoute(JSON.parse(readFileSync(resolve(dir, 'route_nom_104.geojson'), 'utf8')), tl, parseEqc(site.crs.analysis_proj), FP3D_CONFIG.lookAheadM)
}

describe('config (design.yaml 3d block, hud eye height; nothing new)', () => {
  it('two figures, partner gap = two ground rings side by side, scale from the 1.7 m eye', () => {
    expect(P.count).toBe((designRaw as { '3d': { crew_count: number } })['3d'].crew_count)
    expect(P.count).toBe(2)
    expect(P.ringRadiusM).toBe(1.5)
    expect(P.gapM).toBe(2 * P.ringRadiusM)
    expect(P.eyeHeightM).toBe(FP3D_CONFIG.eyeHeightM)
    expect(P.strideM).toBeCloseTo(FIGURE.strideOfEye * P.eyeHeightM, 9)
    expect(P.easeMs).toBe(TOKENS.motion.dataMs[0])
  })
  it('refuses a missing value', () => {
    expect(() => crewParams({ '3d': { crew_count: 2 } }, FP3D_CONFIG)).toThrow(/ground_ring_radius_m/)
  })
})

describe('positions follow the route at the mission clock', () => {
  it('leader = WS8 route pose (the camera and HUD position) at every clock time', () => {
    for (let t = -5; t <= 50; t += 0.1) {
      const [lead] = crewPlacements(route, t, P)
      const pose = route.poseAt(t)
      expect(lead.x).toBe(pose.x)
      expect(lead.y).toBe(pose.y)
      expect(lead.headingDeg).toBe(pose.headingDeg)
      expect(lead.dwellAt).toBe(pose.dwellAt)
    }
  })
  it('partner stays exactly one gap away, behind the leader, on the route where it can', () => {
    for (let t = -2; t <= 50; t += 0.25) {
      const [lead, mate] = crewPlacements(route, t, P)
      expect(Math.hypot(mate.x - lead.x, mate.y - lead.y)).toBeCloseTo(P.gapM, 6)
    }
    // behind the leader while walking a straight stretch (and before departure, at the pad)
    for (const t of [-2, 0, 1, 4.5, 9, 41.2, 43, 44.5]) {
      const [lead, mate] = crewPlacements(route, t, P)
      const [hx, hy] = headingVec(lead.headingDeg)
      expect((mate.x - lead.x) * hx + (mate.y - lead.y) * hy).toBeLessThan(0)
    }
    // mid first leg: on the route line (y = 0), 3 m west of the leader
    const [lead, mate] = crewPlacements(route, 5, P)
    expect(mate.y).toBeCloseTo(0, 6)
    expect(mate.x).toBeCloseTo(lead.x - P.gapM, 6)
    // partner faces the leader
    expect(mate.headingDeg).toBeCloseTo(90, 6)
  })
  it('both figures share the timeline speed', () => {
    for (const t of [5, 25, 40.5, 43]) {
      const c = crewPlacements(route, t, P)
      expect(c[1].speedMps).toBe(c[0].speedMps)
      expect(c[0].speedMps).toBe(speedAt(route, t))
    }
  })
  it('Crew.update places the figures in scene coordinates on the terrain', () => {
    const crew = new Crew(P, { reducedMotion: () => false })
    for (const t of [0, 3.3, 10, 25, 41.7, 45]) {
      const placed = crew.update({ t, dtMs: 16, route, terrain: hills, anchor })
      placed.forEach((p, k) => {
        const fig = crew.figures[k]
        const [sx, sy, sz] = toScene(anchor, p.x, p.y, hills.heightAt(p.x, p.y))
        expect(fig.root.position.x).toBeCloseTo(sx, 9)
        expect(fig.root.position.y).toBeCloseTo(sy, 9)
        expect(fig.root.position.z).toBeCloseTo(sz, 9)
        // facing: local -Z turned to the heading (clockwise from grid north; scene north = -Z)
        const fwd = new THREE.Vector3(0, 0, -1).applyEuler(fig.root.rotation)
        const [hx, hy] = headingVec(p.headingDeg)
        expect(fwd.x).toBeCloseTo(hx, 6)
        expect(-fwd.z).toBeCloseTo(hy, 6)
      })
    }
    crew.dispose()
  })
  it.skipIf(!realRoute())('real route nom_104: leader = route pose, partner gap kept, over the whole EVA', () => {
    const r = realRoute()!
    let n = 0
    for (let t = r.startMin; t <= r.endMin; t += 0.5) {
      const [lead, mate] = crewPlacements(r, t, P)
      const pose = r.poseAt(t)
      expect(lead.x).toBe(pose.x)
      expect(lead.y).toBe(pose.y)
      expect(Math.hypot(mate.x - lead.x, mate.y - lead.y)).toBeCloseTo(P.gapM, 6)
      n++
    }
    expect(n).toBeGreaterThan(100)
  })
})

describe('speed from the timeline', () => {
  it('0 at stations (dwell), before departure and after the return', () => {
    expect(route.poseAt(25).dwellAt).toBe('S1')
    for (const t of [10.5, 25, 39.9]) expect(speedAt(route, t)).toBe(0)
    expect(speedAt(route, -3)).toBe(0)
    expect(speedAt(route, 60)).toBe(0)
  })
  it('the leg speed while walking, per-vertex times included', () => {
    expect(speedAt(route, 5)).toBeCloseTo(100 / 600, 9) // 100 m in 10 min
    expect(speedAt(route, 40.5)).toBeCloseTo(20 / 60, 9) // 20 m in 1 min
    expect(speedAt(route, 43)).toBeCloseTo(30 / 240, 9) // 30 m in 4 min
  })
  it('arcAt matches the route position', () => {
    const leg = route.legs[0]
    expect(arcAt(leg, 5)).toBeCloseTo(50, 9)
    expect(arcAt(leg, -1)).toBe(0)
    expect(arcAt(leg, 99)).toBeCloseTo(leg.length, 9)
  })
  it.skipIf(!realRoute())('real route: 0 at every dwell, > 0 on every walked leg', () => {
    const r = realRoute()!
    for (let t = r.startMin; t <= r.endMin; t += 0.5) {
      const p = r.poseAt(t)
      if (p.dwellAt) expect(speedAt(r, t)).toBe(0)
    }
    for (const leg of r.legs) if (leg.length > 0 && leg.t1 > leg.t0) expect(speedAt(r, (leg.t0 + leg.t1) / 2)).toBeGreaterThan(0)
  })
})

describe('walk cycle', () => {
  it('advances with the walking speed in real time, stands still at 0', () => {
    const w = new WalkCycle()
    w.advance(1, 0.5, 1.4)
    expect(w.phase).toBeCloseTo((2 * Math.PI * 0.5) / 1.4, 9)
    const before = w.phase
    w.advance(0, 2, 1.4)
    expect(w.phase).toBe(before)
  })
  it('limbs swing while walking (legs opposite, arms against legs) and rest when standing', () => {
    const p = limbPose(Math.PI / 2, 1, false)
    expect(p.legL).toBeCloseTo(-p.legR, 9)
    expect(Math.abs(p.legL)).toBeGreaterThan(0.1)
    expect(Math.sign(p.armL)).toBe(-Math.sign(p.legL))
    expect(p.bob).toBeGreaterThan(0)
    const still = limbPose(Math.PI / 2, 0, false)
    expect([still.legL, still.legR, still.armL, still.armR, still.bob]).toEqual([0, 0, 0, 0, 0])
  })
  it('reduced motion: no bob, no limb swing', () => {
    const p = limbPose(1.1, 1, true)
    expect([p.legL, p.legR, p.armL, p.armR, p.bob]).toEqual([0, 0, 0, 0, 0])
    const crew = new Crew(P, { reducedMotion: () => true })
    for (let i = 0; i < 120; i++) crew.update({ t: 2 + i * 0.01, dtMs: 16, route, terrain: hills, anchor })
    for (const f of crew.figures) {
      expect(f.body.position.y).toBe(0)
      for (const limb of [...f.legs, ...f.arms]) expect(limb.rotation.x).toBe(0)
    }
    crew.dispose()
  })
  it('walks on legs, stands at stations, freezes while the clock is paused', () => {
    const crew = new Crew(P, { reducedMotion: () => false })
    let t = 2
    for (let i = 0; i < 120; i++) crew.update({ t: (t += 0.01), dtMs: 16, route, terrain: hills, anchor })
    expect(crew.amplitude).toBeGreaterThan(0.9)
    const ph = crew.cycle.phase
    expect(ph).toBeGreaterThan(0)
    // paused: same t, time passes -> nothing moves
    const legAngle = crew.figures[0].legs[0].rotation.x
    for (let i = 0; i < 30; i++) crew.update({ t, dtMs: 16, route, terrain: hills, anchor })
    expect(crew.cycle.phase).toBe(ph)
    expect(crew.figures[0].legs[0].rotation.x).toBe(legAngle)
    // at a station: the swing eases out to a standstill
    t = 20
    for (let i = 0; i < 300; i++) crew.update({ t: (t += 0.01), dtMs: 16, route, terrain: hills, anchor })
    expect(crew.amplitude).toBeLessThan(1e-3)
    for (const f of crew.figures) for (const limb of [...f.legs, ...f.arms]) expect(Math.abs(limb.rotation.x)).toBeLessThan(1e-3)
    // the partner is half a cycle out of step with the leader
    expect(crew.phaseOf(1) - crew.phaseOf(0)).toBeCloseTo(Math.PI, 9)
    crew.dispose()
  })
})

describe('figures built in code (D73): primitives, token colours, no textures, no markings', () => {
  const crew = new Crew(P, { reducedMotion: () => false })
  const meshes: THREE.Mesh[] = []
  crew.group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh)
  })
  it('two figures, each from capsules, boxes, spheres and cylinders only', () => {
    expect(crew.figures).toHaveLength(2)
    expect(meshes.length).toBeGreaterThan(10)
    for (const m of meshes) expect(['CapsuleGeometry', 'BoxGeometry', 'SphereGeometry', 'CylinderGeometry']).toContain(m.geometry.type)
  })
  it('figure meshes contain no texture images', () => {
    for (const m of meshes) {
      for (const mat of ([] as THREE.Material[]).concat(m.material)) {
        for (const v of Object.values(mat)) expect(v instanceof THREE.Texture).toBe(false)
        expect((mat as THREE.MeshLambertMaterial).map ?? null).toBeNull()
      }
    }
    const src = ['crew.ts', 'crewMount.ts'].map((f) => readFileSync(resolve(__dirname, f), 'utf8')).join('\n')
    expect(src).not.toMatch(/TextureLoader|ImageLoader|CanvasTexture|DataTexture|new Image\(|GLTF|FBXLoader|OBJLoader|\.(png|jpe?g|webp|svg|glb|gltf)['"]/)
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB/)
  })
  it('colours are neutral tokens (no state/selection/science colour, no markings)', () => {
    const allowed = new Set(['text', 'textMuted', 'textFaint', 'bg'].map((k) => new THREE.Color(TOKENS.color[k as 'text']).getHex()))
    for (const m of meshes) for (const mat of ([] as THREE.Material[]).concat(m.material)) expect(allowed.has((mat as THREE.MeshLambertMaterial).color.getHex())).toBe(true)
  })
  it('figure height follows the validated 1.7 m eye (helmet around the eye point)', () => {
    crew.update({ t: 0, dtMs: 0, route, terrain: { heightAt: () => -2500 }, anchor })
    const box = new THREE.Box3().setFromObject(crew.figures[1].root)
    const h = box.max.y - box.min.y
    expect(h).toBeGreaterThan(P.eyeHeightM)
    expect(h).toBeLessThan(P.eyeHeightM * 1.15)
    expect(box.min.y).toBeCloseTo(0, 1) // boots on the ground
  })
})

describe('first person: the camera is the leader’s eye', () => {
  it('hides the leader when the camera sits at its eye, shows both otherwise', () => {
    const crew = new Crew(P, { reducedMotion: () => false })
    const flat = { heightAt: () => -2500 }
    const pose = route.poseAt(5)
    const eye = toScene(anchor, pose.x, pose.y, -2500 + P.eyeHeightM)
    crew.update({ t: 5, dtMs: 16, route, terrain: flat, anchor, camera: { position: { x: eye[0], y: eye[1], z: eye[2] } } })
    expect(crew.figures[0].root.visible).toBe(false)
    expect(crew.figures[1].root.visible).toBe(true)
    crew.update({ t: 5, dtMs: 16, route, terrain: flat, anchor, camera: { position: { x: eye[0] - 250, y: eye[1] + 120, z: eye[2] } } })
    expect(crew.figures[0].root.visible).toBe(true)
    crew.dispose()
  })
})

describe('dispose', () => {
  it('frees every geometry and material and leaves the scene', () => {
    const scene = new THREE.Scene()
    const crew = new Crew(P, { reducedMotion: () => false })
    scene.add(crew.group)
    const geos = new Set<THREE.BufferGeometry>()
    const mats = new Set<THREE.Material>()
    crew.group.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      geos.add(m.geometry)
      for (const x of ([] as THREE.Material[]).concat(m.material)) mats.add(x)
    })
    const freed = new Set<unknown>()
    for (const g of geos) g.addEventListener('dispose', () => freed.add(g))
    for (const m of mats) m.addEventListener('dispose', () => freed.add(m))
    crew.dispose()
    expect(freed.size).toBe(geos.size + mats.size)
    expect(scene.children).not.toContain(crew.group)
    expect(() => crew.dispose()).not.toThrow()
  })
})

describe('installCrew: mount helper on K1’s onCamera hook', () => {
  const frame = (over: Partial<CrewSceneFrame> = {}): CrewSceneFrame => ({
    t: 5,
    pose: route.poseAt(5),
    terrain: hills,
    anchor,
    dtMs: 16,
    root: {} as HTMLElement,
    ...over,
  })
  const camera = () => ({ position: { x: 0, y: 0, z: 0, set: vi.fn() }, up: { set: vi.fn() }, lookAt: vi.fn() })
  const hook = () => {
    const calls: string[] = []
    const h: CameraHook = {
      clock: {} as CameraHook['clock'],
      rig: {} as CameraHook['rig'],
      onCamera: vi.fn<CameraHook['onCamera']>(() => {
        calls.push('camera')
      }),
      dispose: vi.fn(() => {
        calls.push('dispose')
      }),
    }
    return { calls, h }
  }
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('passes every frame to K1’s cameras first, unchanged; no scene in the frame = no figures', async () => {
    const { h } = hook()
    const load = vi.fn(() => import('./crew'))
    const wrapped = installCrew(h, { load })
    const cam = camera()
    const f = frame()
    wrapped.onCamera(cam, f)
    expect(h.onCamera).toHaveBeenCalledWith(cam, f)
    expect(wrapped.clock).toBe(h.clock)
    expect(wrapped.rig).toBe(h.rig)
    await flush()
    expect(load).not.toHaveBeenCalled()
    wrapped.dispose()
    expect(h.dispose).toHaveBeenCalledOnce()
  })
  it('loads the crew chunk once, adds the pair to the scene and moves it with the clock', async () => {
    const { h } = hook()
    const load = vi.fn(() => import('./crew'))
    const wrapped = installCrew(h, { load, reducedMotion: () => false })
    const scene = new THREE.Scene()
    wrapped.onCamera(camera(), frame({ scene, route }))
    wrapped.onCamera(camera(), frame({ scene, route }))
    await vi.waitFor(() => expect(scene.children.length).toBe(1))
    expect(load).toHaveBeenCalledOnce()
    wrapped.onCamera(camera(), frame({ scene, route, t: 7 }))
    const g = scene.children[0]
    const lead = g.children[0]
    const pose = route.poseAt(7)
    expect(lead.position.x).toBeCloseTo(pose.x - anchor.x, 9)
    expect(lead.position.z).toBeCloseTo(-(pose.y - anchor.y), 9)
    wrapped.dispose()
    expect(scene.children).toHaveLength(0)
    expect(h.dispose).toHaveBeenCalledOnce()
  })
  it('off for the F20 skyline probe (?fp3d-probe): no figures, cameras unchanged', async () => {
    const { h } = hook()
    const load = vi.fn(() => import('./crew'))
    const wrapped = installCrew(h, { load, enabled: () => false })
    const scene = new THREE.Scene()
    wrapped.onCamera(camera(), frame({ scene, route }))
    await flush()
    expect(load).not.toHaveBeenCalled()
    expect(scene.children).toHaveLength(0)
    expect(h.onCamera).toHaveBeenCalledOnce()
    wrapped.dispose()
  })
  it('disposed before the chunk arrives: nothing is added', async () => {
    const { h } = hook()
    const wrapped = installCrew(h, { load: () => import('./crew') })
    const scene = new THREE.Scene()
    wrapped.onCamera(camera(), frame({ scene, route }))
    wrapped.dispose()
    await flush()
    await flush()
    expect(scene.children).toHaveLength(0)
  })
  it('the mount helper stays Three.js-free (the crew chunk is lazy)', () => {
    const src = readFileSync(resolve(__dirname, 'crewMount.ts'), 'utf8')
    expect(src).not.toMatch(/^import (?!type )[^\n]*from 'three'/m)
    expect(src).not.toMatch(/^import (?!type )[^\n]*from '\.\/crew'/m)
    expect(src).toMatch(/import\('\.\/crew'\)/)
  })
})
