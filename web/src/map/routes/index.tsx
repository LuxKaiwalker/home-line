// PORT R4: route rendering on the Plan map. I1 calls install() once (views/console.tsx):
//
//   import { install as installRoutes } from '../map/routes'
//   installRoutes({ stationAt, stationName })   // station lookup from the loaded station list
//
// It registers registerRouteLayer('official') and ('mine') (ConsoleMap.routeLayers(kind) returns their
// handles) and the legend + toggles in the layer popover. Returns a dispose for all three.
import { registerMapControl, registerRouteLayer, type Dispose } from '../extensions'
import { RouteLegend } from './Legend'
import { mineRouteLayer, officialRouteLayer, type RouteLayerDeps } from './layers'
import './routes.css'

export { mineRouteLayer, officialRouteLayer, type RouteLayerDeps } from './layers'
export { RouteLegend } from './Legend'

/** layer popover order (after the base map choice, before the thematic overlays) */
export const ROUTES_CONTROL_ORDER = 20

export function install(deps: RouteLayerDeps = {}): Dispose {
  const offs = [
    registerRouteLayer(officialRouteLayer(deps)),
    registerRouteLayer(mineRouteLayer(deps)),
    registerMapControl({ id: 'routes', slot: 'layers-popover', order: ROUTES_CONTROL_ORDER, render: () => <RouteLegend store={deps.store} /> }),
  ]
  return () => offs.splice(0).forEach((f) => f())
}
