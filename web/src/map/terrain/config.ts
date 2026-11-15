// WS16 task 8 (M8): 3D terrain settings and interface text (DESIGN U1, §5.4).
//
// ======================= TEMPORARY HOME (this stack has no config/design.yaml, no ui/copy.json) ====
// config/design.yaml (`scale`, `exaggeration`, `camera`, `performance`) and the copy deck
// (web/src/ui/copy.json) are on `design` but not on the M3 → M6 stack this package sits on. The values
// below are copied verbatim from origin/design. terrain.test.ts cross-checks both files whenever they
// are present, so the rebase onto design turns the check on. After the rebase, replace TERRAIN with
// the design.yaml loader and COPY/t() with `import { t } from '../../ui/copy'`.
// ==================================================================================================
import { fill } from '../furniture/text'

/** config/design.yaml values U1 uses. */
export const TERRAIN = {
  /** scale.elevation_factor: baked into the tiles (P2), so exaggeration 1 = true shape. Never applied at runtime. */
  elevationFactor: 1.878,
  /** exaggeration: {min, max, default} */
  exaggeration: { min: 1, max: 3, default: 1 },
  /** camera.presets.isometric.pitch: the tilt 3D opens with */
  pitch3d: 45,
  /** camera.presets.low.pitch: the steepest preset = maxPitch while 3D is on */
  maxPitch3d: 70,
  /** performance.fps_3d_min */
  fps3dMin: 30,
} as const

/**
 * Values DESIGN states that config/design.yaml has no key for yet (asked for in notes/M8.md):
 * U1 item 6 "below 30 fps for 3 s"; the slider step shows the factor to one decimal.
 */
export const TERRAIN_PENDING = {
  /** DESIGN U1 item 6: the low frame rate must last this long before the flat fallback */
  slowWindowMs: 3000,
  /** frame gaps longer than this are an idle map (MapLibre renders on demand), never a slow frame */
  idleGapMs: 1000,
  /** the frame rate is the count of frames over this trailing window */
  fpsWindowMs: 500,
  /** exaggeration slider step (one decimal on the factor label) */
  exaggerationStep: 0.1,
} as const

/** copy.json keys used here, verbatim (dotted path -> text). */
export const COPY = {
  'buttons.toggle2d3d': '2D / 3D',
  'buttons.view2d': '2D',
  'buttons.view3d': '3D',
  'buttons.exaggeration': 'Exaggeration',
  'tooltips.exaggeration': 'Vertical exaggeration {factor}× (true shape at one times)',
  'layers.groups.terrain': 'Terrain',
  'layers.relief.name': 'Relief shading',
  'states.loading.terrain3d': 'Loading 3D terrain…',
  'states.error.webgl': '3D is not available on this device · showing the flat map with relief shading',
  'states.error.slow3d': '3D is too slow on this device · showing the flat map with relief shading',
} as const

/** Text copy.json does not have yet (asked for in notes/M8.md). */
export const COPY_PENDING = {
  noTiles: '3D terrain is not published in this data tree',
  trustNote: 'Measured: 1 m DEM (CTX 20 m, MOLA-HRSC 200 m at the edges); heights ×{factor} in the tiles for the Earth-sized map, so 1× is true shape',
} as const

export type CopyKey = keyof typeof COPY

export function t(key: CopyKey, vars: Record<string, string | number> = {}): string {
  return fill(COPY[key], vars)
}

/** The factor as the slider shows it: one decimal and the × sign ("1.0×"). */
export function factorText(x: number): string {
  return `${x.toFixed(1)}×`
}
