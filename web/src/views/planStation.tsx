// Plan map cards (package L2d, generalised by L2e; D111, L0 rows 12, 14, 20; Q1 and Q5 defaults).
// Mounted over the console map through the L2-shell slot 'card' (views/planSlots.tsx):
//   marker card "station"    a station's selection card (L2d), with "Open station" (its full page);
//   marker card "selection"  L2e: every other selection (pad, parking option, scored site, landmark,
//                            clicked cell or coordinates, leg, edge) as the same pop-up card anchored at
//                            the selected object, placed beside it so it never covers it
//                            (ui/cards/selectionCard.tsx: cardRoom). A map click on a station selects
//                            only (no #/station/:id). Hosting 'station' and 'selection' keeps the right
//                            sidebar and its Details toggle out of Plan.
//   marker card "rover"      the rover drag's delta strip (Keep / Discard), anchored to the rover, while a
//                            released draft is open (state/roverCard.ts). Closing it (Esc, ×) = Discard,
//                            as Escape did in the sidebar. With a selection card open, the strip sits on
//                            top of it instead (one card at a time), as it sat above the selection card.
// Numbers, trust chips and card content are unchanged: only the container moved.
import { render } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { data } from '../data/loader'
import type { ConsoleMap } from '../map/consoleMap'
import { hostRoverCard, roverStrip } from '../state/roverCard'
import { type SelectionRef } from '../state/selection'
import { batch, useSignalValue } from '../state/signal'
import { anchorLngLat, applyRoom, cardIdFor, cardRoom, cardTitle, SELECTION_CARD, SELECTION_CARDS, SelectionCardBody, sourcesOf, STATION_CARD, wireSelectionCards, type CardSources } from '../ui/cards/selectionCard'
import { t } from '../ui/copy'
import { closeContainer, MarkerCard, openContainer, registerContainer } from '../ui/layout'
import { hostIn } from '../ui/shell/store'
import { registerPlanMount } from './planSlots'
import './planStation.css'

export { SELECTION_CARD, STATION_CARD }
export const ROVER_CARD = 'rover'

/**
 * The cards follow the selection and the rover strip (layout store ids 'station', 'selection', 'rover').
 * `setCard` gets the object whose card to draw; `bindClick` receives the station map-click handler.
 */
export function wirePlanCards(setCard: (r: SelectionRef) => void, bindClick: (fn: (id: string) => void) => void): () => void {
  const off = wireSelectionCards({ setCard: (r) => r && setCard(r), rover: { strip: roverStrip, card: ROVER_CARD } })
  // a map click on a station selects it (console.tsx); clicking the one already selected reopens its card
  bindClick((id) => {
    setCard({ kind: 'station', id })
    batch(() => openContainer(STATION_CARD))
  })
  return off
}

/** CardData (lazy cards chunk) → what the card needs to name and place an object. */
async function loadSources(): Promise<CardSources> {
  const m = await import('../ui/cards/sidebar')
  return sourcesOf(await m.cardData(data()))
}

function PlanCards({ cmap, slot, bindClick }: { cmap: ConsoleMap; slot: HTMLElement; bindClick: (fn: (id: string) => void) => void }) {
  const [src, setSrc] = useState<CardSources | null>(null)
  const [card, setCard] = useState<SelectionRef | null>(null)
  const strip = useSignalValue(roverStrip)
  // where the map was last clicked: the anchor of a selection without a point of its own
  const click = useRef<[number, number] | null>(null)

  useEffect(() => {
    let live = true
    loadSources().then(
      (s) => live && setSrc(s),
      () => undefined,
    )
    const onClick = (e: { lngLat: { lng: number; lat: number } }) => void (click.current = [e.lngLat.lng, e.lngLat.lat])
    cmap.map.on('click', onClick)
    return () => {
      live = false
      cmap.map.off('click', onClick)
    }
  }, [])

  useEffect(() => wirePlanCards(setCard, bindClick), [])

  const center = (): [number, number] | null => {
    try {
      const c = cmap.map.getCenter()
      return [c.lng, c.lat]
    } catch {
      return null
    }
  }
  const ll = card ? anchorLngLat(card, src ?? {}, click.current ?? center()) : null

  // the room beside the object (never covering it), kept up to date while the map moves
  useLayoutEffect(() => {
    if (!ll) return applyRoom(slot, null)
    const fit = () => {
      try {
        applyRoom(slot, cardRoom(cmap.map.project(ll), { w: slot.clientWidth, h: slot.clientHeight }))
      } catch {
        applyRoom(slot, null)
      }
    }
    fit()
    cmap.map.on('move', fit)
    cmap.map.on('resize', fit)
    return () => {
      cmap.map.off('move', fit)
      cmap.map.off('resize', fit)
    }
  }, [ll?.[0], ll?.[1]])

  const id = card ? cardIdFor(card) : null
  const page = card?.kind === 'station' && !!src?.stations?.some((s) => s.id === card.id)
  return (
    <>
      {card && ll && id && (
        <MarkerCard key={id} id={id} title={cardTitle(card, src ?? {})} at={{ lngLat: ll, map: cmap.map }} class={`plan-card sel-card plan-card--${id}`}>
          {strip?.render()}
          <SelectionCardBody sel={card} L={data()} stationPage={page} />
        </MarkerCard>
      )}
      {strip && (
        <MarkerCard id={ROVER_CARD} title={t('edit.roverCard')} at={{ lngLat: strip.lngLat, map: cmap.map }} class="plan-card plan-card--rover">
          {strip.render()}
        </MarkerCard>
      )}
    </>
  )
}

registerPlanMount('station', (ctx) => {
  for (const id of [...SELECTION_CARDS, ROVER_CARD]) registerContainer({ id, kind: 'card' })
  const offs = [hostIn('station'), hostIn('selection'), hostRoverCard()]
  render(<PlanCards cmap={ctx.cmap} slot={ctx.el.card} bindClick={(fn) => ctx.onStationClick(fn)} />, ctx.el.card)
  return () => {
    ctx.onStationClick(null)
    render(null, ctx.el.card) // effects off first: closing the cards below is no Discard
    for (const id of [...SELECTION_CARDS, ROVER_CARD]) closeContainer(id, { restoreFocus: false })
    applyRoom(ctx.el.card, null)
    offs.forEach((f) => f())
  }
})
