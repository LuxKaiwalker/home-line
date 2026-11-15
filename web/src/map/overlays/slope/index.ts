// PORT L1a: slope layer (the Mission Planer's) for the Plan map. I1 calls install() once (e.g. from
// views/console.tsx); it registers the overlay (replaces Plan's built-in 'slopeClass') and the
// layer-popover control. Idempotent; the returned function unregisters both.
import { h } from 'preact'
import { registerMapControl, registerOverlay, type Dispose } from '../../extensions'
import { BROWSER_SLOPE_DEPS, slopeOverlaySpec, type SlopeDeps } from './layer'
import { SlopeControl } from './SlopeControl'

export { REPLACES, SITE_LIMITS, SLOPE_CLASS_IDS, SLOPE_COLORS, slopeClasses, slopeClassOf, renderSlope, type SlopeClass, type SlopeLimits } from './classes'
export { SLOPE_LAYER_ID, SLOPE_OVERLAY_ID, SLOPE_SOURCE_ID, slopeOverlaySpec, installSlopeLayer } from './layer'
export { SlopeControl, SlopeLegend } from './SlopeControl'
export { resetSlope, setSlopeOn, setSlopeOpacity, slopeOn, slopeOpacity, slopeStatus } from './state'

/** Layer-popover order: terrain layers first (L1b Curiosity and others come after). */
export const SLOPE_CONTROL_ORDER = 10
export const SLOPE_CONTROL_ID = 'l1a-slope'

let installed: Dispose | null = null

export function install(deps: SlopeDeps = BROWSER_SLOPE_DEPS): Dispose {
  if (installed) return installed
  const offOverlay = registerOverlay(slopeOverlaySpec(deps))
  const offControl = registerMapControl({ id: SLOPE_CONTROL_ID, slot: 'layers-popover', order: SLOPE_CONTROL_ORDER, render: () => h(SlopeControl, { limits: undefined }) })
  const dispose: Dispose = () => {
    offOverlay()
    offControl()
    if (installed === dispose) installed = null
  }
  installed = dispose
  return dispose
}
