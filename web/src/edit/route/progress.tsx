// WP13 (L6 W-2, 10.7 F2): progress of a running plan job as people read it. Pure: no hooks, no DOM,
// nothing from src/live (the live side passes the job fields and the measured stage timings, which live
// in live/config.ts JOB_TIMING). Used by the Edit-route panel and the Live pad card / plan view, so the
// stage list, the queue position and the expected time read the same everywhere.
//   stages    nominal -> bands -> partner -> route -> summary (server/engine/plan_job.py STAGES); a
//             stage the job names that is not in this list is shown after them (names are free strings)
//   queued    "Queued · position N" with N = queue_position + 1 (the API counts from 0)
//   expected  "expected ~6 min" from measured typical stage times: an expectation, never a promise
import { t } from '../../ui/copy'
import { cx } from '../../ui/components/Icon'
import { fill, PROGRESS_TEXT as P } from './text'
export { busyText } from './text'
import './progress.css'

/** The plan job's stages in order (server/engine/plan_job.py STAGES). */
export const JOB_STAGES = ['nominal', 'bands', 'partner', 'route', 'summary'] as const

/** Measured stage timings (live/config.ts JOB_TIMING): typical [low, high] seconds per stage and the expected total. */
export interface JobTiming {
  /** typical seconds per stage, [low, high] */
  stageS: Readonly<Record<string, readonly [number, number]>>
  /** typical whole job with stations only */
  stationsOnlyS: number
  /** added per free point of the route (W1, W2, …) */
  perFreePointS: number
}

/** The job fields the progress needs (live Job, or the route panel's RouteJobView). */
export interface JobProgressJob {
  status: string
  stage: string | null
  stagesDone: readonly string[]
  /** 0-based place in the queue while queued (job.queue_position); null = not reported */
  queuePosition?: number | null
}

export type StageState = 'waiting' | 'running' | 'done'
export interface StageRow {
  name: string
  label: string
  state: StageState
}

/** Copy deck words where the deck has the stage (stepper.stages), else the panel's own text. */
export function stageLabel(name: string): string {
  if (name === 'nominal') return t('stepper.stages.nominal')
  if (name === 'partner') return t('stepper.stages.partner')
  return (P.stages as Record<string, string>)[name] ?? name
}

export function stageRows(job: JobProgressJob | null): StageRow[] {
  const names: string[] = [...JOB_STAGES]
  for (const s of [...(job?.stagesDone ?? []), ...(job?.stage ? [job.stage] : [])]) if (!names.includes(s)) names.push(s)
  const done = new Set(job?.stagesDone ?? [])
  const current = job && job.status !== 'queued' ? job.stage : null
  return names.map((name) => ({ name, label: stageLabel(name), state: done.has(name) || job?.status === 'done' ? 'done' : name === current ? 'running' : 'waiting' }))
}

/** Expected seconds for the whole job: stations only, plus a fixed amount per free point (an expectation). */
export function expectedTotalS(timing: JobTiming, freePoints: number): number {
  return timing.stationsOnlyS + Math.max(0, freePoints) * timing.perFreePointS
}

/** "expected ~6 min" (whole minutes, at least 1). */
export function expectedText(seconds: number): string {
  return fill(P.expected, { min: Math.max(1, Math.round(seconds / 60)) })
}

/** "1:05" (minutes:seconds), never negative. */
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "Queued · position N" (N = queue_position + 1), or "Queued" when the server gives no position. */
export function queueText(queuePosition: number | null | undefined): string {
  return Number.isInteger(queuePosition) && (queuePosition as number) >= 0 ? fill(P.queuedAt, { n: (queuePosition as number) + 1 }) : P.queued
}

export interface JobProgressProps {
  job: JobProgressJob | null
  /** ms since the compute was pressed (elapsed time); null = not shown */
  elapsedMs: number | null
  timing?: JobTiming | null
  /** free points in the route (each adds perFreePointS to the expectation) */
  freePoints?: number
  /** BEM block of the host's classes (hl-route or live) */
  block?: string
  /** the head line only (the Live pad card: the stage list is in the panel) */
  compact?: boolean
}

/** The stage list, the current stage, elapsed time and the expected total; or the queue position. */
export function JobProgress({ job, elapsedMs, timing, freePoints = 0, block = 'hl-progress', compact = false }: JobProgressProps) {
  const queued = !job || job.status === 'queued'
  const rows = stageRows(job)
  const current = rows.find((r) => r.state === 'running')
  const exp = timing ? expectedText(expectedTotalS(timing, freePoints)) : null
  return (
    <div class={cx('hl-progress', `${block}__jobprogress`)} data-job-status={job?.status ?? 'submitting'}>
      <p class="hl-progress__head" data-progress-head>
        <span class="hl-progress__now">{queued ? queueText(job?.queuePosition) : current ? fill(P.runningStage, { stage: current.label }) : P.running}</span>
        {elapsedMs !== null ? <span class="hl-progress__elapsed"> · {fill(P.elapsed, { t: fmtElapsed(elapsedMs) })}</span> : null}
        {exp ? (
          <span class="hl-progress__expected" title={P.expectedNote}>
            {' '}
            · {exp}
          </span>
        ) : null}
      </p>
      {compact ? null : (
      <ol class="hl-progress__stages" aria-label={t('stepper.title')}>
        {rows.map((r) => (
          <li key={r.name} class={cx('hl-progress__stage', `is-${r.state}`)} data-job-stage={r.name} data-state={r.state} aria-current={r.state === 'running' ? 'step' : undefined}>
            {r.label} · {t(`stepper.states.${r.state}`)}
          </li>
        ))}
      </ol>
      )}
    </div>
  )
}
