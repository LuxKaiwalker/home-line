// J1h: the Mission Planer's leg routing off the main thread. The message handler, kept free of any
// Worker API so it can be tested directly (legsRoute.test.ts); legsWorker.ts wires it to `self`.
// It routes with the SAME LegRouter (router.ts) and the SAME grade model (physio.ts gradeModel on the
// scenario's Params), so a leg routed here equals router.route on the main thread.
import { gradeModel, type Params } from './physio'
import { LegRouter, type Leg, type RouteGrid } from './router'

export type LegsRequest =
  | { type: 'init'; grid: RouteGrid; params: Params }
  | { type: 'route'; a: number; b: number }

export interface LegsReply {
  a: number
  b: number
  leg: Leg | null
}

export interface LegsState {
  router: LegRouter | null
}

/** Handle one request: 'init' builds the router; 'route' returns the leg (null = no route). */
export function handleLegsMessage(state: LegsState, msg: LegsRequest): LegsReply | null {
  if (msg.type === 'init') {
    state.router = new LegRouter(msg.grid, gradeModel(msg.params))
    return null
  }
  if (!state.router) throw new Error('legs worker: route before init')
  return { a: msg.a, b: msg.b, leg: state.router.route(msg.a, msg.b) }
}
