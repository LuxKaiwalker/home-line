// L1c: registers the base maps and their controls. I1 calls install() once (side-effect import of
// map/basemaps in views/console.tsx).
// F3 (D146): Topography is dropped (its code stays: reliefBasemap('topo'), TopoLegend) and the map-edge
// switcher (BasemapControl) is no longer mounted. Satellite stays the base; Material is a layer of the
// layers popover (off by default) that replaces the built-in mineral overlays (their rows are hidden,
// their code and data stay: station and selection cards keep using the mineral patches).
import { registerBasemap, registerMapControl, registerOverlay, type Dispose, type OverlaySpec } from '../extensions'
import { MaterialControl } from './Control'
import { canvasUrl, reliefBasemap, satelliteBasemap, BASEMAP_TITLE_KEYS, type ReliefDeps } from './layer'
import { loadReliefSource } from './source'
import { activeBasemap, setBasemap } from './store'

/** The (no longer mounted) map-edge switcher's id. */
export const BASEMAP_CONTROL_ID = 'basemaps'
export const MATERIAL_OVERLAY_ID = 'material'
export const MATERIAL_CONTROL_ID = 'l1c-material'
/** After L1a slope (10) and L1b Curiosity (20). */
export const MATERIAL_CONTROL_ORDER = 30
/** The built-in overlays (map/overlays/catalog.ts) Material takes the place of in the layers popover. */
export const MATERIAL_REPLACES = ['mineralSulfate', 'mineralClay', 'mineralPatches'] as const

/** Material as an overlay registration: on/off drives the material base map (drawn above Satellite). */
export const materialOverlaySpec = (): OverlaySpec => ({
  id: MATERIAL_OVERLAY_ID,
  titleKey: BASEMAP_TITLE_KEYS.material,
  defaultOn: false,
  replaces: MATERIAL_REPLACES,
  install: () => ({
    setVisible(on) {
      if (on) setBasemap('material')
      else if (activeBasemap.peek() === 'material') setBasemap('satellite')
    },
    destroy() {},
  }),
})

let installed: Dispose | null = null

export function install(deps: ReliefDeps = { load: loadReliefSource, toUrl: canvasUrl }): Dispose {
  if (installed) return installed
  const offs = [
    registerBasemap(satelliteBasemap()),
    registerBasemap(reliefBasemap('material', deps)),
    registerOverlay(materialOverlaySpec()),
    registerMapControl({ id: MATERIAL_CONTROL_ID, slot: 'layers-popover', order: MATERIAL_CONTROL_ORDER, render: () => <MaterialControl /> }),
  ]
  const off: Dispose = () => {
    for (const o of offs) o()
    if (installed === off) installed = null
  }
  installed = off
  return off
}
