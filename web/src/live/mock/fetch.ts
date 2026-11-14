// Fetch stub that answers like the live API from the mock fixtures (no msw, no dependency). Used by
// the vitest suites and, with VITE_LIVE_MOCK=1, as a tiny in-browser dev mock (index.ts).
import { API_PREFIX } from '../config'
import type { ApiErrorBody, Health, Job, LonLat, PadCheck, PadScreen, PlanInputs } from '../types'
import { HEALTH_WARM, jobScript, RUN_RECORD_LIVE } from './fixtures'
import { mockPadCheck, mockPadScreen } from './pads'
import { mockResultFile } from './result'

/**
 * Health behaviour: a Health body, a list of bodies served in turn (the last repeats), 'hang'
 * (never answers; only an abort ends it), 'down' (network error) or an HTTP error status.
 */
export type MockHealth = Health | Health[] | 'hang' | 'down' | { status: number }

export interface MockOptions {
  health?: MockHealth
  /** POST /jobs answers job[0]; each GET /jobs/{id} answers the next one (the last repeats). */
  job?: Job[]
  /** Answer POST /jobs with this HTTP error (e.g. 429 rate limited). */
  submitError?: { status: number; body: ApiErrorBody; retryAfter?: number }
  /** POST /pads/validate answer (default mockPadCheck: refused north of a latitude, else valid). */
  validate?: PadCheck | ((pad: LonLat) => PadCheck)
  /** POST /pads/screen answer (default mockPadScreen for the request's pad). */
  screen?: PadScreen | ((inputs: PlanInputs) => PadScreen)
  /** Answer POST /pads/* with this HTTP error instead (e.g. 503). */
  padError?: { status: number; body: ApiErrorBody }
  /**
   * GET /results/{hash}/{path}: the file once `stagesDone` (of the job state served last) have
   * finished, or null (404). Default: the staged mock tree (result.ts).
   */
  resultFile?: (path: string, stagesDone: readonly string[]) => unknown | null
}

function isLonLat(v: unknown): v is LonLat {
  const o = v as Record<string, unknown> | null
  return !!o && typeof o === 'object' && typeof o.lon === 'number' && typeof o.lat === 'number' && Object.keys(o).length === 2
}

export interface MockCall {
  method: string
  path: string
  body: unknown
}

export type MockFetch = ((input: string, init?: RequestInit) => Promise<Response>) & { calls: MockCall[] }

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

const notFound = (path: string) => json(404, { error: 'not_found', detail: path } satisfies ApiErrorBody)

function hang(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
  })
}

export function createMockFetch(opts: MockOptions = {}): MockFetch {
  const health = opts.health ?? HEALTH_WARM
  const script = opts.job ?? jobScript()
  let healthIdx = 0
  let jobIdx = 0
  const calls: MockCall[] = []

  const fn = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const method = (init.method ?? 'GET').toUpperCase()
    const url = new URL(input, 'http://mock.invalid')
    const i = url.pathname.indexOf(`${API_PREFIX}/`)
    const path = i >= 0 ? url.pathname.slice(i + API_PREFIX.length) : url.pathname
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
    calls.push({ method, path, body })

    if (method === 'GET' && path === '/health') {
      if (health === 'hang') return hang(init.signal)
      if (health === 'down') throw new TypeError('Failed to fetch')
      if (Array.isArray(health)) return json(200, health[Math.min(healthIdx++, health.length - 1)])
      if ('status' in health) return json(health.status, { error: 'unavailable' } satisfies ApiErrorBody)
      return json(200, health)
    }
    if (method === 'POST' && path === '/jobs') {
      if (opts.submitError) {
        const { status, body: eb, retryAfter } = opts.submitError
        return json(status, eb, retryAfter ? { 'Retry-After': String(retryAfter) } : {})
      }
      jobIdx = 0
      return json(202, script[0])
    }
    const jm = /^\/jobs\/([^/]+)$/.exec(path)
    if (method === 'GET' && jm) {
      if (decodeURIComponent(jm[1]) !== script[0].id) return notFound(path)
      jobIdx = Math.min(jobIdx + 1, script.length - 1)
      return json(200, script[jobIdx])
    }
    if (method === 'POST' && (path === '/pads/validate' || path === '/pads/screen')) {
      if (opts.padError) return json(opts.padError.status, opts.padError.body)
      if (path === '/pads/validate') {
        if (!isLonLat(body)) return json(422, { error: 'invalid_input', detail: 'body must be LonLat {lon, lat}' } satisfies ApiErrorBody)
        const v = opts.validate ?? mockPadCheck
        return json(200, typeof v === 'function' ? v(body) : v)
      }
      const pad = (body as { pad?: unknown } | null)?.pad as Record<string, unknown> | undefined
      if (!pad || typeof pad.lon !== 'number' || typeof pad.lat !== 'number') {
        return json(422, { error: 'invalid_input', detail: 'plan_inputs.pad {lon, lat} is required' } satisfies ApiErrorBody)
      }
      const sc = opts.screen ?? ((inp: PlanInputs) => mockPadScreen(inp.pad as LonLat))
      return json(200, typeof sc === 'function' ? sc(body as PlanInputs) : sc)
    }
    if (method === 'GET' && /^\/results\/[0-9a-f]{16}\/provenance$/.test(path)) return json(200, RUN_RECORD_LIVE)
    const rm = /^\/results\/([0-9a-f]{16})\/(.+)$/.exec(path)
    if (method === 'GET' && rm) {
      const job = script[jobIdx]
      if (rm[1] !== job.hash) return notFound(path)
      const doc = (opts.resultFile ?? mockResultFile)(decodeURIComponent(rm[2]), job.stages_done)
      return doc === null ? notFound(path) : json(200, doc)
    }
    return notFound(path)
  }
  return Object.assign(fn, { calls })
}
