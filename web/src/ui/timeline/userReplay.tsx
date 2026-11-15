// PORT F5: the replay source in the Plan drawer. While the user's route replays (state/userReplay.ts)
// the player says so ("Replaying: your route (estimate)"), offers "Replay the official plan", and shows
// only the route core's numbers, each labelled "Estimate". The official chart is hidden meanwhile.
import { planning, stopLabels, usePlanning, type PlanningStore } from '../../state/planning'
import { useRouteResults } from '../../state/routeResults'
import { missionClock } from '../../state/mission'
import { useSignalValue } from '../../state/signal'
import { buildUserReplay, loadUserReplay, replayAt, replayOfficialPlan, userReplay } from '../../state/userReplay'
import { Button } from '../components'
import { copyFrom } from '../copy'
import own from './copy.F5.json'
import { ReplayElevation, ReplayHeight, ReplayViewTabs, useHeightRes, useReplayElevation, useReplayView } from './userReplayElev'

export const tr = copyFrom(own)

/** Route panel: "Load into replay", enabled once the route core has a complete ('ready') route. */
export function LoadIntoReplay({ store = planning }: { store?: PlanningStore }) {
  const route = usePlanning((s) => s.route, store)
  const results = useRouteResults((r) => r)
  const ok = results.status === 'ready' && buildUserReplay(results, route) !== null
  return (
    <Button
      class="hl-rp__replay"
      data-testid="load-into-replay"
      disabled={!ok}
      reason={ok ? null : tr('loadNeedsRoute')}
      title={tr('loadTip')}
      onClick={() => {
        if (ok) loadUserReplay(results, route)
      }}
    >
      {tr('load')}
    </Button>
  )
}

/** Drawer / player: what is replaying, and the way back. Renders nothing for the official default. */
export function ReplaySourceBar() {
  const u = useSignalValue(userReplay)
  if (!u) return null
  return (
    <span class="plan-replay" data-replay-source="user" role="status">
      <span class="plan-replay__label">{tr('replaying')}</span>
      <Button variant="ghost" class="plan-replay__back" data-testid="replay-official" onClick={() => replayOfficialPlan()}>
        {tr('backToOfficial')}
      </Button>
    </span>
  )
}

/** Expanded timeline tab during the user's replay: the core's numbers at the clock minute, "Estimate". */
export function UserReplayReadout({ store = planning }: { store?: PlanningStore }) {
  const u = useSignalValue(userReplay)
  const tNow = useSignalValue(missionClock.s.t)
  const stops = usePlanning((s) => s.route.stops, store)
  // PORT F15: main's Margin / Elevation switch and the height along the route (userReplayElev.tsx)
  const elev = useReplayElevation(u)
  const [view, setView] = useReplayView()
  const resM = useHeightRes()
  if (!u) return null
  const st = replayAt(u, tNow)
  const labels = stopLabels(stops)
  const name = (id: string | null) => {
    const i = id === null ? -1 : stops.findIndex((s) => s.id === id)
    return i >= 0 ? labels[i] : tr('pad')
  }
  const where = st.phase === 'done' ? tr('done') : st.phase === 'dwell' ? tr('atStop', { name: name(st.stopId) }) : st.stopId === null ? tr('walkingHome') : tr('walking', { name: name(st.stopId) })
  return (
    <div class="plan-replay__readout" data-replay-readout>
      <ReplaySourceBar />
      <p>{where}</p>
      <ReplayViewTabs view={view} setView={setView} />
      {view === 'elevation' && <ReplayElevation u={u} e={elev} tNow={tNow} stops={stops} resM={resM} />}
      <ul class="plan-replay__nums">
        <li data-estimate>
          <span class="plan-replay__tag">{tr('estimate')}</span> {tr('length', { v: u.totalMin.toFixed(1) })}
        </li>
        <li data-estimate>
          <span class="plan-replay__tag">{tr('estimate')}</span> {st.o2UsedL === null ? tr('o2Unknown') : tr('o2Used', { v: st.o2UsedL.toFixed(1) })}
        </li>
        <li data-estimate>
          <span class="plan-replay__tag">{tr('estimate')}</span> {u.marginMin === null ? tr('marginUnknown') : tr('margin', { v: u.marginMin.toFixed(1) })}
        </li>
        <ReplayHeight e={elev} tNow={tNow} />
      </ul>
      <p class="muted">{tr('officialHidden')}</p>
    </div>
  )
}
