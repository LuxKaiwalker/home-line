// WS16 task 10 (M10): the settings U6 reads, all from config/design.yaml (camera.flythrough, intro,
// capture, collapse, scale) and tokens.json (motion). Nothing is typed here by hand.
import designRaw from '../../../config/design.yaml'
import { cfg } from '../config'
import { TOKENS } from '../ui/tokens'

export const FLYTHROUGH = {
  /** camera.flythrough.sample_m: route samples for the spline */
  sampleM: cfg<number>(designRaw, 'camera.flythrough.sample_m'),
  spline: cfg<string>(designRaw, 'camera.flythrough.spline'),
  behindM: cfg<number>(designRaw, 'camera.flythrough.behind_m'),
  aboveM: cfg<number>(designRaw, 'camera.flythrough.above_m'),
  lookaheadM: cfg<number>(designRaw, 'camera.flythrough.lookahead_m'),
} as const

/**
 * camera.flythrough.turn_deg_per_min: follow-camera turn rate, deg per simulated EVA minute (assumed
 * in design.yaml, M10). The routes go out and back, so the crew -> look-ahead direction flips by up to
 * 180 deg at a station; the camera swings round at this rate instead (mostly during the station dwell).
 */
export const FOLLOW_TURN_DEG_PER_MIN = cfg<number>(designRaw, 'camera.flythrough.turn_deg_per_min')
/** step of the precomputed follow-camera bearing table, EVA minutes (assumed: true, M10) */
export const FOLLOW_TABLE_STEP_MIN = 0.05

export const INTRO = {
  onceOnly: cfg<boolean>(designRaw, 'intro.once_per_browser'),
  skipOnAnyInput: cfg<boolean>(designRaw, 'intro.skip_on_any_input'),
  offWithReducedMotion: cfg<boolean>(designRaw, 'intro.off_with_reduced_motion'),
  approxS: cfg<number>(designRaw, 'intro.approx_s'),
} as const

export const CAPTURE = {
  size: cfg<[number, number]>(designRaw, 'capture.size'),
  fps: cfg<number>(designRaw, 'capture.fps'),
} as const

/** scale.elevation_factor: Earth/Mars radius; horizontal map metres per true metre (D4), so heights scale alike */
export const ELEVATION_FACTOR = cfg<number>(designRaw, 'scale.elevation_factor')

/** collapse.duration_s: the default ease time of a storyboard collapse step without duration_s */
export const COLLAPSE_S = cfg<number>(designRaw, 'collapse.duration_s')

/** tokens motion.cameraMs: the end-of-story camera return (DESIGN §3.4 camera move 1.2–2.5 s) */
export const CAMERA_MS: readonly [number, number] = TOKENS.motion.cameraMs as unknown as [number, number]

/** tokens motion.panelMs: caption and chrome fades (DESIGN §3.4 panel change 180–240 ms) */
export const PANEL_MS: readonly [number, number] = TOKENS.motion.panelMs as unknown as [number, number]
