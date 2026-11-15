// L1c: registers the three base maps (satellite = default, topography, material) and the map-edge
// switcher. I1 calls install() once (side-effect import of map/basemaps in views/console.tsx).
import { registerBasemap, registerMapControl, type Dispose } from '../extensions'
import { BasemapControl } from './Control'
import { canvasUrl, reliefBasemap, satelliteBasemap, type ReliefDeps } from './layer'
import { loadReliefSource } from './source'

export const BASEMAP_CONTROL_ID = 'basemaps'

let installed: Dispose | null = null

export function install(deps: ReliefDeps = { load: loadReliefSource, toUrl: canvasUrl }): Dispose {
  if (installed) return installed
  const offs = [
    registerBasemap(satelliteBasemap()),
    registerBasemap(reliefBasemap('topo', deps)),
    registerBasemap(reliefBasemap('material', deps)),
    registerMapControl({ id: BASEMAP_CONTROL_ID, slot: 'map-edge', order: 10, render: () => <BasemapControl /> }),
  ]
  const off: Dispose = () => {
    for (const o of offs) o()
    if (installed === off) installed = null
  }
  installed = off
  return off
}
