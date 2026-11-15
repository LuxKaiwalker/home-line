// Selection → pop-up card (package L2e, D111; team lead 16:51). Every selection opens as one small card
// instead of the right sidebar:
//   on the Plan map  a MarkerCard (L1) anchored at the selected object (pad, parking option, station,
//                    scored site, landmark, clicked cell or coordinates; views/planStation.tsx), placed
//                    beside the object so it never covers it, flipped to stay inside the map;
//   anywhere else    (Report, Evidence, Fly without the Plan map) the same card as a small centred pop-up
//                    (ui/cards/sidebar.tsx installSelectionSidebar, in the shell overlay).
// Layout store ids: 'station' for a station (as L2d, the L5 selector contract) and 'selection' for any
// other kind; one card at a time; × and Esc close it (and clear the selection, as Esc did in the
// sidebar); focus moves into the card and back to the opener. The body is the sidebar's own
// SelectionPanel (lazy cards chunk): numbers, trust chips and links are unchanged.
// Pure helpers (cardIdFor, cardTitle, anchorLngLat, cardRoom) are unit-tested in selectionCard.test.ts.
import type { ComponentChildren, ComponentType } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Loader } from '../../data/loader'
import { locate, type FocusSources } from '../../map/camera/focus'
import { href } from '../../router'
import { clearSelection, refKey, selection, type SelectionRef } from '../../state/selection'
import { batch, effect, type ReadSignal } from '../../state/signal'
import { CardSkeleton } from '../components'
import { Icon } from '../components/Icon'
import { t } from '../copy'
import { closeContainer, layout, openContainer, registerContainer } from '../layout'
import { openRoutePanel } from '../route-panel/panelState'
import { TOKENS } from '../tokens'
import type { CardData, CellLookup } from './data'
import './selectionCard.css'

export const STATION_CARD = 'station'
export const SELECTION_CARD = 'selection'
export const SELECTION_CARDS = [STATION_CARD, SELECTION_CARD] as const

/** The layout-store card that shows `r`: stations keep L2d's 'station' card, every other kind 'selection'. */
export const cardIdFor = (r: SelectionRef): string => (r.kind === 'station' ? STATION_CARD : SELECTION_CARD)

/** What the card needs to name and place an object (the cards' own loaded data). */
export interface CardSources extends FocusSources {
  stations?: readonly { id: string; name?: string; lon: number; lat: number }[] | null
  labels?: readonly { code: string; name?: string; kind?: string; lon: number; lat: number }[] | null
}

/** The cards' loaded data → what the card needs to name and place an object. */
export function sourcesOf(d: CardData): CardSources {
  return {
    stations: d.stations,
    labels: d.labels,
    pad: d.pad?.pad ?? null,
    padOptions: (d.pads?.options ?? []).flatMap((o) => (o.lon !== null && o.lat !== null ? [{ id: o.id, lon: o.lon, lat: o.lat }] : [])),
  }
}

/** The card's title: the object's code and name where known, else its kind (copy deck). */
export function cardTitle(r: SelectionRef, s: CardSources = {}): string {
  switch (r.kind) {
    case 'station': {
      const st = s.stations?.find((x) => x.id === r.id)
      if (st) return st.name ? `${st.id} ${st.name}` : st.id
      const l = s.labels?.find((x) => x.code === r.id)
      if (l?.name) return `${r.id} ${l.name}`
      return `${t(l?.kind === 'scored_site' ? 'cards.scoredSite.title' : 'cards.station.title')} ${r.id}`
    }
    case 'pad':
      return t(r.id === 'rank1' ? 'cards.pad.officialTitle' : 'cards.pad.alternativeTitle')
    case 'landmark': {
      const l = s.labels?.find((x) => x.code === r.code)
      return l?.name ? `${r.code} ${l.name}` : `${t('cards.landmark.title')} ${r.code}`
    }
    case 'cell':
      return t('cards.cell.title')
    case 'leg':
      return t('cards.route.title')
    case 'edge':
      return t('cards.homelineEdge.title')
  }
}

/**
 * Where the card points: the object's own point (the same lookup as the map highlight), else the
 * middle of its line (a leg), else `fallback` (where the map was clicked, or the map centre).
 */
export function anchorLngLat(r: SelectionRef, s: CardSources, fallback: [number, number] | null): [number, number] | null {
  const { point, lines } = locate(r, s)
  if (point) return point
  const line = lines.find((l) => l.length > 0)
  if (line) return line[Math.floor((line.length - 1) / 2)]
  return fallback
}

/** Narrowest card that still reads (px): two thirds of the sidebar width the cards are laid out for. */
export const CARD_MIN_W = Math.round((TOKENS.layout.sidebar * 2) / 3)
/** Above / below at full width wins over a narrower card beside the object down to this height (px): the
 *  readouts need the full width (card-fit), a low card scrolls. */
export const CARD_MIN_H = Math.round(CARD_MIN_W * (2 / 3))

/**
 * The largest card that cannot cover the point `p` (px inside a `box`). MarkerCard puts the card right
 * of the point (left when the right side is too narrow) and above it (below when there is no room
 * above), then clamps it inside the map; a card narrower than the wider side, or lower than the taller
 * side, therefore never covers the point. In order: beside it at the full card width (`want`); above
 * or below it at full width when that side has CARD_MIN_H; beside it, narrower (CARD_MIN_W at least);
 * else above or below whatever the height (the card scrolls inside). `gap` is MarkerCard's gap; 2 px
 * are kept for the border.
 */
export function cardRoom(p: { x: number; y: number }, box: { w: number; h: number }, gap = TOKENS.space[2], want = TOKENS.layout.sidebar): { maxW: number; maxH: number | null } {
  const wide = Math.floor(Math.max(p.x - gap, box.w - p.x - gap)) - 2
  const tall = Math.floor(Math.max(p.y - gap, box.h - p.y - gap)) - 2
  const full = Math.max(0, Math.floor(box.w))
  if (wide >= want) return { maxW: wide, maxH: null }
  if (tall >= CARD_MIN_H) return { maxW: full, maxH: tall }
  if (wide >= CARD_MIN_W) return { maxW: wide, maxH: null }
  return { maxW: full, maxH: Math.max(0, tall) }
}

/** Write cardRoom into the CSS variables the card reads (selectionCard.css) on its container. */
export function applyRoom(el: HTMLElement, room: { maxW: number; maxH: number | null } | null): void {
  if (!room) {
    el.style.removeProperty('--sel-card-max-w')
    el.style.removeProperty('--sel-card-max-h')
    return
  }
  el.style.setProperty('--sel-card-max-w', `${room.maxW}px`)
  if (room.maxH === null) el.style.removeProperty('--sel-card-max-h')
  else el.style.setProperty('--sel-card-max-h', `${room.maxH}px`)
}

// ---------------------------------------------------------------- focus

const doc = (): Document | null => {
  try {
    return typeof document !== 'undefined' ? document : null
  } catch {
    return null
  }
}

/** Focus moves into the card (its close button) on every new selection it shows (WCAG 2.4.3). */
export function focusCard(inside: Element | null): void {
  inside?.closest?.('.hl-lay-card')?.querySelector?.<HTMLElement>('.hl-lay-close')?.focus?.()
}

/**
 * After a close by hand: when the opener is gone from the page (a map label redrawn while the card was
 * open), focus goes to its redrawn twin (same label code), else stays where the layout store put it.
 */
function refocus(code: string | null): void {
  const d = doc()
  if (!d || !code) return
  const a = d.activeElement
  if (a && a !== d.body) return
  d.querySelector?.<HTMLElement>(`.hl-label[data-code="${code.replace(/["\\]/g, '')}"] .hl-label__pill`)?.focus?.()
}

// ---------------------------------------------------------------- wiring

export interface WireOptions {
  /** the card to draw (null: none) */
  setCard: (r: SelectionRef | null) => void
  /** while false the selection is left alone (another view hosts the cards); read with peek */
  enabled?: () => boolean
  /** the rover drag's delta strip (Plan only, L2d): sits on top of an open selection card, else in its
   *  own 'rover' card; closing that card by hand = Discard */
  rover?: { strip: ReadSignal<{ dismiss: () => void } | null>; card: string }
}

/** A press this recent (ms) still names the opener of the card it opened. */
const PRESS_MS = 2000
const isCardEl = (el: Element | null): boolean => !!el?.closest?.('.sel-card')

/**
 * Cards follow the selection: a selection opens its card (station or selection), none closes it;
 * closing a card by hand (×, Esc) clears the selection. Returns off.
 */
export function wireSelectionCards(o: WireOptions): () => void {
  const on = o.enabled ?? (() => true)
  // The element focus goes back to on close. A card replacing a card keeps the first opener (the
  // focused element is then the old card's close button, which goes with it).
  let opener: HTMLElement | null = null
  let openerCode: string | null = null
  // A press on the map (a label pill, a marker, the canvas) does not move the focus (MapLibre keeps it
  // where it was): the pressed control is the opener then, if it was pressed just now.
  let press: { el: Element | null; at: number } = { el: null, at: 0 }
  const onPress = (e: Event) => void (press = { el: e.target as Element | null, at: Date.now() })
  const d0 = doc()
  d0?.addEventListener?.('pointerdown', onPress, true)
  const openerNow = (): HTMLElement | null => {
    const d = doc()
    let a = d?.activeElement ?? null
    if ((!a || a === d?.body) && press.el && Date.now() - press.at < PRESS_MS) a = press.el.closest?.('button, a[href], [tabindex]') ?? a
    if (!isCardEl(a)) {
      opener = (a as HTMLElement | null) ?? null
      openerCode = opener?.closest?.('.hl-label[data-code]')?.getAttribute('data-code') ?? null
    }
    return opener
  }
  // one change: the card it replaces closes in the same batch, so the watcher below never sees "all
  // closed" in between (that would read as a close by hand)
  const open = (id: string) => batch(() => openContainer(id, openerNow()))
  const closeAll = () => SELECTION_CARDS.forEach((id) => closeContainer(id, { restoreFocus: false }))
  const roverId = o.rover?.card
  const strip = o.rover?.strip
  for (const id of [...SELECTION_CARDS, ...(roverId ? [roverId] : [])]) registerContainer({ id, kind: 'card' })
  const read = (x: Readonly<Record<string, boolean>>) => ({ s: SELECTION_CARDS.some((id) => !!x[id]), r: !!(roverId && x[roverId]) })
  let was = read(layout.open.peek())
  const offs = [
    effect(() => {
      const s = selection.selected.value
      if (!on()) return
      if (s) {
        o.setCard(s)
        open(cardIdFor(s))
      } else closeAll()
    }),
    effect(() => {
      const now = read(layout.open.value)
      if (on()) {
        if (was.s && !now.s && !now.r) {
          // the selection goes with its card (Esc cleared it in the sidebar); a draft still open gets
          // its rover card back
          if (selection.selected.peek()) clearSelection()
          const code = openerCode
          void Promise.resolve().then(() => refocus(code)) // after the layout store's own focus return
          if (roverId && strip?.peek()) open(roverId)
        }
        if (roverId && was.r && !now.r && !now.s) strip?.peek()?.dismiss()
      }
      was = read(layout.open.peek()) // what this run opened itself (it does not re-run for its own writes)
    }),
  ]
  if (roverId && strip)
    offs.push(
      effect(() => {
        const has = !!strip.value
        if (has && !read(layout.open.peek()).s) open(roverId)
        else if (!has) closeContainer(roverId, { restoreFocus: false })
      }),
    )
  return () => {
    offs.forEach((f) => f())
    d0?.removeEventListener?.('pointerdown', onPress, true)
  }
}

// ---------------------------------------------------------------- body

/** L2e: the Plan summary card's body (RouteSummaryPanel, lazy cards chunk); focus moves into the card. */
export function SummaryCardBody({ L }: { L: Loader }) {
  const [P, setP] = useState<((p: { L: Loader }) => ComponentChildren) | null>(null)
  const probe = useRef<HTMLDivElement>(null)
  useEffect(() => focusCard(probe.current), [])
  useEffect(() => {
    let live = true
    void import('./sidebar').then((m) => live && setP(() => m.RouteSummaryPanel as (p: { L: Loader }) => ComponentChildren))
    return () => void (live = false)
  }, [])
  return (
    <div class="sel-card__content" ref={probe}>
      {P ? <P L={L} /> : <CardSkeleton />}
    </div>
  )
}

type Panel = (p: { L: Loader; cell?: CellLookup }) => ComponentChildren

/** J1d: "Add to route" on a station card: the Mission Planer with ?add=<id> (it appends the station). */
/** PORT I1 (R3): R3's "Add to route" button (edit/route/map/addToRoute, lazy chunk: §7b), loaded once. */
type AddButton = ComponentType<{ station: string; onAdded?: (station: string) => void }>
let addButton: AddButton | null = null

export function StationAddToRoute({ id }: { id: string }) {
  // one click appends the station to the Plan route (one undo step) and opens the Route panel; "In your
  // route" once it is in (R3). Until the chunk is in, the same button, disabled.
  const [Btn, setBtn] = useState<AddButton | null>(() => addButton)
  useEffect(() => {
    if (Btn) return
    let live = true
    void import('../../edit/route/map/addToRoute').then((m) => {
      addButton = m.AddToRouteButton as AddButton
      if (live) setBtn(() => addButton)
    })
    return () => void (live = false)
  }, [])
  if (Btn) return <Btn station={id} onAdded={() => openRoutePanel()} />
  return (
    <button type="button" class="hl-btn hl-btn--secondary plan-card__add" disabled data-add-to-route={id}>
      <Icon name="plus" /> {t('cards.station.addToRoute')}
    </button>
  )
}

/** The sidebar's SelectionPanel (lazy cards chunk) and, for a station with a page, "Open station" and
 *  "Add to route" (J1d). */
export function SelectionCardBody({ sel, L, cell, stationPage }: { sel: SelectionRef; L: Loader; cell?: CellLookup; stationPage?: boolean }) {
  const [Sel, setSel] = useState<Panel | null>(null)
  const probe = useRef<HTMLDivElement>(null)
  // every new selection the card shows takes the focus into it
  const key = refKey(sel)
  useEffect(() => focusCard(probe.current), [key])
  useEffect(() => {
    let live = true
    void import('./sidebar').then((m) => live && setSel(() => m.SelectionPanel as Panel))
    return () => void (live = false)
  }, [])
  return (
    <div class="sel-card__content" ref={probe}>
      {Sel ? <Sel L={L} cell={cell} /> : <CardSkeleton />}
      {sel.kind === 'station' && stationPage && (
        <p class="plan-card__open">
          <a class="hl-btn hl-btn--secondary" href={href({ name: 'station', id: sel.id })} title={t('cards.station.openTip')}>
            {t('cards.station.open')}
          </a>
          <StationAddToRoute id={sel.id} />
        </p>
      )}
    </div>
  )
}
