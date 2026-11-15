// PORT W0a: pad environment service API (owner after W0a: P1). The functions delegate to the active
// service; P1 replaces `stubService` with the real one (cache, prefetch). Tests: setPadService(createMockPadService()).
import { signal } from '../state/signal'
import type { LoadPadOptions, PadEnv, PadId, PadInfo, PadLoadState, PadService } from './types'

export * from './types'

const notImplemented = (what: string) => new Error(`pads: ${what} not implemented yet (P1)`)

/** Until P1 lands: an empty list, and loads reject (callers keep the official plan as today). */
const stubService: PadService = {
  loadPadIndex: () => Promise.reject(notImplemented('loadPadIndex')),
  listPads: () => [],
  loadPadEnv: () => Promise.reject(notImplemented('loadPadEnv')),
  peekPadEnv: () => undefined,
  prefetchPads: () => {},
  loadState: signal<Readonly<Record<PadId, PadLoadState>>>({}),
}

let service: PadService = stubService

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
