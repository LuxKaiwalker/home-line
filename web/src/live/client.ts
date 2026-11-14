// Typed client for the live API (contracts/backend/openapi.yaml v1.0.1). Small on purpose (brief
// rule D54: WS18 builds on it): one function per endpoint the live views use, every request with
// a timeout, errors as ApiError. Jobs are submit + poll (jobs.ts); no request is held open.
import { API_BASE, API_PREFIX, CLIENT } from './config'
import type { ApiErrorBody, EngineVersion, Health, ImportResult, Job, JobRequest, LonLat, PadCheck, PadScreen, PlanInputs } from './types'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** status 0 = no HTTP answer (code 'timeout', 'network' or 'aborted'). */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly detail: unknown
  readonly retryAfterS: number | null
  constructor(status: number, code: string, message: string, detail: unknown = null, retryAfterS: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
    this.retryAfterS = retryAfterS
  }
  /** Worth another try later: no answer, or a 5xx / 429. */
  get transient(): boolean {
    return (this.status === 0 && this.code !== 'aborted') || this.status === 429 || this.status >= 500
  }
}

export interface ApiClientOptions {
  /** API origin (default VITE_API_BASE); api.prefix is appended. */
  base?: string
  /** fetch implementation (default the global fetch; tests and the dev mock pass createMockFetch()). */
  fetch?: FetchLike
  /** Per-request timeout (default CLIENT.requestTimeoutMs). */
  requestTimeoutMs?: number
}

export interface RequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export interface ApiClient {
  /** API origin without the prefix, e.g. http://localhost:8000 */
  readonly base: string
  /** base + api.prefix, e.g. http://localhost:8000/api/v1 */
  readonly root: string
  health(opts?: RequestOptions): Promise<Health>
  engineVersion(opts?: RequestOptions): Promise<EngineVersion>
  validatePad(pad: LonLat, opts?: RequestOptions): Promise<PadCheck>
  screenPad(inputs: PlanInputs, opts?: RequestOptions): Promise<PadScreen>
  submitJob(req: JobRequest, opts?: RequestOptions): Promise<Job>
  getJob(id: string, opts?: RequestOptions): Promise<Job>
  importPlan(inputs: PlanInputs, opts?: RequestOptions): Promise<ImportResult>
  /** Absolute base URL of a result tree for the loader (dataUrl(path, mode, base)). */
  resultBase(job: Pick<Job, 'hash' | 'result_url'>): string
}

function retryAfter(res: Response, body: ApiErrorBody | null): number | null {
  if (body && typeof body.retry_after_s === 'number') return body.retry_after_s
  const h = Number(res.headers.get('Retry-After'))
  return Number.isFinite(h) && h > 0 ? h : null
}

export function createApiClient(opts: ApiClientOptions = {}): ApiClient {
  const base = (opts.base ?? API_BASE).replace(/\/+$/, '')
  const root = `${base}${API_PREFIX}`
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init))
  const defaultTimeout = opts.requestTimeoutMs ?? CLIENT.requestTimeoutMs

  async function request<T>(method: 'GET' | 'POST', path: string, body: unknown, ro: RequestOptions = {}): Promise<T> {
    const ctl = new AbortController()
    const outer = ro.signal
    if (outer?.aborted) throw new ApiError(0, 'aborted', `${method} ${path}: aborted`)
    const onOuterAbort = () => ctl.abort()
    outer?.addEventListener('abort', onOuterAbort, { once: true })
    const timeoutMs = ro.timeoutMs ?? defaultTimeout
    let timer: ReturnType<typeof setTimeout> | undefined
    // The race settles on time even if a fetch implementation ignores the abort signal.
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctl.abort()
        reject(new ApiError(0, 'timeout', `${method} ${path}: no answer in ${timeoutMs} ms`))
      }, timeoutMs)
      ctl.signal.addEventListener('abort', () => {
        if (outer?.aborted) reject(new ApiError(0, 'aborted', `${method} ${path}: aborted`))
      })
    })
    const init: RequestInit = { method, signal: ctl.signal, headers: { Accept: 'application/json' } }
    if (body !== undefined) {
      init.body = JSON.stringify(body)
      init.headers = { Accept: 'application/json', 'Content-Type': 'application/json' }
    }
    try {
      const res = await Promise.race([
        doFetch(`${root}${path}`, init).catch((e: unknown) => {
          if (outer?.aborted) throw new ApiError(0, 'aborted', `${method} ${path}: aborted`)
          if (e instanceof ApiError) throw e
          throw new ApiError(0, 'network', `${method} ${path}: ${e instanceof Error ? e.message : String(e)}`)
        }),
        deadline,
      ])
      const text = await Promise.race([res.text(), deadline])
      let json: unknown = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        throw new ApiError(res.status, 'parse', `${method} ${path}: answer is not JSON (HTTP ${res.status})`)
      }
      if (!res.ok) {
        const eb = json && typeof json === 'object' && typeof (json as ApiErrorBody).error === 'string' ? (json as ApiErrorBody) : null
        throw new ApiError(res.status, eb?.error ?? `http_${res.status}`, `${method} ${path}: HTTP ${res.status}${eb ? ` ${eb.error}` : ''}`, eb?.detail ?? null, retryAfter(res, eb))
      }
      return json as T
    } finally {
      clearTimeout(timer)
      outer?.removeEventListener('abort', onOuterAbort)
    }
  }

  return {
    base,
    root,
    health: (o) => request<Health>('GET', '/health', undefined, o),
    engineVersion: (o) => request<EngineVersion>('GET', '/engine/version', undefined, o),
    validatePad: (pad, o) => request<PadCheck>('POST', '/pads/validate', { lon: pad.lon, lat: pad.lat }, o),
    screenPad: (inputs, o) => request<PadScreen>('POST', '/pads/screen', inputs, o),
    submitJob: (req, o) => request<Job>('POST', '/jobs', req, o),
    getJob: (id, o) => request<Job>('GET', `/jobs/${encodeURIComponent(id)}`, undefined, o),
    importPlan: (inputs, o) => request<ImportResult>('POST', '/plans/import', inputs, o),
    resultBase(job) {
      // result_url is a server path (/api/v1/results/{hash}/); resolve it against the API origin.
      const rel = job.result_url ?? `${API_PREFIX}/results/${job.hash}/`
      return new URL(rel, `${base}/`).href.replace(/\/+$/, '')
    },
  }
}
