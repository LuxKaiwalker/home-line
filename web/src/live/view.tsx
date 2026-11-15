// Pad tool panel (F24): validation feedback, instant preview card, full plan with staged results.
// WP12 (L6 W-1): the card no longer starts a job of its own. Its numbers are labelled "Estimate"; its
// one button hands the compute to the Edit-route panel (the one compute action: this spot + the crew
// panel's changes + the route, one job, one progress, one result on the map).
// WP13 (L6 W-2, W-6; 10.7 F2, N5): the card's "Estimate" is the shared Badge (the route panel's result
// carries "Computed live"); while the panel's job runs the card says "Queued · position N" or the stage,
// elapsed and expected time; the legacy full plan (VITE_ROUTE_EDIT=0, the published site) shows the
// stage list and queue position too, and a 429 "not now" reads as a sentence, never the raw code.
// Pure function components of PadToolState (no hooks), so tests render them without a DOM.
// Every live view carries LIVE_LABEL and a provenance link (kit rule 6): #/plan/{hash} once a job
// has a hash, before that the engine identity that answered (GET /engine/version).
import { Badge } from '../edit/route/badge'
import { JobProgress } from '../edit/route/progress'
import { busyText, ROUTE_TEXT } from '../edit/route/text'
import { t } from '../ui/copy'
import { JOB_TIMING, LIVE_LABEL } from './config'
import { bannerFor } from './health'
import { LiveNum, planHref, ScreenNum } from './num'
import type { PadToolActions, PadToolState, PlanState, RecordState } from './padtool'
import { RangeFlags } from './rangeflags'
import type { StageResult } from './stage'
import type { Job, PadCheck, PadReason, PadScreen } from './types'

/** Plain-language text per PadCheck.reason (openapi enum). */
export const REASON_TEXT: Record<Exclude<PadReason, null>, string> = {
  slope: 'Too steep: the block breaks the D21 slope limit',
  unknown_terrain: 'No 1 m terrain here',
  disc_off_grid: 'The flat 30-min disc around this pad leaves the terrain grid',
  outside_grid: 'Outside the terrain grid',
}

const fmtDeg = (v: number) => v.toFixed(6) // input coordinates (user click), not a computed number

function LiveTag({ href, text }: { href: string; text: string }) {
  return (
    <p class="live-label">
      {LIVE_LABEL} · <a class="live-prov" href={href}>{text}</a>
    </p>
  )
}

function CheckView({ check, actions }: { check: PadCheck; actions: PadToolActions }) {
  if (check.valid) return <p class="live-ok">Valid pad (D21 rule)</p>
  const n = check.nearest_valid
  return (
    <div class="live-invalid" role="alert">
      <p class="live-reason" data-reason={check.reason ?? ''}>
        {check.reason ? REASON_TEXT[check.reason] : 'Not a valid pad'}
        {check.detail ? ` (${check.detail})` : ''}
      </p>
      {n ? (
        <p class="live-nearest">
          Nearest valid block: {fmtDeg(n.lon)}°E {fmtDeg(n.lat)}°N, <ScreenNum v={n.distance_m} units="m" /> away{' '}
          <button type="button" class="live-btn" onClick={() => actions.useNearest()}>
            Use the nearest valid block
          </button>
        </p>
      ) : (
        <p class="live-nearest muted">No valid block nearby.</p>
      )}
    </div>
  )
}

/** What the card knows of the Edit-route panel (live/route/mount.tsx RouteHandle). */
export interface RouteLinkView {
  status: 'unavailable' | 'ready' | 'running'
  compute(): void
  /** WP13: the panel's running job (live/route/mount.tsx RouteProgress); null/absent = none */
  progress?: { job: { status: string; stage: string | null; stagesDone: readonly string[]; queuePosition?: number | null } | null; since: number; freePoints: number } | null
}

/** A live Job as the shared progress reads it (WP13). */
const progressJob = (j: Job | null) => (j ? { status: j.status, stage: j.stage ?? null, stagesDone: j.stages_done, queuePosition: j.queue_position ?? null } : null)

const WHY_CARD = 'live-why-compute'

function PreviewCard({ screen, route, heavyOff, blocked, ownCompute, actions, now }: { screen: PadScreen; route: RouteLinkView | null | undefined; heavyOff: boolean; blocked: string | null; ownCompute: boolean; actions: PadToolActions; now?: number }) {
  // D116: a build without the Edit-route panel (VITE_ROUTE_EDIT=0, route undefined) keeps the card's own
  // "Compute full plan": still the one compute action of that build
  const legacy = route === undefined
  const running = legacy ? false : route?.status === 'running'
  // a press while the job runs is allowed: it only brings the panel's progress into view
  const why = legacy ? (heavyOff ? 'Full plans are switched off on the server right now.' : blocked) : running ? null : heavyOff ? 'Full plans are switched off on the server right now.' : blocked ? blocked : !route || route.status === 'unavailable' ? ROUTE_TEXT.cardNoRoute : null
  return (
    <section class="live-card live-preview" data-trust="estimate">
      <h3>
        Instant preview <Badge kind="estimate" class="live-estimate" />
      </h3>
      <p class="muted">{t('edit.previewNote')}</p>
      <p>
        Feasible EVAs (D21 score): <ScreenNum v={screen.feasible_evas} />
      </p>
      <table class="mini live-stations">
        <thead>
          <tr>
            <th>Station</th>
            <th>Reachable</th>
            <th>Out</th>
            <th>Home</th>
          </tr>
        </thead>
        <tbody>
          {screen.stations.map((s) => (
            <tr key={s.id} data-station={s.id}>
              <td>{s.id}</td>
              <td>{s.reachable ? 'yes' : 'no'}</td>
              <td>
                <ScreenNum v={s.t_out_min} units="min" />
              </td>
              <td>
                <ScreenNum v={s.t_home_min} units="min" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {screen.best_route ? (
        <p class="live-best">
          Best route estimate: pad → {screen.best_route.order.join(' → ')} → pad, <ScreenNum v={screen.best_route.total_min} units="min" />
        </p>
      ) : (
        <p class="muted">No route estimate.</p>
      )}
      <p class="muted">{screen.label}</p>
      {legacy ? (
        <button type="button" class="live-btn live-compute" disabled={!ownCompute} title={why ?? undefined} aria-describedby={why ? WHY_CARD : undefined} onClick={() => actions.computePlan()}>
          Compute full plan
        </button>
      ) : (
        <>
          <p class="muted live-route-note">{ROUTE_TEXT.cardNote}</p>
          <button type="button" class="live-btn live-compute" data-compute-in="route" disabled={!!why} title={why ?? undefined} aria-describedby={why ? WHY_CARD : undefined} onClick={() => route?.compute()}>
            {ROUTE_TEXT.cardCompute}
          </button>
        </>
      )}
      {running ? (
        <div class="muted live-route-running" role="status">
          <p>{ROUTE_TEXT.cardRunning}</p>
          {route?.progress ? (
            <JobProgress job={route.progress.job} elapsedMs={now === undefined ? null : now - route.progress.since} timing={JOB_TIMING} freePoints={route.progress.freePoints} block="live" compact />
          ) : null}
        </div>
      ) : null}
      {why ? (
        <p id={WHY_CARD} class={blocked && !heavyOff ? 'live-failed' : 'muted'} role={blocked && !heavyOff ? 'alert' : 'status'}>
          {why}
        </p>
      ) : null}
    </section>
  )
}

function Headline({ r, hash }: { r: StageResult; hash: string }) {
  const s = r.scenario
  if (!s) return <p class="muted">No scenario index yet.</p>
  const h = s.headline
  const b = h.budget_min
  return (
    <p class="live-headline">
      Reachable within a {b}-min walk home ({s.id}):{' '}
      <LiveNum v={h.reachable_pct} units="%" file="scenarios/index.json" k={`reachable_pct.${s.id}.${b}`} manifest={r.manifest} hash={hash} />
      {h.range_pct[0] !== null || h.range_pct[1] !== null ? (
        <>
          {' '}
          (range <LiveNum v={h.range_pct[0]} units="%" file="scenarios/index.json" k={`reachable_pct_range.${s.id}.${b}.low`} manifest={r.manifest} hash={hash} /> to{' '}
          <LiveNum v={h.range_pct[1]} units="%" file="scenarios/index.json" k={`reachable_pct_range.${s.id}.${b}.high`} manifest={r.manifest} hash={hash} />)
        </>
      ) : null}
    </p>
  )
}

/** Range flags of the finished plan, from its run record (read once the job is done). */
function RecordFlags({ record }: { record: RecordState }) {
  if (record.kind === 'loading') return <p class="muted">Reading the run record…</p>
  if (record.kind === 'error') return <p class="live-failed">Run record not shown: {record.message}</p>
  if (record.kind !== 'done') return null
  const flags = record.record.range_flags ?? []
  return flags.length ? <RangeFlags flags={flags} title="Range flags (run record)" /> : <p class="live-ok live-no-flags">No range flags: every input is inside its validated range.</p>
}

function PlanView({ plan, record, actions, now }: { plan: Exclude<PlanState, { kind: 'idle' }>; record: RecordState; actions: PadToolActions; now?: number }) {
  const job = plan.job
  const r = plan.result
  return (
    <section class="live-card live-plan" data-plan={plan.kind}>
      <h3>Full plan</h3>
      {job ? <LiveTag href={planHref(job.hash)} text={`provenance of plan ${job.hash}`} /> : <p class="live-label">{LIVE_LABEL}</p>}
      {plan.kind === 'running' ? (
        <div class="live-progress">
          <JobProgress job={progressJob(job)} elapsedMs={now !== undefined && plan.since !== undefined ? now - plan.since : null} timing={JOB_TIMING} block="live" />
          <p>
            {job ? <progress max={1} value={job.progress} /> : null}{' '}
            <button type="button" class="live-btn" onClick={() => actions.cancelPlan()}>
              Cancel
            </button>
          </p>
        </div>
      ) : null}
      {plan.kind === 'done' ? <p class="live-ok">All stages done.</p> : null}
      {plan.kind === 'failed' ? (
        <p class="live-failed" role="alert">
          {busyText(plan.error, plan.retryAfterS) ?? (
            <>
              The plan failed: {plan.error}
              {plan.retryAfterS ? `; try again in ${plan.retryAfterS} s` : ''}.
            </>
          )}
        </p>
      ) : null}
      {plan.kind === 'cancelled' ? <p class="muted">Cancelled.</p> : null}
      {job && (plan.kind === 'running' || plan.kind === 'done') && plan.attached ? <p class="muted live-attached">Same inputs as an earlier run: attached to plan {job.hash} (not computed again).</p> : null}
      {job && job.stages_done.length ? <p class="live-stages">Stages on the map: {job.stages_done.join(', ')}</p> : null}
      {plan.kind === 'done' ? <RecordFlags record={record} /> : null}
      {r && job ? <Headline r={r} hash={job.hash} /> : null}
      {r && r.errors.length ? (
        <ul class="live-errors">
          {r.errors.map((e) => (
            <li key={e.path}>
              {e.path}: not shown ({e.message})
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

export interface PadToolPanelProps {
  state: PadToolState
  actions: PadToolActions
  /** Provenance before a job exists: the engine identity that answers (client.root + /engine/version). */
  engineHref: string
  /** Why the compute is blocked (the crew panel: a field is not a number), or null. */
  computeBlocked?: string | null
  /** WP12: the Edit-route panel that computes the plan (null: not there yet; undefined: none in this build) */
  route?: RouteLinkView | null
  /** WP13: the clock reading the elapsed time is shown at (ms); absent = not shown */
  now?: number
}

/** null while live planning is offline, warming or checking: the controls hide behind U1's banner. */
export function PadToolPanel({ state, actions, engineHref, computeBlocked = null, route, now }: PadToolPanelProps) {
  const banner = bannerFor(state.live)
  if (!banner.controls) return null
  const { pad, check, preview, plan } = state
  const valid = check.kind === 'done' && check.result.valid
  return (
    <section class="live-pad" aria-label="Live pad tool">
      <h2>Live pad</h2>
      <LiveTag href={engineHref} text="provenance: engine version" />
      {!pad ? <p class="muted">Click the map to try a pad location.</p> : null}
      {pad ? (
        <p class="live-pad-pos">
          Pad {fmtDeg(pad.lon)}°E {fmtDeg(pad.lat)}°N{' '}
          <button type="button" class="live-btn" onClick={() => actions.clear()}>
            Clear
          </button>
        </p>
      ) : null}
      {check.kind === 'checking' ? <p class="muted">Checking the pad…</p> : null}
      {check.kind === 'error' ? (
        <p class="live-failed" role="alert">
          Could not check the pad: {check.message}
        </p>
      ) : null}
      {check.kind === 'done' ? <CheckView check={check.result} actions={actions} /> : null}
      {valid && preview.kind === 'loading' ? <p class="muted">Loading the instant preview…</p> : null}
      {valid && preview.kind === 'error' ? (
        <p class="live-failed" role="alert">
          No preview: {preview.message}
        </p>
      ) : null}
      {valid && preview.kind === 'done' ? (
        <PreviewCard
          screen={preview.screen}
          route={route}
          heavyOff={!banner.heavyJobs}
          blocked={computeBlocked}
          ownCompute={banner.heavyJobs && plan.kind !== 'running' && !computeBlocked}
          actions={actions}
          now={now}
        />
      ) : null}
      {plan.kind !== 'idle' ? <PlanView plan={plan} record={state.record} actions={actions} now={now} /> : null}
    </section>
  )
}
