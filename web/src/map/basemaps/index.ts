// L1c: Plan map base maps (Satellite default · Topography · Material), port of the Mission Planer's
// "Maps" switcher. Importing this module registers them (I1: one side-effect import in views/console.tsx).
import { install } from './install'

install()

export { install, BASEMAP_CONTROL_ID } from './install'
export { activeBasemap, BASEMAP_IDS, DEFAULT_BASEMAP, reliefStatus, setBasemap, type BasemapId } from './store'
