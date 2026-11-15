// I1b (D128): the instant browser estimate at the top of the Edit-route panel: totals (walk time, EVA
// time, O2 used / left), the tightest margin and its binding term, the per-leg list; an infeasible route
// names its FIRST failing leg, the term and the minutes short. Every number is labelled with
// ESTIMATE_LABEL. "Send to simulator" downloads mission.json built from this estimate at once (also for
// an infeasible route: feasibility is in the file); disabled only while there is no stop.
// I3: the EVA start card below it (start.tsx); a moved start adds CUSTOM_START_LABEL to the head.
import { useState } from 'preact/hooks'
import { useSignalValue } from '../../../state/signal'
import { Button } from '../../../ui/components/Button'
import { cx, Icon } from '../../../ui/components/Icon'
import type { PlanRoute } from '../model'
import { fill } from '../text'
import type { EstimateState, RouteEstimate } from './estimate'
import type { EstimateResult } from './types'
import { START_TEXT, StartBox } from './start'

export const INSTANT_TEXT = {
  title: 'Instant estimate',
  walk: 'Walk {min} min',
  eva: 'EVA {min} min',
  o2: 'O₂ used {used} L · left {left} L',
  tightest: 'Tightest margin {min} min ({term})',
  feasible: 'Every leg keeps its margins (estimate).',
  infeasibleTitle: 'This order does not work (estimate)',
  infeasible: 'Leg {n} ({from} → {to}) fails first: {term}, short by {min} min',
  infeasibleNoMin: 'Leg {n} ({from} → {to}) fails first: {term}',
  leg: '{from} → {to}',
  legWalk: '{min} min',
  legNone: 'no path on the 5 m grid',
  legMargin: 'margin {min} min ({term})',
  // I1c: the failing leg's row shows the check the headline quotes, and says why it differs from the walked margin
  legCheck: 'fails the planning check by {min} min ({term})',
  infeasibleRule: 'Planning check (the server’s rule): O₂ used before each leg counted at the effort cap. Leg margins are the walked estimate.',
  loading: 'Loading the browser fields…',
  offAuto: 'The instant estimate follows your order: switch to “My order”.',
  offEmpty: 'Tick stations or add waypoints: the route is estimated at once on every edit.',
  timing: 'computed in the browser in {ms} ms',
  send: 'Send to simulator',
  sendWhy: 'Add a stop first.',
  sendWait: 'Wait for the estimate.',
  sent: 'Saved {name}',
  sendFailed: 'Not saved ({why})',
  pad: 'Pad',
}

const n0 = (v: number | null): string => (v === null || !Number.isFinite(v) ? '—' : String(Math.round(v)))
const n1 = (v: number | null): string => (v === null || !Number.isFinite(v) ? '—' : (Math.round(v * 10) / 10).toFixed(1))
const nameOf = (s: string) => (s === 'pad' ? INSTANT_TEXT.pad : s)

function ResultBody({ r, ms }: { r: EstimateResult; ms: number }) {
  const f = r.feasibility
  const failing = f.feasible ? null : f.leg
  return (
    <>
      <p class="hl-route__est-totals num" data-estimate-totals>
        <span data-total="walk">{fill(INSTANT_TEXT.walk, { min: n0(r.totals.walkMin) })}</span> ·{' '}
        <span data-total="eva">{fill(INSTANT_TEXT.eva, { min: n0(r.totals.evaMin) })}</span> ·{' '}
        <span data-total="o2">{fill(INSTANT_TEXT.o2, { used: n1(r.totals.o2UsedL), left: n1(r.totals.o2LeftL) })}</span>
      </p>
      {r.tightest ? (
        <p class="hl-route__est-margin num" data-binding={r.tightest.binding}>
          {fill(INSTANT_TEXT.tightest, { min: n0(r.tightest.marginMin), term: r.tightest.binding })}
        </p>
      ) : null}
      {f.feasible ? (
        <p class="hl-route__ok" data-estimate-feasible="true">
          {INSTANT_TEXT.feasible}
        </p>
      ) : (
        <div class="hl-route__infeasible" role="alert" data-estimate-feasible="false" data-leg={f.leg} data-limit={f.term}>
          <p class="hl-route__infeasible-title">
            <Icon name="triangle-alert" /> {INSTANT_TEXT.infeasibleTitle}
          </p>
          <p class="hl-route__infeasible-leg">
            {fill(f.shortMin === null ? INSTANT_TEXT.infeasibleNoMin : INSTANT_TEXT.infeasible, { n: f.leg + 1, from: nameOf(f.from), to: nameOf(f.to), term: f.term, min: n0(f.shortMin) })}
          </p>
          <p class="hl-route__note" data-estimate-rule>
            {INSTANT_TEXT.infeasibleRule}
          </p>
        </div>
      )}
      <ol class="hl-route__est-legs" aria-label={INSTANT_TEXT.title}>
        {r.legs.map((l) => (
          <li
            class={cx('hl-route__est-leg', failing === l.leg && 'is-failing')}
            data-leg={l.leg}
            data-state={failing === null ? 'ok' : l.leg < failing ? 'planned' : l.leg === failing ? 'failing' : 'not-planned'}
          >
            <span>{fill(INSTANT_TEXT.leg, { from: nameOf(l.from), to: nameOf(l.to) })}</span>{' '}
            <span class="num">{l.walkMin === null ? INSTANT_TEXT.legNone : fill(INSTANT_TEXT.legWalk, { min: n0(l.walkMin) })}</span>
            {l.marginMin !== null && l.binding ? <span class="hl-route__est-legmargin num"> · {fill(INSTANT_TEXT.legMargin, { min: n0(l.marginMin), term: l.binding })}</span> : null}
            {failing === l.leg && l.checkOk === false && l.checkBinding && f.feasible === false && f.shortMin !== null ? (
              <span class="hl-route__est-legcheck num" data-check-min={f.shortMin}>
                {' '}
                · {fill(INSTANT_TEXT.legCheck, { min: n0(f.shortMin), term: l.checkBinding })}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      <p class="hl-route__note" data-estimate-ms={Math.round(ms)}>
        {fill(INSTANT_TEXT.timing, { ms: ms < 1 ? '<1' : Math.round(ms) })}
      </p>
    </>
  )
}

export interface EstimateViewProps {
  est: RouteEstimate
  state: EstimateState
  route: PlanRoute
}

/** Pure view (tests render it with a state). */
export function EstimateView({ est, state: s, route }: EstimateViewProps) {
  const [msg, setMsg] = useState<string | null>(null)
  const noStops = !route.stops.length
  const sendWhy = noStops ? INSTANT_TEXT.sendWhy : s.kind !== 'ready' ? INSTANT_TEXT.sendWait : null
  return (
    <section class="hl-route__estimate" data-route-estimate={s.kind} aria-label={INSTANT_TEXT.title}>
      <p class="hl-route__est-head">
        <span class="hl-route__ghost-title">{INSTANT_TEXT.title}</span>{' '}
        <span class="hl-tag hl-tag--estimate" data-estimate-label>
          {est.label}
        </span>
        {s.kind === 'ready' && s.startMs !== null ? (
          <>
            {' '}
            <span class="hl-tag hl-tag--estimate" data-estimate-start="custom">
              {START_TEXT.custom}
            </span>
          </>
        ) : null}
      </p>
      {s.kind === 'ready' ? <ResultBody r={s.result} ms={s.ms} /> : null}
      {s.kind === 'loading' ? <p class="hl-route__note">{INSTANT_TEXT.loading}</p> : null}
      {s.kind === 'unavailable' ? <p class="hl-route__note" data-estimate-unavailable>{s.reason}</p> : null}
      {s.kind === 'off' ? <p class="hl-route__note">{s.why === 'auto' ? INSTANT_TEXT.offAuto : INSTANT_TEXT.offEmpty}</p> : null}
      <div class="hl-route__est-actions">
        <Button
          variant="primary"
          icon="download"
          class="hl-route__send"
          data-sim-export={sendWhy ? 'unavailable' : 'ready'}
          data-origin="estimate"
          disabled={!!sendWhy}
          title={sendWhy ?? undefined}
          aria-describedby={sendWhy ? 'hl-route-why-send' : undefined}
          onClick={() => {
            est.exportMission().then(
              (r) => setMsg(r ? fill(INSTANT_TEXT.sent, { name: r.name }) : null),
              (e) => setMsg(fill(INSTANT_TEXT.sendFailed, { why: e instanceof Error ? e.message : String(e) })),
            )
          }}
        >
          {INSTANT_TEXT.send}
        </Button>
        <span class="hl-route__note" id="hl-route-why-send" role="status" data-sim-status>
          {sendWhy ?? msg ?? ''}
        </span>
      </div>
    </section>
  )
}

/** The estimate bound to its signals. */
export function EstimateBox({ est, route }: { est: RouteEstimate; route: PlanRoute }) {
  const s = useSignalValue(est.state)
  return (
    <>
      <EstimateView est={est} state={s} route={route} />
      {/* I3: the EVA start the estimate and Send to simulator use */}
      <StartBox est={est} />
    </>
  )
}
