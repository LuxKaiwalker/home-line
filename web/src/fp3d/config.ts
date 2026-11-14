// WS8 config: every constant of the 3D view comes from config/*.yaml (AGENTS rule 2), parsed at
// build time by the shell's YAML plugin (web/vite.config.ts), so no parser ships to the browser.
import hudRaw from '../../../config/hud.yaml'
import fp3dRaw from '../../../config/fp3d.yaml'
import variantsRaw from '../../../config/variants.yaml'
import horizonRaw from '../../../config/horizon.yaml'
import siteRaw from '../../../config/site.yaml'

type Obj = Record<string, unknown>

function get(root: unknown, path: string, file: string): unknown {
  let cur: unknown = root
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(part in (cur as Obj))) {
      throw new Error(`config value missing: config/${file}: ${path}`)
    }
    cur = (cur as Obj)[part]
  }
  return cur
}

function num(root: unknown, path: string, file: string): number {
  const v = get(root, path, file)
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`config value not a number: config/${file}: ${path}`)
  }
  return v
}

function str(root: unknown, path: string, file: string): string {
  const v = get(root, path, file)
  if (typeof v !== 'string') throw new Error(`config value not a string: config/${file}: ${path}`)
  return v
}

function nums(root: unknown, path: string, file: string, len?: number): number[] {
  const v = get(root, path, file)
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'number') || (len && v.length !== len)) {
    throw new Error(`config value not a number list: config/${file}: ${path}`)
  }
  return v as number[]
}

export interface Fp3dConfig {
  eyeHeightM: number
  playbackSpeeds: number[]
  defaultSpeed: number
  simulatedLabel: string
  fps3dMin: number
  fpsFallbackBelow: number
  budget3dMb: number
  defaultScenario: string
  skyRgb: [number, number, number]
  groundRgb: [number, number, number]
  fovDeg: number
  nearClipM: number
  farPolygonOffset: [number, number]
  ambientIntensity: number
  sunIntensity: number
  placeholderSun: { azDeg: number; elDeg: number; label: string }
  loaderConcurrency: number
  fallbackWindowS: number
  fallbackWarmupS: number
  hud2dRoute: string
  resolutionCaption: string
  lookAheadM: number
  marsRadiusM: number
  sky: {
    zenithRgb: [number, number, number]
    sunGlowRgb: [number, number, number]
    sunGlowDeg: number
    sunDiscDeg: number
    hazeHalfM: number
    nightSunElDeg: number
    nightFloor: number
  }
  ring: { skirtDeg: number; maxDistanceRatio: number; hazeHalfM: number }
  skylineCheck: { toleranceDeg: number; azStepDeg: number }
}

const rgb3 = (v: number[]): [number, number, number] => [v[0], v[1], v[2]]

/** Build the typed config from parsed YAML documents (pure; tested). */
export function buildConfig(
  hud: unknown,
  fp3d: unknown,
  variants: unknown,
  horizon: unknown,
  site: unknown,
): Fp3dConfig {
  const H = 'hud.yaml'
  const F = 'fp3d.yaml'
  const sky = nums(horizon, 'panorama.sky_rgb', 'horizon.yaml', 3)
  const ground = nums(horizon, 'panorama.ground_rgb', 'horizon.yaml', 3)
  const off = nums(fp3d, 'view.far_polygon_offset', F, 2)
  return {
    eyeHeightM: num(hud, 'eye_height_m', H),
    playbackSpeeds: nums(hud, 'playback_speeds', H),
    defaultSpeed: num(hud, 'default_speed', H),
    simulatedLabel: str(hud, 'labels.simulated', H),
    fps3dMin: num(hud, 'performance.fps_3d_min', H),
    fpsFallbackBelow: num(hud, 'performance.fps_3d_fallback_below', H),
    budget3dMb: num(hud, 'performance.budget_3d_mb', H),
    defaultScenario: str(variants, 'scenarios.default', 'variants.yaml'),
    skyRgb: [sky[0], sky[1], sky[2]],
    groundRgb: [ground[0], ground[1], ground[2]],
    fovDeg: num(fp3d, 'view.fov_deg', F),
    nearClipM: num(fp3d, 'view.near_clip_m', F),
    farPolygonOffset: [off[0], off[1]],
    ambientIntensity: num(fp3d, 'view.ambient_intensity', F),
    sunIntensity: num(fp3d, 'view.sun_intensity', F),
    placeholderSun: {
      azDeg: num(fp3d, 'view.placeholder_sun.az_deg', F),
      elDeg: num(fp3d, 'view.placeholder_sun.el_deg', F),
      label: str(fp3d, 'view.placeholder_sun.label', F),
    },
    loaderConcurrency: num(fp3d, 'loader.concurrency', F),
    fallbackWindowS: num(fp3d, 'fallback.fps_window_s', F),
    fallbackWarmupS: num(fp3d, 'fallback.warmup_s', F),
    hud2dRoute: str(fp3d, 'fallback.hud2d_route', F),
    resolutionCaption: str(fp3d, 'labels.resolution_caption', F),
    lookAheadM: num(fp3d, 'path.look_ahead_m', F),
    marsRadiusM: num(site, 'crs.mars_radius_m', 'site.yaml'),
    sky: {
      zenithRgb: rgb3(nums(fp3d, 'sky.zenith_rgb', F, 3)),
      sunGlowRgb: rgb3(nums(fp3d, 'sky.sun_glow_rgb', F, 3)),
      sunGlowDeg: num(fp3d, 'sky.sun_glow_deg', F),
      sunDiscDeg: num(fp3d, 'sky.sun_disc_deg', F),
      hazeHalfM: num(fp3d, 'sky.haze_half_m', F),
      nightSunElDeg: num(fp3d, 'sky.night_sun_el_deg', F),
      nightFloor: num(fp3d, 'sky.night_floor', F),
    },
    ring: {
      skirtDeg: num(fp3d, 'ring.skirt_deg', F),
      maxDistanceRatio: num(fp3d, 'ring.max_distance_ratio', F),
      hazeHalfM: num(fp3d, 'ring.haze_half_m', F),
    },
    skylineCheck: {
      toleranceDeg: num(fp3d, 'skyline_check.tolerance_deg', F),
      azStepDeg: num(fp3d, 'skyline_check.az_step_deg', F),
    },
  }
}

export const FP3D_CONFIG: Fp3dConfig = buildConfig(hudRaw, fp3dRaw, variantsRaw, horizonRaw, siteRaw)
