// PORT U1: the Route panel (Notion "Port Mission Planer into Plan" §2.3): a right Drawer over the Plan
// map with the Mission Planer's simple card layout (views/mission.tsx), in this order:
//   header     title, collapse, close (Drawer)
//   pad        pad picker (PadPicker.tsx)
//   estimates  route estimates + the pad's reach numbers (Estimates.tsx, Reach.tsx); the empty-route
//              hint while there are no stops
//   list       U2 (registerRoutePanelSection('list', …))
//   settings   U3 ('settings')
//   export     U4 ('export')
// Open / close: panelState.ts (openRoutePanel / closeRoutePanel). Esc closes it (layout store), focus
// moves into it on open and back to the opener on close (Drawer). Filled into the Plan view's
// 'route-panel' slot by installRoutePanel() (register.ts).
import { planning, selectHasRoute, usePlanning, type PlanningStore } from '../../state/planning'
import { useSignalValue } from '../../state/signal'
import { registerPlanSlot } from '../../views/planPortSlots'
import { IconButton } from '../components'
import { t } from '../copy'
import { Drawer, domId } from '../layout'
import type { Loader } from '../../data/loader'
import { tr } from './copy'
import { RouteEstimates } from './Estimates'
import { PadPicker } from './PadPicker'
import { ROUTE_PANEL_ID, routePanelCollapsed, routePanelOpen, setRoutePanelCollapsed } from './panelState'
import { PadReach } from './Reach'
import { ROUTE_PANEL_SECTIONS, useRoutePanelSection, type RoutePanelSectionName } from './sections'
import './routePanel.css'

const BODY_ID = domId(ROUTE_PANEL_ID, 'cards')

function SectionRegion({ name, store }: { name: RoutePanelSectionName; store: PlanningStore }) {
  const C = useRoutePanelSection(name)
  if (!C) return null
  return (
    <section class="hl-rp__card hl-rp__slot" aria-label={tr(`panel.sections.${name}`)} data-route-section={name}>
      <C store={store} />
    </section>
  )
}

export interface RoutePanelProps {
  store?: PlanningStore
  /** scenarios index source for the official pad's reach (tests); default the app loader */
  loader?: Pick<Loader, 'scenarios'>
}

export function RoutePanel({ store = planning, loader }: RoutePanelProps) {
  const collapsed = useSignalValue(routePanelCollapsed)
  const open = useSignalValue(routePanelOpen)
  const hasRoute = usePlanning(selectHasRoute, store)
  const estId = domId(ROUTE_PANEL_ID, 'est')
  return (
    <Drawer
      id={ROUTE_PANEL_ID}
      title={t('route.panel.title')}
      class={collapsed ? 'hl-rp hl-rp--collapsed' : 'hl-rp'}
      actions={
        <IconButton
          icon={collapsed ? 'chevron-down' : 'chevron-up'}
          label={collapsed ? tr('panel.expand') : tr('panel.collapse')}
          aria-expanded={collapsed ? 'false' : 'true'}
          aria-controls={BODY_ID}
          class="hl-rp__collapse"
          onClick={() => setRoutePanelCollapsed(!collapsed)}
        />
      }
    >
      <div id={BODY_ID} class="hl-rp__body" hidden={collapsed} data-route-panel>
        <PadPicker store={store} />
        <section class="hl-rp__card" aria-labelledby={estId} data-estimates-card>
          <h3 id={estId} class="hl-rp__h">
            {tr('panel.estimates.title')}
          </h3>
          {hasRoute ? <RouteEstimates store={store} /> : <p class="hl-rp__empty" data-empty>{tr('panel.empty')}</p>}
          {/* backed numbers only while open: the closed drawer stays mounted (hidden), and the value
              snapshot must not see the strip's reach keys a second time while the panel is closed */}
          {open && <PadReach store={store} loader={loader} />}
        </section>
        {ROUTE_PANEL_SECTIONS.map((n) => (
          <SectionRegion key={n} name={n} store={store} />
        ))}
      </div>
    </Drawer>
  )
}

/** Fill the Plan view's 'route-panel' slot (views/planPortSlots.tsx). Returns unregister. */
export function installRoutePanel(): () => void {
  return registerPlanSlot('route-panel', () => <RoutePanel />)
}
