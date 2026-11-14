// Live layer entry (WS13, F23). Loaded only through a dynamic import behind VITE_LIVE, so with the
// flag off none of this is in the bundle path and no static view depends on it (kit rule 4).
//
// Mount point (owned by WS5/C, not added here), one line in src/main.ts after `app` exists:
//   if (import.meta.env.VITE_LIVE === '1') void import('./live').then((m) => m.mountLive(app.querySelector('.topbar')!))
//
// Public API for the live views (and WS18, D54); keep it small:
//   createApiClient(opts?)            typed client for openapi.yaml (client.ts)
//   checkHealth / watchHealth         2 s health check -> LiveState; bannerFor(state) (health.ts)
//   startJob(client, req, callbacks)  submit + poll with backoff, staged callbacks, cancel() (jobs.ts)
//   liveLoader(resultBase)            the existing contract-checking loader on a live result (result.ts)
//   LIVE_LABEL, OFFLINE_LABEL         labels from config/backend.yaml (config.ts)
//   padTool(panel, port)              F24 pad tool: validate, instant preview, staged full plan (padmount.tsx)
//   consoleMapPort(cmap, restore?)    MapPort over the console map (mapPort.ts)
//   mountPlanRoute(app, opts)         #/plan, #/plan/{hash}[/provenance|/play] (F28, F35); started by mountLive
//   loadPlan, importPlanFile          permalink load and plan_inputs.json import (plan.ts)
//   exportPlanInputs, canonicalJson   JSON export (planio.ts)
//
// Pad tool mount (owned by WS5/C, not added here), in views/console.tsx after `cmap` exists, behind the
// same VITE_LIVE guard:
//   if (import.meta.env.VITE_LIVE === '1') void import('../live').then((m) => m.padTool(panelEl, m.consoleMapPort(cmap)))
import './live.css'
import { createApiClient, type ApiClient, type FetchLike } from './client'
import { dataUrl } from '../env'
import { SIM_EXPORT_ENABLED } from './config'
import { bannerFor, watchHealth, type LiveState } from './health'
import type { MapPort } from './mapPort'
import { MOCK_OFFICIAL_HASH } from './mock/hashes'
import { mountPadTool } from './padmount'
import { mountPlanRoute, resultDataUrl } from './planmount'
import { mockLiveLoader } from './result'

export { ApiError, createApiClient, type ApiClient, type ApiClientOptions } from './client'
export { API_BASE, LIVE_ENABLED, LIVE_LABEL, OFFLINE_LABEL, WARMING_LABEL } from './config'
export { bannerFor, checkHealth, watchHealth, type Banner, type LiveState } from './health'
export { startJob, type JobCallbacks, type JobHandle, type JobOptions, type JobOutcome } from './jobs'
export { liveLoader } from './result'
export { consoleMapPort, type ConsoleMapLike, type MapPort } from './mapPort'
export { createPadTool, type PadTool, type PadToolState } from './padtool'
export { mountPadTool } from './padmount'
export { loadStage, type StageResult } from './stage'
export { importPlanFile, loadPlan, parsePlanRoute, planUrl, type ImportState, type PlanLoad, type PlanRoute } from './plan'
export { canonicalJson, checkPlanInputsText, exportPlanInputs } from './planio'
export { mountPlanRoute, playPlan, type PlanRouteOptions } from './planmount'
export { simPlanFiles, SimSlot } from './simslot'
export type * from './types'

// Dev mock: the flag is compared inline so Vite folds it and, when off, drops the mock chunk.
const USE_MOCK = import.meta.env.VITE_LIVE_MOCK === '1' || import.meta.env.VITE_LIVE_MOCK === 'true'
let mockFetch: Promise<FetchLike> | undefined
/** Dev mock: the official hash serves the app's own static data tree (the precomputed official plan). */
const staticTree = async (path: string): Promise<string | null> => {
  const res = await fetch(dataUrl(path))
  return res.ok ? res.text() : null
}
const lazyMockFetch: FetchLike = async (input, init) => {
  const f = await (mockFetch ??= import('./mock/fetch').then((m) => m.createMockFetch({ trees: { [MOCK_OFFICIAL_HASH]: staticTree } })))
  return f(input, init)
}

let shared: ApiClient | undefined
/** The app-wide client: VITE_API_BASE, or the contract-example mock with VITE_LIVE_MOCK=1. */
export function liveClient(): ApiClient {
  return (shared ??= createApiClient(USE_MOCK ? { fetch: lazyMockFetch } : {}))
}

let current: LiveState = { kind: 'checking' }
const listeners = new Set<(s: LiveState) => void>()
/** Latest health state; live views subscribe to show or hide their controls. Returns unsubscribe. */
export function onLiveState(fn: (s: LiveState) => void): () => void {
  listeners.add(fn)
  fn(current)
  return () => listeners.delete(fn)
}

/**
 * Insert the live status line after `anchor` and start the health check. The line shows the
 * offline or warming text and is hidden once the engine is ready. Returns a cleanup function.
 */
export function mountLive(anchor: Element, client: ApiClient = liveClient()): () => void {
  const line = document.createElement('p')
  line.className = 'live-status'
  line.setAttribute('role', 'status')
  line.hidden = true
  anchor.after(line)
  // #/plan routes (F28, F35): only when the app shell's .outlet is next to the anchor.
  const app = (anchor as Partial<Element>).parentElement
  const stopPlan = app && typeof window !== 'undefined' ? planRoute(app, client) : () => {}
  const stop = watchHealth(client, (s) => {
    current = s
    const b = bannerFor(s)
    line.hidden = b.text === null
    line.textContent = b.text ?? ''
    line.dataset.tone = b.tone
    line.dataset.state = s.kind
    for (const fn of listeners) fn(s)
  })
  return () => {
    stop()
    stopPlan()
    line.remove()
  }
}

/** The plan routes on `client`; with VITE_LIVE_MOCK the HUD reads the official tree from the static data. */
function planRoute(app: HTMLElement, client: ApiClient): () => void {
  return mountPlanRoute(app, {
    client,
    simEnabled: SIM_EXPORT_ENABLED,
    ...(USE_MOCK
      ? { loaderFor: mockLiveLoader(lazyMockFetch), hudDataUrl: (l) => (l.hash === MOCK_OFFICIAL_HASH ? (p: string) => dataUrl(p) : resultDataUrl(l.base)) }
      : {}),
  })
}

/**
 * The pad tool (F24) in `panel`, on the app-wide client and health state. Its controls show only
 * while the engine is ready (U1's banner covers offline and warming). Returns cleanup.
 */
export function padTool(panel: Element, port: MapPort, client: ApiClient = liveClient()): () => void {
  return mountPadTool(panel, port, { client, onLiveState, ...(USE_MOCK ? { loaderFor: mockLiveLoader(lazyMockFetch) } : {}) }).cleanup
}
