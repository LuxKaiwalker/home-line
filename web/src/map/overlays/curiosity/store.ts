// L1b: Curiosity layer state (one per page session). The layer is OFF by default and sends NO request
// until the user turns it on (privacy: every request goes to mars.nasa.gov). Turning it on loads the
// drive ends + traverse once (session cache in nasa.ts); a failure is a visible "unavailable" state
// with a retry, never an exception into the map. Both the layer-popover toggle (Control.tsx) and the
// overlay handle (host.overlay('curiosity').setVisible) drive the same `curiosityOn` signal.
import { data } from '../../../data/loader'
import { closeContainer, openContainer, registerContainer } from '../../../ui/layout'
import { signal, type ReadSignal } from '../../../state/signal'
import { loadCuriosity, unavailableReason, type Bounds, type DriveEnd, type UnavailableReason } from './nasa'

export const CURIOSITY_ID = 'curiosity'
/** layout store id of the drive-end pop-up card */
export const CURIOSITY_CARD = 'curiosity-stop'

export type CuriosityStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; stops: DriveEnd[]; traverse: [number, number][][] }
  | { kind: 'unavailable'; reason: UnavailableReason }

/** Feature flag (OverlaySpec.enabled): false = the layer and its toggle are not offered at all. */
const enabledSig = signal(true)
const onSig = signal(false)
const statusSig = signal<CuriosityStatus>({ kind: 'idle' })
const selectedSig = signal<number | null>(null)

export const curiosityEnabled: ReadSignal<boolean> = enabledSig
export const curiosityOn: ReadSignal<boolean> = onSig
export const curiosityStatus: ReadSignal<CuriosityStatus> = statusSig
/** index into the ready stops of the drive end whose card is shown */
export const curiositySelected: ReadSignal<number | null> = selectedSig

export function setCuriosityEnabled(on: boolean): void {
  enabledSig.value = on
  if (!on) setCuriosityOn(false)
}

/** The map area the drive ends are clipped to: the routing-field bounds (as the Mission Planer's tHome). */
let boundsSource: () => Promise<Bounds> = async () => (await data().fieldsIndex()).bounds
export function setCuriosityBounds(fn: () => Promise<Bounds>): void {
  boundsSource = fn
}

let loadSeq = 0
async function load(): Promise<void> {
  const seq = ++loadSeq
  statusSig.value = { kind: 'loading' }
  try {
    const c = await loadCuriosity(await boundsSource())
    if (seq === loadSeq) statusSig.value = { kind: 'ready', stops: c.stops, traverse: c.traverse }
  } catch (e) {
    if (seq !== loadSeq) return
    console.warn('[curiosity] NASA unavailable:', e)
    statusSig.value = { kind: 'unavailable', reason: unavailableReason(e) }
  }
}

/** The toggle. On: load once (nothing is fetched before this). Off: hide and close the card. */
export function setCuriosityOn(on: boolean): void {
  if (on && !enabledSig.peek()) return
  onSig.value = on
  if (on) {
    const k = statusSig.peek().kind
    if (k === 'idle' || k === 'unavailable') void load()
  } else selectCuriosityStop(null)
}

/** Ask NASA again after "unavailable". */
export function retryCuriosity(): void {
  if (onSig.peek()) void load()
}

/** Open (index) or close (null) the drive-end card. */
export function selectCuriosityStop(i: number | null): void {
  selectedSig.value = i
  registerContainer({ id: CURIOSITY_CARD, kind: 'card' })
  if (i === null) closeContainer(CURIOSITY_CARD, { restoreFocus: false })
}

/** A click on drive end `i`: its card opens (closing any other map card). */
export function openCuriosityStop(i: number): void {
  if (!curiosityStop(i)) return
  selectedSig.value = i
  registerContainer({ id: CURIOSITY_CARD, kind: 'card' })
  openContainer(CURIOSITY_CARD, null)
}

/** The ready stop at `i` and the one after it (the next drive bounds the parked sols). */
export function curiosityStop(i: number | null): { stop: DriveEnd; next: DriveEnd | null } | null {
  const s = statusSig.peek()
  if (i === null || s.kind !== 'ready' || !s.stops[i]) return null
  return { stop: s.stops[i], next: s.stops[i + 1] ?? null }
}

/** Tests: back to the page-load state (flag on, layer off, nothing loaded). */
export function resetCuriosity(): void {
  loadSeq++
  enabledSig.value = true
  onSig.value = false
  statusSig.value = { kind: 'idle' }
  selectedSig.value = null
  boundsSource = async () => (await data().fieldsIndex()).bounds
}
