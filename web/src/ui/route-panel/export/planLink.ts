// PORT U4: links into the Plan view (Notion "Port Mission Planer into Plan" §2.7). Router wiring is I1's
// (requests-I1.md, "U4"): it calls applyPlanLink(location.hash) on load and on hashchange, before
// redirectFor. Format and parsing are state/planningUrl.ts (one place); this file decides what to do:
//   #/mission?plan=<v1>[&add=S]  legacy Mission link   -> replace the hash with #/?route=<v2>[&add=S], then load
//   #/mission?add=S              legacy "Add to route" -> #/?add=S, then add S to the current plan
//   #/?route=<v2>[&add=S]        share link            -> planning.replace(doc [+ S]): no undo step, history cleared
//   #/?add=S                     add S to the plan on screen (one undo step, like the station card's link)
//   unreadable route / plan      -> notice, nothing loaded, the plan on screen stays; never throws
// After a legacy or add link the hash is replaced by the plan's canonical href (add= dropped, so a
// reload adds nothing); a plain #/?route= link stays as it is (other hash params survive).
import { signal, type ReadSignal } from '../../../state/signal'
import { addStopTo, encodeRouteParam, legacyRedirect, parsePlanningHash, planning, planningHref, type PlanningDoc, type PlanningStore } from '../../../state/planning'
import { copyFrom } from '../../copy'
import own from './copy.export.json'

const c = copyFrom(own)

export type PlanLinkResolution =
  /** not a Plan / Mission hash, or a Plan hash with nothing to load */
  | { kind: 'none' }
  /** legacy Mission link: replace the hash with `to` (history.replaceState), then resolve `to` */
  | { kind: 'redirect'; to: string; invalid: boolean }
  /** load `doc` (null = keep the plan on screen) and append station `add` (null = none) */
  | { kind: 'load'; doc: PlanningDoc | null; add: string | null }
  /** the link's route could not be read */
  | { kind: 'invalid' }

/** What a hash asks of the Plan view. Pure; never throws. */
export function resolvePlanLink(hash: string): PlanLinkResolution {
  let l: ReturnType<typeof parsePlanningHash>
  try {
    l = parsePlanningHash(hash)
  } catch {
    return { kind: 'invalid' }
  }
  if (!l) return { kind: 'none' }
  if (l.legacy) return { kind: 'redirect', to: legacyRedirect(hash) ?? '#/', invalid: l.invalid }
  if (l.invalid) return { kind: 'invalid' }
  if (!l.doc && !l.add) return { kind: 'none' }
  return { kind: 'load', doc: l.doc, add: l.add }
}

export interface PlanLinkIO {
  /** replace the address hash without a history entry or a hashchange (history.replaceState) */
  replaceHash(hash: string): void
  /** tell the user (the notice below by default) */
  notify(n: PlanLinkNotice): void
}

export interface PlanLinkNotice {
  kind: 'error' | 'info'
  text: string
}

const notice = signal<PlanLinkNotice | null>(null)
/** The last link notice (I1 / the export section show it); clearPlanLinkNotice() hides it. */
export const planLinkNotice: ReadSignal<PlanLinkNotice | null> = notice
export const clearPlanLinkNotice = (): void => void (notice.value = null)

export const browserLinkIO: PlanLinkIO = {
  replaceHash(hash) {
    if (typeof history === 'undefined' || typeof location === 'undefined') return
    if (location.hash !== hash) history.replaceState(history.state, '', hash)
  },
  notify(n) {
    notice.value = n
  },
}

export type PlanLinkOutcome = 'none' | 'loaded' | 'added' | 'invalid'

const sameRoute = (a: PlanningDoc, b: PlanningDoc) => a.padId === b.padId && encodeRouteParam(a) === encodeRouteParam(b)

/**
 * Apply a hash to the planning store (on load and on hashchange). Returns what happened; the hash
 * left in the address is canonical afterwards for a legacy, add or invalid link.
 */
export function applyPlanLink(hash: string, store: PlanningStore = planning, io: PlanLinkIO = browserLinkIO): PlanLinkOutcome {
  let res = resolvePlanLink(hash)
  let invalid = false
  let redirected = false
  if (res.kind === 'redirect') {
    io.replaceHash(res.to)
    invalid = res.invalid
    redirected = true
    res = resolvePlanLink(res.to)
  }
  if (invalid || res.kind === 'invalid') {
    io.notify({ kind: 'error', text: c('link.invalid') })
    io.replaceHash(planningHref(store.doc.peek()))
    return 'invalid'
  }
  if (res.kind !== 'load') return 'none'
  const cur = store.doc.peek()
  let outcome: PlanLinkOutcome
  if (res.doc) {
    const next = res.add ? { ...res.doc, route: addStopTo(res.doc.route, { kind: 'station', station: res.add }) } : res.doc
    // the address already shows the plan on screen (our own URL sync, Back/Forward to it): keep the history
    if (!sameRoute(cur, next)) store.replace(next)
    outcome = 'loaded'
  } else {
    store.addStop({ kind: 'station', station: res.add! })
    outcome = 'added'
  }
  const canonical = planningHref(store.doc.peek())
  if (redirected || res.add) io.replaceHash(canonical)
  return outcome
}
