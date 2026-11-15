// Plan map chrome (package L2f, D111; L0 rows 5, 8, 16): what is left of the console and live asides
// once the declutter packages placed their sections, and the last map controls outside L2c's column.
//   tool column (views/planLayers.tsx PlanEdge renders these two)  Rover button (opens the rover card:
//                     the console's "Rover pad" text + the live pad tool, views/planStation.tsx) ·
//                     Full screen (the whole app, Fullscreen API; hidden where the browser has none)
//   slot 'chrome'     data notes: the console's 'notes' section (dummy-data note, data problems,
//                     "Loading…") as a one-line banner at the top left of the map, shown only when it
//                     has something to say;
//                     cursor chip: MapFurniture's cursor readout (U4) as a one-line chip at the bottom
//                     left (beside the legend chip), re-parented while mounted. Passive: it only shows
//                     what the readout writes on hover (L7a), never changes state.
//   Edit route        (L3, ui/shell/editroute.tsx: untouched) joins the bottom of the tool column: this
//                     mount writes the column's height to --plan-tools-bottom and planChrome.css places
//                     the button there.
// No number logic here; ?legacy=1 (no shell frame) mounts none of this.
import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { IconButton } from '../ui/components'
import { t } from '../ui/copy'
import { useOpener } from '../ui/layout'
import { Borrow } from './planLayers'
import { registerPlanMount, SectionHost, type PlanMountCtx, type Sections } from './planSlots'
import { ROVER_CARD } from './planStation'
import './planChrome.css'

/** The rover card's opener in the map-edge tool column (layout store id 'rover', DOM id hl-lay-rover). */
export function RoverButton() {
  const opener = useOpener(ROVER_CARD)
  return <IconButton icon="rover" label={t('planChrome.rover')} title={t('planChrome.rover')} class="plan-tools__btn plan-tools__rover" {...opener} />
}

const fsEnabled = (): boolean => typeof document !== 'undefined' && !!document.fullscreenEnabled

/** Full screen for the whole app (the map keeps its controls; Esc leaves, as the browser does). */
export function FullscreenButton() {
  const [on, setOn] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement)
  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  if (!fsEnabled()) return null
  const label = on ? t('planChrome.exitFullscreen') : t('planChrome.fullscreen')
  const toggle = () => {
    try {
      void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined)
    } catch {
      /* refused (iframe without allowfullscreen): the button simply does nothing */
    }
  }
  return <IconButton icon={on ? 'minimize' : 'maximize'} label={label} title={label} pressed={on} class="plan-tools__btn plan-tools__fullscreen" onClick={toggle} />
}

function Chrome({ sections, mapEl }: { sections: Sections; mapEl: HTMLElement }) {
  return (
    <>
      <div class="plan-notes" role="note" aria-label={t('planChrome.notes')}>
        <SectionHost name="notes" sections={sections} />
      </div>
      <Borrow root={mapEl} sel=".hl-cursor-readout" class="plan-cursor" />
    </>
  )
}

/** The L2f Plan mount: claims the last console section ('notes'), the cursor chip, the Edit-route position. */
export function mountPlanChrome(ctx: PlanMountCtx): () => void {
  ctx.claim(['notes'])
  const layout = (ctx.el.edge.parentNode as HTMLElement | null) ?? ctx.mapEl
  const slot = layout.appendChild(document.createElement('div'))
  slot.className = 'plan-layout__chrome'
  slot.setAttribute('data-plan-slot', 'chrome')
  render(<Chrome sections={ctx.sections} mapEl={ctx.mapEl} />, slot)
  // the Edit-route button sits under the tool column: follow the column's height
  const tools = (): HTMLElement | null => ctx.el.edge.querySelector<HTMLElement>('.plan-tools')
  const write = () => {
    const c = tools()
    if (c) ctx.mapEl.style.setProperty('--plan-tools-bottom', `${c.offsetTop + c.offsetHeight}px`)
  }
  let ro: ResizeObserver | null = null
  let mo: MutationObserver | null = null
  const watch = (): boolean => {
    const c = tools()
    if (!c) return false
    write()
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(write)
      ro.observe(c)
    }
    return true
  }
  if (!watch() && typeof MutationObserver !== 'undefined') {
    mo = new MutationObserver(() => {
      if (watch()) mo?.disconnect()
    })
    mo.observe(ctx.el.edge, { childList: true, subtree: true })
  }
  return () => {
    mo?.disconnect()
    ro?.disconnect()
    ctx.mapEl.style?.removeProperty?.('--plan-tools-bottom')
    render(null, slot)
    slot.remove()
  }
}

registerPlanMount('chrome', mountPlanChrome)
