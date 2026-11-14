// Live layer settings (WS13, F23). Limits, labels and timeouts come from config/backend.yaml; the
// build flags and the API base URL are read here and nowhere else (kit rule 4: static first).
//
//   VITE_LIVE=1          turn the live layer on (default off: no live code in the bundle path)
//   VITE_API_BASE=<url>  origin of the live API, default http://localhost:8000 (api.prefix is appended)
//   VITE_LIVE_MOCK=1     dev only: answer API calls from the contract-example mock (mock/fetch.ts)
import backendRaw from '../../../config/backend.yaml'
import { cfg } from '../config'

function str(path: string): string {
  const v = cfg(backendRaw, path)
  if (typeof v !== 'string' || !v) throw new Error(`config/backend.yaml: ${path} is not a string`)
  return v
}

function posNum(path: string): number {
  const v = cfg(backendRaw, path)
  if (typeof v !== 'number' || !(v > 0)) throw new Error(`config/backend.yaml: ${path} is not a positive number`)
  return v
}

/** Kit rule 6: shown on every live view, with a link to the provenance view. */
export const LIVE_LABEL: string = str('labels.live')
/** Kit rule 4: replaces the live controls when /health is unreachable or not ok. */
export const OFFLINE_LABEL: string = str('labels.offline')
/** Shown while /health answers ok but engine_warm is false (Numba warm-up). Not in config: UI text only. */
export const WARMING_LABEL = 'Live planning is warming up · showing precomputed plans'

/** contract_version of the backend family (config/backend.yaml), written into plan_inputs the pad tool sends. */
export const BACKEND_CONTRACT_VERSION: string = str('contract_version')

/** api.prefix, e.g. /api/v1. */
export const API_PREFIX: string = str('api.prefix').replace(/\/+$/, '')
/** api.health_timeout_s in ms (F23: 2 s). */
export const HEALTH_TIMEOUT_MS: number = posNum('api.health_timeout_s') * 1000
/** compute.job_timeout_s in ms: the server's limit on one running job. */
export const JOB_TIMEOUT_MS: number = posNum('compute.job_timeout_s') * 1000

// Client-side tuning, not limits: config/backend.yaml has no key for them (assumed; proposed for
// a `web_live:` block owned by WS12). Every request stays far below the 95 s per-request cap
// (jobs are submit + poll, never a long-held request).
export const CLIENT = {
  /** One HTTP request (submit or poll) is aborted after this. */
  requestTimeoutMs: 15_000,
  /** Job poll backoff: first wait, growth factor, cap. */
  pollInitialMs: 500,
  pollFactor: 1.5,
  pollMaxMs: 5_000,
  /** Consecutive failed polls (network, timeout, 5xx) before the job is reported failed. */
  pollMaxErrors: 3,
  /** Health re-check interval while the engine is warming up. */
  warmPollMs: 3_000,
} as const

type EnvValue = string | boolean | undefined

/** VITE_LIVE parsing: '1' or 'true' turns the live layer on; anything else (or unset) is off. */
export function isLiveFlag(value: EnvValue): boolean {
  return value === true || value === '1' || value === 'true'
}

/** VITE_API_BASE parsing: trailing slashes dropped, default http://localhost:8000. */
export function apiBaseFrom(value: EnvValue): string {
  const v = typeof value === 'string' && value.trim() ? value.trim() : 'http://localhost:8000'
  return v.replace(/\/+$/, '')
}

export const LIVE_ENABLED: boolean = isLiveFlag(import.meta.env.VITE_LIVE)
export const API_BASE: string = apiBaseFrom(import.meta.env.VITE_API_BASE)
