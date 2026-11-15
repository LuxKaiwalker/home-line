// J1h: Web Worker entry for the Mission Planer's leg routing (see legsRoute.ts).
import { handleLegsMessage, type LegsRequest, type LegsState } from './legsRoute'

const state: LegsState = { router: null }
const scope = self as unknown as { onmessage: ((e: MessageEvent<LegsRequest>) => void) | null; postMessage(m: unknown): void }
scope.onmessage = (e) => {
  const out = handleLegsMessage(state, e.data)
  if (out) scope.postMessage(out)
}
