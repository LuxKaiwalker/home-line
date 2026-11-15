// PORT R4: the routes' legend entry + toggles (layer popover, registerMapControl; I1 renders it).
// Two switches bound to the planning view (toggleView: not an undo step) and one swatch per line
// style, so the map's four looks are named: official (thin), your route (bold), infeasible, computing.
import { LegendRow, Toggle } from '../../ui/components'
import { planning, selectView, usePlanning, type PlanningStore } from '../../state/planning'
import { tr } from './layers'

export function RouteLegend({ store = planning }: { store?: PlanningStore }) {
  const view = usePlanning(selectView, store)
  return (
    <section class="hl-r4-legend" aria-label={tr('legend')}>
      <div class="hl-r4-legend__row" data-route="official">
        <Toggle label={tr('official')} checked={view.showOfficial} onChange={(v) => store.toggleView('showOfficial', v)} />
        <LegendRow swatch="line" color="safe" label={tr('official')} />
      </div>
      <div class="hl-r4-legend__row" data-route="mine">
        <Toggle label={tr('mine')} checked={view.showMine} onChange={(v) => store.toggleView('showMine', v)} />
        <LegendRow swatch="line" color="text" label={tr('mine')} />
        <LegendRow swatch="line" color="limit" label={tr('infeasible')} />
        <LegendRow swatch="dashed" color="textMuted" label={tr('computing')} />
      </div>
    </section>
  )
}
