// PORT R3: "Add to route" on a station card and the `?add=<station>` link, on the planning state.
//
//   AddToRouteButton   the card button (replaces J1d's link to #/mission?add=…): one click appends the
//                      station (one undo step) or says why not (limits, already in the route); shows
//                      "In your route" once the station is in it. Mounted by I1 in
//                      ui/cards/selectionCard.tsx (see /tmp/hl-port/requests-I1.md "R3").
//   applyAddParam      parsePlanningHash(hash).add -> the same append; the router wiring (when, and the
//                      history.replaceState to link.canonical) is I1's / U4's.
import { Icon } from '../../../ui/components/Icon'
import { usePlanning, type PlanningLink } from '../../../state/planning'
import { planEditor } from './plan'
import { type PlanEditor } from './planEdit'
import { t } from '../../../ui/copy'

/** A station id as stations.json writes them (S1 …); anything else in a link is ignored. */
const STATION_ID = /^[A-Za-z0-9_-]{1,32}$/

export type AddResult = ReturnType<PlanEditor['addStation']> | 'invalid'

/** Append a station to the route (addStop {kind:'station'}), with the limits and a notice. */
export function addStationToRoute(station: string, ed: PlanEditor = planEditor()): AddResult {
  if (!STATION_ID.test(station)) return 'invalid'
  return ed.addStation(station)
}

/**
 * Apply a link's `?add=` (parsePlanningHash(hash).add). Call it AFTER the link's doc (if any) was
 * loaded with store.replace, so the station is appended to that route. true = a stop was added.
 */
export function applyAddParam(link: Pick<PlanningLink, 'add'> | null, ed: PlanEditor = planEditor()): boolean {
  if (!link?.add) return false
  return addStationToRoute(link.add, ed) === 'added'
}

const inRoute = (station: string) => (s: { route: { stops: readonly { kind: string; station?: string }[] } }) =>
  s.route.stops.some((x) => x.kind === 'station' && x.station === station)

/** The station card's "Add to route" button (hl-btn secondary, as the J1d link it replaces). */
export function AddToRouteButton({ station, editor, onAdded }: { station: string; editor?: PlanEditor; onAdded?: (station: string) => void }) {
  const ed = editor ?? planEditor()
  const has = usePlanning(inRoute(station), ed.store)
  if (has)
    return (
      <span class="hl-btn hl-btn--secondary plan-card__add is-in-route" aria-disabled="true" data-add-to-route={station} data-in-route="">
        <Icon name="check" /> {t('route.mapEdit.card.inRoute')}
      </span>
    )
  return (
    <button
      type="button"
      class="hl-btn hl-btn--secondary plan-card__add"
      title={t('route.mapEdit.card.addTip')}
      data-add-to-route={station}
      onClick={() => {
        if (addStationToRoute(station, ed) === 'added') onAdded?.(station)
      }}
    >
      <Icon name="plus" /> {t('route.mapEdit.card.add')}
    </button>
  )
}
