// Selection → card (U14, §4.3; L2e, D111): every selection opens as a pop-up card, no longer in the
// shell's right sidebar. The Plan map draws it at the object (views/planStation.tsx); everywhere else
// this module draws the same card as a small centred pop-up in the shell overlay (ui/cards/
// selectionCard.tsx). Installed once by the shell (lazy chunk). Escape clears the selection, [ / ] walk the history (§4.4); both
// arrive as the shell's cancelable `hl:shortcut` events, so the shell keeps its own Escape order
// (help, then focus mode) when nothing is selected.
import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { data, type Loader } from '../../data/loader'
import { ensureManifest } from '../../views/common'
import { canGoBack, canGoForward, clearSelection, selection, stepHistory, type SelectionRef } from '../../state/selection'
import { useSignalValue } from '../../state/signal'
import { t } from '../copy'
import { CardSkeleton, IconButton } from '../components'
import { MarkerCard } from '../layout'
import { shell } from '../shell/store'
import type { ShortcutAction } from '../shell/keys'
import { RouteSummaryCard, SelectionCard } from './cards'
import { ensureFor, isReady, loadCardData, type CardData, type CellLookup } from './data'
import { cardIdFor, cardTitle, SelectionCardBody, sourcesOf, wireSelectionCards } from './selectionCard'

export interface SidebarOptions {
  loader?: Loader
  cell?: CellLookup
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'>
  /** where the centred pop-up card goes (the shell overlay); none = no pop-up */
  host?: HTMLElement
}

/** Card data for the whole app, loaded once. */
let shared: Promise<CardData> | undefined
export function cardData(L: Loader = data(), cell?: CellLookup): Promise<CardData> {
  shared ??= Promise.all([ensureManifest(), loadCardData(L, cell)]).then(([, d]) => d)
  shared.catch(() => (shared = undefined))
  return shared
}

/** History back / forward (§4.4 [ ]) and the card for the current selection. */
export function SelectionPanel({ L, cell }: { L: Loader; cell?: CellLookup }) {
  const sel = useSignalValue(selection.selected)
  useSignalValue(selection.cursor)
  useSignalValue(selection.history)
  const [d, setD] = useState<CardData | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [, bump] = useState(0)
  useEffect(() => {
    let live = true
    cardData(L, cell).then(
      (x) => live && setD(x),
      (e) => live && setErr(e),
    )
    return () => void (live = false)
  }, [L])
  const ready = d && isReady(d, sel)
  useEffect(() => {
    if (!d || ready) return
    let live = true
    ensureFor(L, d, sel).then(
      () => live && bump((n) => n + 1),
      (e) => live && setErr(e),
    )
    return () => void (live = false)
  }, [d, sel, ready])
  return (
    <div class="hl-selection" data-selected={sel ? sel.kind : 'none'}>
      <div class="hl-selection__nav">
        <IconButton icon="chevron-left" label={t('buttons.back')} disabled={!canGoBack()} reason={t('hints.disabled.historyBack')} onClick={() => stepHistory(-1)} />
        <IconButton icon="chevron-right" label={t('buttons.forward')} disabled={!canGoForward()} reason={t('hints.disabled.historyForward')} onClick={() => stepHistory(1)} />
      </div>
      {!sel && (
        <div class="hl-empty">
          <p>{t('states.empty.noSelection')}</p>
          <p class="hl-empty__hint">{t('hints.map.mouse')}</p>
        </div>
      )}
      {err ? (
        <p class="hl-cardx__muted">{t('states.error.generic', { what: t('cards.common.details') })}</p>
      ) : d && ready ? (
        <SelectionCard sel={sel} d={d} />
      ) : (
        <CardSkeleton />
      )}
    </div>
  )
}

/** L2e: the route summary (the sidebar's old "nothing selected" view, with the official plan's "Send to
 *  simulator" slot), unchanged, for the Plan summary card. */
export function RouteSummaryPanel({ L, cell }: { L: Loader; cell?: CellLookup }) {
  const [d, setD] = useState<CardData | null>(null)
  const [err, setErr] = useState<unknown>(null)
  useEffect(() => {
    let live = true
    cardData(L, cell).then(
      (x) => live && setD(x),
      (e) => live && setErr(e),
    )
    return () => void (live = false)
  }, [L])
  return (
    <div class="hl-selection" data-selected="summary">
      {err ? <p class="hl-cardx__muted">{t('states.error.generic', { what: t('cards.routeSummary.title') })}</p> : d ? <RouteSummaryCard d={d} /> : <CardSkeleton />}
    </div>
  )
}

/** Escape / [ ] from the shell's `hl:shortcut` event. Returns true when the selection used it. */
export function handleSelectionShortcut(a: ShortcutAction): boolean {
  // The shell's own Escape order comes first: help overlay, then focus mode (§4.4).
  if (a.action === 'escape' && selection.selected.peek() && !shell.helpOpen.peek() && !shell.focusMode.peek()) {
    clearSelection()
    return true
  }
  if (a.action === 'history') return stepHistory(a.step)
  return false
}

/** Whether the Plan map view draws the selection card itself (views/planStation.tsx). */
const mapHosts = (): boolean => shell.hosted.peek().includes('selection')

/** The centred pop-up (no Plan map): the same card, same body; 'station' / 'selection' ids. */
function CentredCard({ L, cell }: { L: Loader; cell?: CellLookup }) {
  const [sel, setSel] = useState<SelectionRef | null>(null)
  const [d, setD] = useState<CardData | null>(null)
  const hosted = useSignalValue(shell.hosted).includes('selection')
  useEffect(() => wireSelectionCards({ setCard: setSel, enabled: () => !mapHosts() }), [])
  useEffect(() => {
    let live = true
    cardData(L, cell).then(
      (x) => live && setD(x),
      () => undefined,
    )
    return () => void (live = false)
  }, [L])
  if (!sel || hosted) return null
  const id = cardIdFor(sel)
  const page = sel.kind === 'station' && !!d?.stations.some((s) => s.id === sel.id)
  return (
    <MarkerCard key={id} id={id} title={cardTitle(sel, d ? sourcesOf(d) : {})} at={{ x: 0, y: 0 }} class="sel-card sel-card--centred">
      <SelectionCardBody sel={sel} L={L} cell={cell} stationPage={page} />
    </MarkerCard>
  )
}

/**
 * Wire the store to the selection card; returns dispose. The right sidebar no longer opens on a
 * selection (L2e): shell.selectionCards turns openSidebar() off while installed.
 */
export function installSelectionSidebar(opts: SidebarOptions = {}): () => void {
  const L = opts.loader ?? data()
  const win = opts.win ?? (typeof window !== 'undefined' ? window : undefined)
  shell.selectionCards.value = true
  shell.sidebarOpen.value = false
  let box: HTMLElement | null = null
  if (opts.host) {
    box = opts.host.appendChild(opts.host.ownerDocument.createElement('div'))
    box.className = 'sel-pop'
    render(<CentredCard L={L} cell={opts.cell} />, box)
  }
  const onKey = (e: Event) => {
    const a = (e as CustomEvent<ShortcutAction>).detail
    if (a && handleSelectionShortcut(a)) e.preventDefault()
  }
  win?.addEventListener('hl:shortcut', onKey)
  return () => {
    win?.removeEventListener('hl:shortcut', onKey)
    if (box) {
      render(null, box)
      box.remove()
    }
    shell.selectionCards.value = false
  }
}
