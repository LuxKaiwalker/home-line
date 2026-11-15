// L1c: Plan map base maps, port of the Mission Planer's "Maps" switcher. F3 (D146): Satellite is the base,
// Material is a layer of the layers popover (replacing the mineral overlays), Topography and the switcher
// are not registered (code kept). Importing this module registers them (I1: side-effect import).
import { install } from './install'

install()

export { install, BASEMAP_CONTROL_ID, MATERIAL_CONTROL_ID, MATERIAL_OVERLAY_ID, MATERIAL_REPLACES, materialOverlaySpec } from './install'
export { activeBasemap, BASEMAP_IDS, DEFAULT_BASEMAP, reliefStatus, setBasemap, type BasemapId } from './store'
