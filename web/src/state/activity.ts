// L7c (D111): the one activity store every player and editor reads.
//
//   players   intro (the descent intro and the kiosk loop), replay (the mission clock playing),
//             flythrough. One at a time: starting one stops the one running, through the stop
//             function it registered (synchronously, before the new one starts).
//   storm     a setting the replay honours (mission.conditions.storm), never a player.
//   editing   noteEdit(): a plan edit (pad drag, proposed change) stops the running player.
//   mode      a mode switch (ui.mode changes from one mode to another) stops the running player.
//   job       one compute job per viewer (beginJob/endJob). While it runs no player starts (its
//             partial result is not replayable); changing its inputs asks first (confirmInputChange).
//
// Controls read enabled/reason from controlState(kind) (reason = copy key under activity.*, shown as
// the tooltip of the disabled control). Small and dependency-light (signals + ui only): the mission
// clock is wired in activityClock.ts, so the shell can import this without the config YAML.
// <html data-activity="none|intro|replay|flythrough" data-job="none|<id>"> mirrors the state for tests
// and review.
import { t, type CopyKey } from '../ui/copy'
import { computed, signal, type ReadSignal } from './signal'
import { ui, type Mode } from './ui'

export type Player = 'intro' | 'replay' | 'flythrough'
export const PLAYERS: readonly Player[] = ['intro', 'replay', 'flythrough']

/** Why something was refused: a copy key under activity.* */
export type ActivityReason = Extract<CopyKey, `activity.reason.${string}`>
export interface Verdict {
  ok: boolean
  reason?: ActivityReason
}
const OK: Verdict = { ok: true }

interface Running {
  kind: Player
  stop: () => void
}
interface Job {
  id: string
  cancel?: () => void
}

const current = signal<Player | null>(null)
const job = signal<Job | null>(null)
let running: Running | null = null

/** Who stopped the last player (tests, review): the player that took over, 'edit', 'mode', 'job', 'stop'. */
export const lastStop = signal<{ kind: Player; by: Player | 'edit' | 'mode' | 'job' | 'stop' } | null>(null)

export const activity = {
  /** the player running now; null = none */
  current: current as ReadSignal<Player | null>,
  /** the compute job of this viewer; null = none */
  job: computed(() => job.value?.id ?? null),
  jobActive: computed(() => job.value !== null),
} as const

function mirror(): void {
  const d = typeof document === 'undefined' ? undefined : document.documentElement?.dataset
  if (!d) return
  d.activity = current.peek() ?? 'none'
  d.job = job.peek()?.id ?? 'none'
}

/**
 * May `kind` start now? Reads signals (.value), so a computed / effect around it follows the store.
 *  - a compute job runs: no player (its partial result is not replayable)
 *  - the intro never takes over a player the viewer started (it only plays on its own at load)
 */
export function canStart(kind: Player): Verdict {
  if (job.value) return { ok: false, reason: 'activity.reason.jobRunning' }
  const cur = current.value
  if (kind === 'intro' && cur !== null && cur !== 'intro') return { ok: false, reason: 'activity.reason.busy' }
  return OK
}

/** Enabled / pressed / tooltip reason of a player's control (copy text, '' when enabled). */
export interface ControlState {
  enabled: boolean
  running: boolean
  reason: ActivityReason | null
  title: string
}
export function controlState(kind: Player): ControlState {
  const run = current.value === kind
  // a running player can always be stopped by its own control
  const v = run ? OK : canStart(kind)
  return { enabled: v.ok, running: run, reason: v.reason ?? null, title: v.reason ? t(v.reason) : '' }
}
/** controlState as a signal (one per kind, shared). */
const states = new Map<Player, ReadSignal<ControlState>>()
export function controlSignal(kind: Player): ReadSignal<ControlState> {
  let s = states.get(kind)
  if (!s) states.set(kind, (s = computed(() => controlState(kind))))
  return s
}

function stopRunning(by: NonNullable<ReturnType<typeof lastStop.peek>>['by']): void {
  const r = running
  if (!r) return
  running = null
  current.value = null
  mirror()
  lastStop.value = { kind: r.kind, by }
  r.stop()
}

/**
 * Start `kind`: refused (nothing changes) when canStart says no; otherwise the running player is
 * stopped first (its stop runs synchronously), then `kind` is the current player. `stop` is how the
 * store stops it later (another player, an edit, a mode switch, a job).
 */
export function start(kind: Player, stop: () => void): Verdict {
  watchMode()
  const v = canStart(kind)
  if (!v.ok) return v
  if (running && running.stop !== stop) stopRunning(kind)
  running = { kind, stop }
  current.value = kind
  mirror()
  return OK
}

/** The player ended on its own (end of the run, its own control). No-op when `stop` is not the running one. */
export function end(kind: Player, stop?: () => void): void {
  if (!running || running.kind !== kind || (stop && running.stop !== stop)) return
  running = null
  current.value = null
  mirror()
}

/** Stop whatever plays (or only `kind`). */
export function stop(kind?: Player, by: 'edit' | 'mode' | 'job' | 'stop' = 'stop'): void {
  if (running && (!kind || running.kind === kind)) stopRunning(by)
}

/** A plan edit began (pad drag, proposed change, route edit): editing stops the running player. */
export function noteEdit(): void {
  stop(undefined, 'edit')
}

// ---- mode switch ---------------------------------------------------------------------------------
let modeWatched = false
let lastMode: Mode | undefined
function watchMode(): void {
  if (modeWatched) return
  modeWatched = true
  lastMode = ui.mode.peek()
  ui.mode.subscribe((m) => {
    const prev = lastMode
    lastMode = m
    if (prev !== undefined && m !== undefined && m !== prev) stop(undefined, 'mode')
  })
}

// ---- compute job (seams for src/live; ticket notes/L7c-ticket.md) -------------------------------
/**
 * A compute job of this viewer begins. One job per viewer: another job running refuses it (reason
 * activity.reason.jobBusy); the same id again is fine. The running player stops (the job's result
 * will change the plan under it). `cancel` is how the store cancels it when the viewer confirms an
 * input change mid-job.
 */
export function beginJob(id: string, o: { cancel?: () => void } = {}): Verdict {
  watchMode()
  const j = job.peek()
  if (j && j.id !== id) return { ok: false, reason: 'activity.reason.jobBusy' }
  job.value = { id, cancel: o.cancel ?? j?.cancel }
  stop(undefined, 'job')
  mirror()
  return OK
}

/** The job ended (result ready, error, or cancelled). No-op for another id. */
export function endJob(id: string): void {
  if (job.peek()?.id !== id) return
  job.value = null
  mirror()
}

type Confirm = (message: string) => boolean
const defaultConfirm: Confirm = (m) => (typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(m) : false)
let confirmFn: Confirm = defaultConfirm
/** Tests: replace the question (null = the browser's confirm). */
export function setConfirm(fn: Confirm | null): void {
  confirmFn = fn ?? defaultConfirm
}

/**
 * Call before changing a job's inputs (pad, scenario, budget, dwell, storm). No job: true. A job
 * running: asks; yes cancels the job (its cancel, then endJob) and returns true; no returns false
 * and nothing may change.
 */
export function confirmInputChange(): boolean {
  const j = job.peek()
  if (!j) return true
  if (!confirmFn(t('activity.confirm.inputChange'))) return false
  j.cancel?.()
  endJob(j.id)
  return true
}

/** Tests only: back to the initial state. */
export function resetActivity(): void {
  running = null
  current.value = null
  job.value = null
  lastStop.value = null
  confirmFn = defaultConfirm
  lastMode = ui.mode.peek()
  mirror()
}
