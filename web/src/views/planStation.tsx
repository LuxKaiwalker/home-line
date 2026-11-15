// Plan map cards (package L2d, D111; L0 rows 12, 14, 20; Q1 and Q5 defaults). Mounted over the console
// map through the L2-shell slot 'card' (views/planSlots.tsx):
//   marker card "station"  the selection card of a station (the same SelectionPanel the sidebar showed),
//                          anchored to the station; a map click, the station list and search open it.
//                          A map click selects only (no #/station/:id); the full page is "Open station".
//                          Hosting 'station' keeps the sidebar and its Details toggle out of Plan.
//   marker card "rover"    the rover drag's delta strip (Keep / Discard), anchored to the rover, while a
//                          released draft is open (state/roverCard.ts). Closing it (Esc, ×) = Discard, as
//                          Escape did in the sidebar. With the station card open, the strip sits on top
//                          of it instead (one card at a time), as it sat above the selection card before.
// Numbers, trust chips and card content are unchanged: only the container moved.
import { render, type ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { data } from '../data/loader'
import type { Station } from '../data/types'
import type { ConsoleMap } from '../map/consoleMap'
import { href } from '../router'
import { hostRoverCard, roverStrip } from '../state/roverCard'
import { clearSelection, selection } from '../state/selection'
import { effect, useSignalValue } from '../state/signal'
import { CardSkeleton } from '../ui/components'
import { t } from '../ui/copy'
import { closeContainer, layout, MarkerCard, openContainer, registerContainer } from '../ui/layout'
import { hostIn } from '../ui/shell/store'
import { registerPlanMount } from './planSlots'
import './planStation.css'

export const STATION_CARD = 'station'
export const ROVER_CARD = 'rover'

type Panel = (p: { L: ReturnType<typeof data> }) => ComponentChildren

/** The selection panel (lazy cards chunk, as in the sidebar) and the link to the full station page. */
function StationCardBody({ id }: { id: string }) {
  const [Sel, setSel] = useState<Panel | null>(null)
  useEffect(() => {
    let live = true
    void import('../ui/cards/sidebar').then((m) => live && setSel(() => m.SelectionPanel as Panel))
    return () => void (live = false)
  }, [])
  return (
    <>
      {Sel ? <Sel L={data()} /> : <CardSkeleton />}
      <p class="plan-card__open">
        <a class="hl-btn hl-btn--secondary" href={href({ name: 'station', id })} title={t('cards.station.openTip')}>
          {t('cards.station.open')}
        </a>
      </p>
    </>
  )
}

function PlanCards({ cmap, bindClick }: { cmap: ConsoleMap; bindClick: (fn: (id: string) => void) => void }) {
  const [stations, setStations] = useState<Station[] | null>(null)
  const [card, setCard] = useState<string | null>(null)
  const strip = useSignalValue(roverStrip)

  useEffect(() => {
    let live = true
    data()
      .stations()
      .then((s) => live && setStations(s))
      .catch(() => undefined)
    return () => void (live = false)
  }, [])

  useEffect(() => {
    const show = (id: string) => {
      setCard(id)
      openContainer(STATION_CARD)
    }
    // a map click on a station (also the one already selected: it reopens its card)
    bindClick(show)
    const offs = [
      // a station selection (map, list, search, history) opens its card; any other selection closes it
      effect(() => {
        const s = selection.selected.value
        if (s?.kind === 'station') show(s.id)
        else closeContainer(STATION_CARD, { restoreFocus: false })
      }),
      // the strip appears on release and goes on Keep / Discard / a new drag
      effect(() => {
        const on = !!roverStrip.value
        if (on && !layout.open.peek()[STATION_CARD]) openContainer(ROVER_CARD)
        else if (!on) closeContainer(ROVER_CARD, { restoreFocus: false })
      }),
    ]
    // closing a card by hand (×, Esc), not by the other card opening
    let was = { s: false, r: false }
    offs.push(
      effect(() => {
        const o = layout.open.value
        const now = { s: !!o[STATION_CARD], r: !!o[ROVER_CARD] }
        if (was.s && !now.s && !now.r) {
          // the station selection goes with its card (Esc cleared it in the sidebar); a draft still open
          // gets its rover card back
          if (selection.selected.peek()?.kind === 'station') clearSelection()
          if (roverStrip.peek()) openContainer(ROVER_CARD)
        }
        if (was.r && !now.r && !now.s) roverStrip.peek()?.dismiss()
        was = now
      }),
    )
    return () => offs.forEach((f) => f())
  }, [])

  const st = card ? stations?.find((s) => s.id === card) : undefined
  return (
    <>
      {st && (
        <MarkerCard id={STATION_CARD} title={`${st.id} ${st.name}`} at={{ lngLat: [st.lon, st.lat], map: cmap.map }} class="plan-card plan-card--station">
          {strip?.render()}
          <StationCardBody id={st.id} />
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
  registerContainer({ id: STATION_CARD, kind: 'card' })
  registerContainer({ id: ROVER_CARD, kind: 'card' })
  const offs = [hostIn('station'), hostRoverCard()]
  render(<PlanCards cmap={ctx.cmap} bindClick={(fn) => ctx.onStationClick(fn)} />, ctx.el.card)
  return () => {
    ctx.onStationClick(null)
    render(null, ctx.el.card) // effects off first: closing the cards below is no Discard
    closeContainer(STATION_CARD, { restoreFocus: false })
    closeContainer(ROVER_CARD, { restoreFocus: false })
    offs.forEach((f) => f())
  }
})
