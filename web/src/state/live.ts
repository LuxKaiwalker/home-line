// Live-planner status seam (L7b, D111). Static views must not import src/live (kit rule 6), yet some
// of them must say the truth about the live planner (the rover drag readout, U15). The live layer
// reports its health state here; until it does (static build, or before the first /health answer)
// the status is 'off'.
//
//   off        no live layer in this build, or it has not reported yet
//   checking   first /health request pending
//   offline    /health unreachable, not ok or invalid (the offline banner shows)
//   warming    the engine is warming up
//   ready      the engine answers: live controls (pad tool, compute) are shown
//
// The live layer sets it with one line in its health watch (src/live/index.ts mountLive), either
//   liveStatus.value = s.kind
// or, without importing this module, through the window event below:
//   window.dispatchEvent(new CustomEvent('hl:live-status', { detail: s.kind }))
import { signal } from './signal'

export const LIVE_STATUSES = ['off', 'checking', 'offline', 'warming', 'ready'] as const
export type LiveStatus = (typeof LIVE_STATUSES)[number]

export const liveStatus = signal<LiveStatus>('off')

/** Window event that sets liveStatus (detail: a LiveStatus). Unknown details are ignored. */
export const LIVE_STATUS_EVENT = 'hl:live-status'

export const isLiveStatus = (v: unknown): v is LiveStatus => typeof v === 'string' && (LIVE_STATUSES as readonly string[]).includes(v)

/** Follow LIVE_STATUS_EVENT on `win` (the shell installs it). Returns dispose. */
export function listenLiveStatus(win: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>): () => void {
  const on = (e: Event) => {
    const d = (e as CustomEvent<unknown>).detail
    if (isLiveStatus(d)) liveStatus.value = d
  }
  win.addEventListener(LIVE_STATUS_EVENT, on)
  return () => win.removeEventListener(LIVE_STATUS_EVENT, on)
}
