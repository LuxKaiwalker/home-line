// Health check and the live/offline state (F23, kit rule 4). /health must answer ok within
// api.health_timeout_s (2 s) or the app stays static and shows OFFLINE_LABEL in place of the live
// controls. While engine_warm is false the state is 'warming' and the check repeats.
import type { ApiClient } from './client'
import { CLIENT, HEALTH_TIMEOUT_MS, OFFLINE_LABEL, WARMING_LABEL } from './config'
import type { Health } from './types'

export type OfflineReason = 'timeout' | 'unreachable' | 'not-ok' | 'invalid'

export type LiveState =
  | { kind: 'checking' }
  | { kind: 'offline'; reason: OfflineReason }
  | { kind: 'warming'; health: Health }
  | { kind: 'ready'; health: Health }

function isHealth(v: unknown): v is Health {
  if (!v || typeof v !== 'object') return false
  const h = v as Record<string, unknown>
  return (
    typeof h.ok === 'boolean' &&
    typeof h.engine_warm === 'boolean' &&
    typeof h.queue_length === 'number' &&
    (h.heavy_jobs === 'on' || h.heavy_jobs === 'off')
  )
}

/** One health check: never takes longer than timeoutMs, never throws. */
export async function checkHealth(client: ApiClient, timeoutMs = HEALTH_TIMEOUT_MS, signal?: AbortSignal): Promise<LiveState> {
  let h: unknown
  try {
    h = await client.health({ timeoutMs, signal })
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === 'timeout') return { kind: 'offline', reason: 'timeout' }
    // An HTTP error answer (5xx, 404 ...) is a not-ok server; no answer at all is unreachable.
    const status = (e as { status?: number }).status ?? 0
    return { kind: 'offline', reason: status > 0 ? 'not-ok' : 'unreachable' }
  }
  if (!isHealth(h)) return { kind: 'offline', reason: 'invalid' }
  if (!h.ok) return { kind: 'offline', reason: 'not-ok' }
  return h.engine_warm ? { kind: 'ready', health: h } : { kind: 'warming', health: h }
}

export interface WatchOptions {
  timeoutMs?: number
  /** Re-check interval while warming (default CLIENT.warmPollMs). */
  warmPollMs?: number
}

/**
 * Check health now and again every warmPollMs while the engine is warming; stops at 'ready' or
 * 'offline' (a page reload checks again). Returns a stop function (call it on unmount).
 */
export function watchHealth(client: ApiClient, onState: (s: LiveState) => void, opts: WatchOptions = {}): () => void {
  const ctl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = async () => {
    const s = await checkHealth(client, opts.timeoutMs ?? HEALTH_TIMEOUT_MS, ctl.signal)
    if (ctl.signal.aborted) return
    onState(s)
    if (s.kind === 'warming') timer = setTimeout(run, opts.warmPollMs ?? CLIENT.warmPollMs)
  }
  onState({ kind: 'checking' })
  void run()
  return () => {
    ctl.abort()
    clearTimeout(timer)
  }
}

export interface Banner {
  /** Banner text, or null when no banner is shown. */
  text: string | null
  tone: 'muted' | 'warn' | 'ok'
  /** Live controls (pad tool, compute) are shown only when the engine is ready. */
  controls: boolean
  /** Heavy jobs (POST /jobs) are allowed: false when the kill switch HL_HEAVY_JOBS_OFF is on. */
  heavyJobs: boolean
}

export function bannerFor(s: LiveState): Banner {
  switch (s.kind) {
    case 'checking':
      return { text: null, tone: 'muted', controls: false, heavyJobs: false }
    case 'offline':
      return { text: OFFLINE_LABEL, tone: 'muted', controls: false, heavyJobs: false }
    case 'warming':
      return { text: WARMING_LABEL, tone: 'warn', controls: false, heavyJobs: false }
    case 'ready':
      return { text: null, tone: 'ok', controls: true, heavyJobs: s.health.heavy_jobs === 'on' }
  }
}
