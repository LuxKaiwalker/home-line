// WS17 task 2 (U8, D73): the crew pair, built in code from basic Three.js shapes (capsules, boxes,
// spheres, cylinders), neutral token colours, no textures, no markings of any agency.
//
// Placement: the leader stands exactly at WS8's route pose at the mission-clock time (the same
// position as the camera and the 2D HUD, F20); the partner walks one gap behind along the route
// (gap = two ground rings side by side, design.yaml 3d.ground_ring_radius_m), feet on the drawn
// terrain. Walk cycle: procedural limb swing whose cadence is the timeline's walking speed (route
// per-vertex times) over the stride, in real time; standing still at stations; no swing and no bob
// under reduced motion. Loaded lazily (crewMount.ts imports this module on the first 3D frame).
import * as THREE from 'three'
import designRaw from '../../../config/design.yaml'
import { ui } from '../state/ui'
import { TOKENS } from '../ui/tokens'
import { FP3D_CONFIG, type Fp3dConfig } from './config'
import { withCurvature } from './look'

/**
 * Figure proportions as fractions of the validated first-person eye height (hud.yaml
 * eye_height_m, 1.7 m), so the figure's eye sits where the first-person camera does. Rendering
 * only, never a result. assumed (K2); candidates for config/design.yaml `3d.crew` (C).
 */
export const FIGURE = {
  hipOfEye: 0.5,
  hipHalfWidthOfEye: 0.055,
  legRadiusOfEye: 0.045,
  bootOfEye: { w: 0.075, h: 0.05, d: 0.15 },
  torsoRadiusOfEye: 0.11,
  torsoOfEye: { bottom: 0.47, top: 0.89 },
  neckOfEye: { r: 0.06, bottom: 0.87, top: 0.93 },
  helmetRadiusOfEye: 0.085,
  packOfEye: { w: 0.26, h: 0.34, d: 0.12, y: 0.7 },
  shoulderOfEye: { x: 0.15, y: 0.85 },
  armRadiusOfEye: 0.04,
  armLengthOfEye: 0.36,
  gloveRadiusOfEye: 0.045,
  /** one full walk cycle (two steps), m per m of eye height */
  strideOfEye: 0.8,
  /** swing amplitudes (rad) and vertical bob (fraction of eye height) at full walk */
  legSwingRad: 0.4,
  armSwingRad: 0.3,
  bobOfEye: 0.015,
} as const

export interface CrewParams {
  /** design.yaml 3d.crew_count */
  count: number
  /** design.yaml 3d.ground_ring_radius_m */
  ringRadiusM: number
  /** partner distance behind the leader: two ground rings touching */
  gapM: number
  eyeHeightM: number
  strideM: number
  /** walk/stand blend time constant: tokens motion.dataMs (lower end) */
  easeMs: number
  marsRadiusM: number
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

export function crewParams(design: unknown, fp: Pick<Fp3dConfig, 'eyeHeightM' | 'marsRadiusM'>, dataMs: readonly number[] = TOKENS.motion.dataMs): CrewParams {
  const count = num(design, '3d.crew_count')
  const ringRadiusM = num(design, '3d.ground_ring_radius_m')
  return {
    count,
    ringRadiusM,
    gapM: 2 * ringRadiusM,
    eyeHeightM: fp.eyeHeightM,
    strideM: FIGURE.strideOfEye * fp.eyeHeightM,
    easeMs: dataMs[0],
    marsRadiusM: fp.marsRadiusM,
  }
}

// ---- placement on the route (pure) ------------------------------------------------------------

/** The route as WS8's path.ts builds it (RoutePath satisfies this). */
export interface CrewLeg {
  cum: readonly number[]
  ts: readonly number[]
  length: number
  t0: number
  t1: number
}
export interface CrewRoute {
  legs: readonly CrewLeg[]
  poseAt(t: number): { x: number; y: number; headingDeg: number; leg: number; dwellAt: string | null }
  pointAlong(k: number, s: number): [number, number]
}

export interface CrewPlacement {
  x: number
  y: number
  /** degrees clockwise from grid north */
  headingDeg: number
  /** walking speed from the timeline, m/s of EVA time (0 while standing) */
  speedMps: number
  dwellAt: string | null
}

/** Arc length along a leg at EVA minute t (as path.ts: per-vertex times, clamped to the leg). */
export function arcAt(leg: CrewLeg, t: number): number {
  if (t <= leg.t0) return 0
  if (t >= leg.t1) return leg.length
  const ts = leg.ts
  let v = 1
  while (v < ts.length - 1 && ts[v] < t) v++
  const dt = ts[v] - ts[v - 1]
  const f = dt > 0 ? Math.min(1, Math.max(0, (t - ts[v - 1]) / dt)) : 1
  return leg.cum[v - 1] + f * (leg.cum[v] - leg.cum[v - 1])
}

/** Walking speed (m/s) at EVA minute t from the route's timing; 0 at stations, before and after. */
export function speedAt(route: CrewRoute, t: number): number {
  const pose = route.poseAt(t)
  if (pose.dwellAt !== null) return 0
  const leg = route.legs[pose.leg]
  if (!leg || t < leg.t0 || t > leg.t1 || leg.t1 <= leg.t0) return 0
  const ts = leg.ts
  let v = 1
  while (v < ts.length - 1 && ts[v] < t) v++
  const dt = ts[v] - ts[v - 1]
  return dt > 0 ? (leg.cum[v] - leg.cum[v - 1]) / (dt * 60) : 0
}

const headingTo = (dx: number, dy: number) => ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360

/**
 * Where each crew member stands at EVA minute t: [leader, partner, ...]. Figure k trails the
 * leader by k gaps: towards the route point k gaps back along the path, at exactly k gaps' distance
 * (rings never overlap), facing the one ahead. Where the route has no path behind (at the pad
 * before departure), straight behind the leader's heading.
 */
export function crewPlacements(route: CrewRoute, t: number, p: Pick<CrewParams, 'count' | 'gapM'>): CrewPlacement[] {
  const pose = route.poseAt(t)
  const speedMps = speedAt(route, t)
  const lead: CrewPlacement = { x: pose.x, y: pose.y, headingDeg: pose.headingDeg, speedMps, dwellAt: pose.dwellAt }
  const out = [lead]
  const leg = route.legs[pose.leg]
  const s0 = pose.dwellAt !== null ? leg.length : arcAt(leg, t)
  for (let k = 1; k < p.count; k++) {
    const d = k * p.gapM
    let kk = pose.leg
    let s = s0 - d
    while (s < 0 && kk > 0) {
      kk -= 1
      s += route.legs[kk].length
    }
    const [bx, by] = route.pointAlong(kk, Math.max(0, s))
    let ux = bx - lead.x
    let uy = by - lead.y
    const len = Math.hypot(ux, uy)
    if (len > 1e-6) {
      ux /= len
      uy /= len
    } else {
      const h = (lead.headingDeg * Math.PI) / 180
      ux = -Math.sin(h)
      uy = -Math.cos(h)
    }
    const x = lead.x + ux * d
    const y = lead.y + uy * d
    out.push({ x, y, headingDeg: headingTo(-ux, -uy), speedMps, dwellAt: pose.dwellAt })
  }
  return out
}

/** Analysis CRS (x, y, absolute height) to scene coordinates (as terrain.ts cameraPosition). */
export function toScene(anchor: { x: number; y: number; h: number }, x: number, y: number, h: number): [number, number, number] {
  return [x - anchor.x, h - anchor.h, -(y - anchor.y)]
}

// ---- walk cycle (pure) --------------------------------------------------------------------------

export class WalkCycle {
  phase = 0
  /** Advance by real time dtS at walking speed speedMps (one cycle per stride). */
  advance(speedMps: number, dtS: number, strideM: number): void {
    if (!(speedMps > 0) || !(dtS > 0)) return
    this.phase = (this.phase + (2 * Math.PI * speedMps * dtS) / strideM) % (2 * Math.PI)
  }
}

export interface LimbPose {
  legL: number
  legR: number
  armL: number
  armR: number
  /** vertical lift, fraction of eye height */
  bob: number
}

/** Limb angles (rad, + = forward) at a cycle phase and walk amplitude 0..1; rest pose when reduced. */
export function limbPose(phase: number, amplitude: number, reduced: boolean): LimbPose {
  if (reduced || !(amplitude > 0)) return { legL: 0, legR: 0, armL: 0, armR: 0, bob: 0 }
  const s = Math.sin(phase)
  const leg = FIGURE.legSwingRad * amplitude * s
  const arm = FIGURE.armSwingRad * amplitude * s
  return { legL: leg, legR: -leg, armL: -arm, armR: arm, bob: FIGURE.bobOfEye * amplitude * 0.5 * (1 - Math.cos(2 * phase)) }
}

// ---- the figures (Three.js) ---------------------------------------------------------------------

export interface Figure {
  /** placed on the ground, turned to the heading */
  root: THREE.Group
  /** everything above the ground; bobs */
  body: THREE.Group
  legs: [THREE.Group, THREE.Group]
  arms: [THREE.Group, THREE.Group]
}

export interface CrewFrame {
  t: number
  dtMs: number
  route: CrewRoute
  terrain: { heightAt(x: number, y: number): number }
  anchor: { x: number; y: number; h: number }
  /** the camera this frame (scene coordinates); the leader is hidden when it sits at its eye */
  camera?: { position: { x: number; y: number; z: number } }
}

const SEG = { radial: 12, cap: 4, sphereW: 16, sphereH: 12 }

export class Crew {
  readonly params: CrewParams
  readonly group = new THREE.Group()
  readonly figures: Figure[] = []
  readonly cycle = new WalkCycle()
  /** walk amplitude 0 (standing) .. 1 (walking), eased */
  amplitude = 0
  private readonly geos: THREE.BufferGeometry[] = []
  private readonly mats: THREE.Material[] = []
  private readonly reduced: () => boolean
  private lastT = Number.NaN
  private disposed = false

  constructor(params: CrewParams, opts: { reducedMotion?: () => boolean } = {}) {
    this.params = params
    this.reduced = opts.reducedMotion ?? (() => ui.reducedMotion.peek())
    this.group.name = 'crew'
    this.group.visible = false // until the first update places it
    const E = params.eyeHeightM
    const F = FIGURE
    const mat = (token: 'text' | 'textMuted' | 'textFaint' | 'bg') => {
      const m = withCurvature(new THREE.MeshLambertMaterial({ color: new THREE.Color(TOKENS.color[token]) }), params.marsRadiusM)
      this.mats.push(m)
      return m
    }
    const geo = <G extends THREE.BufferGeometry>(g: G): G => {
      this.geos.push(g)
      return g
    }
    const suit = mat('text')
    const gear = mat('textMuted')
    const boots = mat('textFaint')
    const visor = mat('bg')

    const capsule = (r: number, total: number) => geo(new THREE.CapsuleGeometry(r, Math.max(0, total - 2 * r), SEG.cap, SEG.radial))
    const legLen = F.hipOfEye * E - F.bootOfEye.h * E
    const legGeo = capsule(F.legRadiusOfEye * E, legLen)
    const bootGeo = geo(new THREE.BoxGeometry(F.bootOfEye.w * E, F.bootOfEye.h * E, F.bootOfEye.d * E))
    const torsoH = (F.torsoOfEye.top - F.torsoOfEye.bottom) * E
    const torsoGeo = capsule(F.torsoRadiusOfEye * E, torsoH)
    const neckGeo = geo(new THREE.CylinderGeometry(F.neckOfEye.r * E, F.neckOfEye.r * E, (F.neckOfEye.top - F.neckOfEye.bottom) * E, SEG.radial))
    const helmetR = F.helmetRadiusOfEye * E
    const helmetGeo = geo(new THREE.SphereGeometry(helmetR, SEG.sphereW, SEG.sphereH))
    // visor: a front band of a slightly larger sphere (local forward = -Z: phi = 3pi/2)
    const visorGeo = geo(new THREE.SphereGeometry(helmetR * 1.03, SEG.sphereW, SEG.sphereH, (3 * Math.PI) / 2 - Math.PI / 3, (2 * Math.PI) / 3, 0.3 * Math.PI, 0.25 * Math.PI))
    const packGeo = geo(new THREE.BoxGeometry(F.packOfEye.w * E, F.packOfEye.h * E, F.packOfEye.d * E))
    const armLen = F.armLengthOfEye * E
    const armGeo = capsule(F.armRadiusOfEye * E, armLen)
    const gloveGeo = geo(new THREE.SphereGeometry(F.gloveRadiusOfEye * E, SEG.sphereW / 2, SEG.sphereH / 2))

    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
      const o = new THREE.Mesh(g, m)
      o.position.set(x, y, z)
      o.castShadow = true // used once the scene has a shadow map (WS17 task 4)
      return o
    }

    for (let k = 0; k < params.count; k++) {
      const root = new THREE.Group()
      root.name = k === 0 ? 'crew-leader' : `crew-partner-${k}`
      const body = new THREE.Group()
      root.add(body)
      const hipY = F.hipOfEye * E
      const legs = [-1, 1].map((side) => {
        const pivot = new THREE.Group()
        pivot.position.set(side * F.hipHalfWidthOfEye * E, hipY, 0)
        pivot.add(mesh(legGeo, suit, 0, -legLen / 2, 0))
        pivot.add(mesh(bootGeo, boots, 0, -(hipY - (F.bootOfEye.h * E) / 2), -0.02 * E))
        body.add(pivot)
        return pivot
      }) as [THREE.Group, THREE.Group]
      body.add(mesh(torsoGeo, suit, 0, ((F.torsoOfEye.bottom + F.torsoOfEye.top) / 2) * E, 0))
      body.add(mesh(neckGeo, gear, 0, ((F.neckOfEye.bottom + F.neckOfEye.top) / 2) * E, 0))
      body.add(mesh(helmetGeo, suit, 0, E, 0))
      body.add(mesh(visorGeo, visor, 0, E, 0))
      body.add(mesh(packGeo, gear, 0, F.packOfEye.y * E, F.torsoRadiusOfEye * E + (F.packOfEye.d * E) / 2))
      const arms = [-1, 1].map((side) => {
        const pivot = new THREE.Group()
        pivot.position.set(side * F.shoulderOfEye.x * E, F.shoulderOfEye.y * E, 0)
        pivot.add(mesh(armGeo, suit, 0, -armLen / 2, 0))
        pivot.add(mesh(gloveGeo, boots, 0, -armLen, 0))
        body.add(pivot)
        return pivot
      }) as [THREE.Group, THREE.Group]
      this.group.add(root)
      this.figures.push({ root, body, legs, arms })
    }
  }

  /** Cycle phase of figure k: the partner is half a cycle out of step. */
  phaseOf(k: number): number {
    return this.cycle.phase + k * Math.PI
  }

  update(f: CrewFrame): CrewPlacement[] {
    const p = this.params
    const placed = crewPlacements(f.route, f.t, p)
    const reduced = this.reduced()
    // the walk animates only while the clock runs (paused = frozen, like the scene)
    if (Number.isFinite(this.lastT) && f.t !== this.lastT) {
      const dtS = Math.max(0, f.dtMs) / 1000
      const target = !reduced && placed[0].speedMps > 0 ? 1 : 0
      this.amplitude = reduced ? 0 : target + (this.amplitude - target) * Math.exp(-(dtS * 1000) / p.easeMs)
      if (this.amplitude < 1e-4 && target === 0) this.amplitude = 0
      this.cycle.advance(placed[0].speedMps, dtS, p.strideM)
    }
    if (reduced) this.amplitude = 0
    this.lastT = f.t
    placed.forEach((c, k) => {
      const fig = this.figures[k]
      const [sx, sy, sz] = toScene(f.anchor, c.x, c.y, f.terrain.heightAt(c.x, c.y))
      fig.root.position.set(sx, sy, sz)
      fig.root.rotation.set(0, (-c.headingDeg * Math.PI) / 180, 0)
      const lp = limbPose(this.phaseOf(k), this.amplitude, reduced)
      fig.legs[0].rotation.x = lp.legL
      fig.legs[1].rotation.x = lp.legR
      fig.arms[0].rotation.x = lp.armL
      fig.arms[1].rotation.x = lp.armR
      fig.body.position.y = lp.bob * p.eyeHeightM
      fig.root.visible = true
      if (f.camera) {
        // the first-person camera is the leader's eye: hide a figure the camera sits inside
        const c3 = f.camera.position
        if (Math.hypot(c3.x - sx, c3.y - (sy + p.eyeHeightM), c3.z - sz) < p.ringRadiusM) fig.root.visible = false
      }
    })
    this.group.visible = true
    this.group.updateMatrixWorld(true)
    return placed
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.group.removeFromParent()
    for (const g of this.geos) g.dispose()
    for (const m of this.mats) m.dispose()
  }
}

/** The crew for the 3D scene, from config (design.yaml 3d block, hud.yaml eye height). */
export function createCrew(opts: { reducedMotion?: () => boolean } = {}): Crew {
  return new Crew(crewParams(designRaw, FP3D_CONFIG), opts)
}
