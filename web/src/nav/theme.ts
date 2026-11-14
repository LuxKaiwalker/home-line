// Presentation-only constants for the nav views (colours, opacities, throttles). No science values:
// those come from config/nav.yaml (./config.ts) or from the data files.
import type { FixType } from './types'

export const NAV_THEME = {
  /** D_max classes, short (fix often) to long (fix rarely): red -> amber -> green -> blue. */
  classColours: [
    [229, 72, 77],
    [240, 170, 60],
    [120, 200, 120],
    [90, 160, 230],
  ] as [number, number, number][],
  classAlpha: 150,
  fix: { rover: '#ffffff', station: '#ffd166', skyline: '#7fe3ff' } as Record<FixType, string>,
  trueTrack: '#9be29b',
  estimatedTrack: '#ff9f6b',
  route: '#d9cfc8',
  ellipse: '#7fc8ff',
  ellipseNow: '#ffe066',
  marker: '#ffffff',
  /** Map / panel refresh while playing (Hz); the clock itself runs every animation frame. */
  uiHz: 12,
} as const

export const rgb = (c: readonly number[]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`
