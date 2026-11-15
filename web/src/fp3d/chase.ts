// WS17 (U8): pose maths of the extra 3D cameras: chase (behind and above the crew, smoothed) and
// overhead (north up, looking straight down), plus the first-person pose exactly as WS8's view.ts
// sets it (for transitions only; the first-person camera itself stays WS8's). Pure: no Three.js,
// no DOM, so it is tested on the CPU and costs nothing outside the 3D chunk.
//
// Frames. Route poses are in the analysis CRS (x east, y north, metres; heading clockwise from
// grid north). Camera poses are in WS8's Three.js frame relative to the anchor
// (terrain.ts cameraPosition): X = x − anchor.x, Y = height − anchor.h, Z = −(y − anchor.y).
import type { Anchor } from './terrain'

export type Vec3 = [number, number, number]

/** A camera pose: eye, look-at target and up vector (Three.js frame). */
export interface CamPose {
  eye: Vec3
  target: Vec3
  up: Vec3
}

/** Height of the drawn surface at analysis-CRS (x, y) in metres (WS8 Terrain.heightAt). */
export type HeightAt = (x: number, y: number) => number

export interface Ground {
  anchor: Anchor
  heightAt: HeightAt
}

export interface ChaseParams {
  /** config/design.yaml camera.presets.follow.behind_m */
  behindM: number
  /** config/design.yaml camera.presets.follow.above_m (above the crew's ground) */
  aboveM: number
  /** config/design.yaml camera.presets.follow.lookahead_m (look-at point ahead of the crew) */
  lookaheadM: number
  /** minimum eye height above the drawn surface under the camera (m) */
  clearanceM: number
  /** smoothing time of the critically damped follow (s) */
  smoothS: number
}

export const UP: Vec3 = [0, 1, 0]
/** grid north in the Three.js frame (−Z) */
export const NORTH: Vec3 = [0, 0, -1]

/** Three.js-frame point of analysis (x, y) at height h (m). */
export function toScene(a: Anchor, x: number, y: number, h: number): Vec3 {
  return [x - a.x, h - a.h, -(y - a.y)]
}

/** Analysis-CRS (x, y) of a Three.js-frame point. */
export function fromScene(a: Anchor, p: Vec3): [number, number] {
  return [p[0] + a.x, a.y - p[2]]
}

const rad = (deg: number) => (deg * Math.PI) / 180

/**
 * Critically damped spring step towards `target` (Game Programming Gems 4, ch. 1.10, "Critically
 * Damped Ease-In/Ease-Out Smoothing"): no overshoot, exact for any frame time up to the
 * exponential's Padé approximation. Returns [value, velocity].
 */
export function smoothDamp(cur: number, target: number, vel: number, smoothS: number, dtS: number): [number, number] {
  if (!(dtS > 0)) return [cur, vel]
  if (!(smoothS > 0)) return [target, 0]
  const omega = 2 / smoothS
  const x = omega * dtS
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const change = cur - target
  const temp = (vel + omega * change) * dtS
  let v = (vel - omega * temp) * exp
  let out = target + (change + temp) * exp
  // never pass the target (the approximation can, by a hair, on very long frames)
  if (target - cur > 0 === out > target) {
    out = target
    v = 0
  }
  return [out, v]
}

/** First-person pose as WS8's view.ts frame loop sets it (eye height above the drawn surface). */
export function firstPersonPose(g: Ground, x: number, y: number, headingDeg: number, eyeHeightM: number): CamPose {
  const eye = toScene(g.anchor, x, y, g.heightAt(x, y) + eyeHeightM)
  const h = rad(headingDeg)
  return { eye, target: [eye[0] + Math.sin(h), eye[1], eye[2] - Math.cos(h)], up: UP }
}

/** Overhead pose: straight above the crew at `heightM` over its ground, north up (pitch 0, bearing 0). */
export function overheadPose(g: Ground, x: number, y: number, heightM: number, clearanceM: number): CamPose {
  const ground = g.heightAt(x, y)
  return {
    eye: toScene(g.anchor, x, y, ground + Math.max(heightM, clearanceM)),
    target: toScene(g.anchor, x, y, ground),
    up: NORTH,
  }
}

/** Lowest allowed eye height (m, absolute) at analysis (x, y). */
export function floorAt(g: Ground, x: number, y: number, clearanceM: number): number {
  return g.heightAt(x, y) + clearanceM
}

/**
 * Unsmoothed chase pose for a crew at (x, y) heading `headingDeg` (unit direction (dx, dy) may be
 * given instead, for the smoothed heading): eye `behindM` behind and `aboveM` above the crew's
 * ground, raised to the terrain clearance; look-at point `lookaheadM` ahead at the crew's ground.
 */
export function chasePose(g: Ground, x: number, y: number, dir: [number, number], p: ChaseParams, aboveM = p.aboveM): CamPose {
  const [dx, dy] = dir
  const ground = g.heightAt(x, y)
  const ex = x - p.behindM * dx
  const ey = y - p.behindM * dy
  const h = Math.max(ground + aboveM, floorAt(g, ex, ey, p.clearanceM))
  return {
    eye: toScene(g.anchor, ex, ey, h),
    target: toScene(g.anchor, x + p.lookaheadM * dx, y + p.lookaheadM * dy, ground),
    up: UP,
  }
}

export const headingDir = (headingDeg: number): [number, number] => [Math.sin(rad(headingDeg)), Math.cos(rad(headingDeg))]

/**
 * The chase camera's follower. The crew position is followed exactly every frame (no lag at any
 * playback speed); what is smoothed is the heading (the route's 3 m-grid turns) and the eye's
 * height above the crew's ground (the terrain under the eye), both with the critically damped
 * spring. The terrain clearance is a hard floor applied after smoothing.
 */
export class ChaseFollower {
  private dir: [number, number] | null = null
  private dirVel: [number, number] = [0, 0]
  private above = Number.NaN
  private aboveVel = 0

  /** Forget the smoothing state: the next update is a cut to the target pose. */
  reset(): void {
    this.dir = null
    this.dirVel = [0, 0]
    this.above = Number.NaN
    this.aboveVel = 0
  }

  /** Smoothed heading direction (unit vector, analysis CRS), or null before the first update. */
  get direction(): [number, number] | null {
    return this.dir ? [this.dir[0], this.dir[1]] : null
  }

  update(g: Ground, x: number, y: number, headingDeg: number, dtS: number, p: ChaseParams): CamPose {
    const want = headingDir(headingDeg)
    if (!this.dir) {
      this.dir = want
    } else {
      const [sx, vx] = smoothDamp(this.dir[0], want[0], this.dirVel[0], p.smoothS, dtS)
      const [sy, vy] = smoothDamp(this.dir[1], want[1], this.dirVel[1], p.smoothS, dtS)
      const n = Math.hypot(sx, sy)
      // a reversal passes through zero length: keep the last direction for that frame
      this.dir = n > 1e-6 ? [sx / n, sy / n] : this.dir
      this.dirVel = [vx, vy]
    }
    const ground = g.heightAt(x, y)
    const ex = x - p.behindM * this.dir[0]
    const ey = y - p.behindM * this.dir[1]
    const wantAbove = Math.max(p.aboveM, floorAt(g, ex, ey, p.clearanceM) - ground)
    if (Number.isNaN(this.above)) this.above = wantAbove
    else [this.above, this.aboveVel] = smoothDamp(this.above, wantAbove, this.aboveVel, p.smoothS, dtS)
    // chasePose re-applies the clearance floor: smoothing never takes the eye into the ground
    return chasePose(g, x, y, this.dir, p, this.above)
  }
}

/** Ease-in-out (cubic) on [0, 1] (DESIGN §3.4 camera move). */
export function easeInOut(u: number): number {
  const v = Math.min(1, Math.max(0, u))
  return v < 0.5 ? 4 * v * v * v : 1 - (-2 * v + 2) ** 3 / 2
}

const lerp3 = (a: Vec3, b: Vec3, f: number): Vec3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]

/** Blend two poses (eye, target and up interpolated; up renormalised). */
export function blendPose(a: CamPose, b: CamPose, f: number): CamPose {
  const up = lerp3(a.up, b.up, f)
  const n = Math.hypot(...up)
  return { eye: lerp3(a.eye, b.eye, f), target: lerp3(a.target, b.target, f), up: n > 1e-9 ? [up[0] / n, up[1] / n, up[2] / n] : b.up }
}
