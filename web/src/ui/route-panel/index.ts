// PORT U1: the Route panel's public API (no side effects; register.ts fills the Plan slot).
export { closeRoutePanel, isRoutePanelOpen, openRoutePanel, ROUTE_PANEL_ID, routePanelCollapsed, routePanelOpen, setRoutePanelCollapsed } from './panelState'
export { registerRoutePanelSection, ROUTE_PANEL_SECTIONS, type RoutePanelSection, type RoutePanelSectionName, type RoutePanelSectionProps } from './sections'
export { installRoutePanel, RoutePanel } from './RoutePanel'
