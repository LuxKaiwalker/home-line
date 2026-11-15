// Pad environment service API (W0a; P1: the real service, pads/service.ts + pads/load.ts). The functions
// delegate to the active service. Tests: setPadService(createMockPadService()) from pads/mock.ts.
import { subscribePlanning } from '../state/planning'
import { t } from '../ui/copy'
import { createPadService, type RealPadService } from './service'
import type { LoadPadOptions, PadEnv, PadId, PadInfo, PadLoadState, PadService, PlanProducts } from './types'

export * from './types'

/** A plan edit within this long counts as "editing": the idle prefetch waits (never during an edit). */
export const EDIT_QUIET_MS = 1500
let lastEdit = -Infinity
let watching = false
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
/** true while the viewer edits the plan (a planning doc change in the last EDIT_QUIET_MS) */
export function editingNow(): boolean {
  if (!watching) {
    watching = true
    subscribePlanning((s) => s.route, () => void (lastEdit = clock()))
    subscribePlanning((s) => s.padId, () => void (lastEdit = clock()))
  }
  return clock() - lastEdit < EDIT_QUIET_MS
}

/** The app's service (P1): LRU cache, dedupe, abort, idle prefetch, load states. */
const realService: RealPadService = createPadService({ busy: editingNow })

let service: PadService = realService

/** Swap the service (tests, P1's real one). Returns a restore function. */
export function setPadService(s: PadService): () => void {
  const prev = service
  service = s
  return () => void (service = prev)
}
export const padService = (): PadService => service

export const loadPadIndex = (): Promise<PadInfo[]> => service.loadPadIndex()
export const listPads = (): PadInfo[] => service.listPads()
export const loadPadEnv = (padId: PadId, opts?: LoadPadOptions): Promise<PadEnv> => service.loadPadEnv(padId, opts)
export const peekPadEnv = (padId: PadId): PadEnv | undefined => service.peekPadEnv(padId)
export const prefetchPads = (ids: readonly PadId[]): void => service.prefetchPads(ids)
export const padLoadState = () => service.loadState

/**
 * Plan products of any pad, also one without routing fields (pad_default: loadPadEnv rejects it with
 * PadError 'no-routing-fields'). Other services (mocks): through loadPadEnv.
 */
export function loadPadPlanProducts(padId: PadId): Promise<PlanProducts> {
  const s = service as Partial<RealPadService>
  return typeof s.planProductsOf === 'function' ? s.planProductsOf(padId) : service.loadPadEnv(padId).then((e) => e.planProducts())
}

/** The status line of a pad: "Loading pad P3…" while it loads, the error line after a failure, else null. */
export function padStatusText(info: Pick<PadInfo, 'label'>, s: PadLoadState | undefined): string | null {
  if (s?.state === 'loading') return t('route.pads.loading', { pad: info.label })
  if (s?.state === 'error') return t('route.pads.error', { pad: info.label })
  return null
}

export { createPadService, type PadServiceDeps, type RealPadService } from './service'
export { isAbortError, PadError } from './load'
