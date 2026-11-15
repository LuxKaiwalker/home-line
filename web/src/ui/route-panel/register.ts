// PORT U1: importing this module fills the Plan view's 'route-panel' slot (I1 adds the one import in
// views/console.tsx, or calls installRoutePanel() itself and skips this file).
import { installRoutePanel } from './RoutePanel'

export const uninstallRoutePanel: () => void = installRoutePanel()
