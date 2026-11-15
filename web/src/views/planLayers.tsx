// Plan mode: the layers popover, the legend corner chip and the map-edge tools (package L2c, D111; L0 rows
// 5, 7, 16, Q3). Mount points only (L2-shell slot ctx.el.edge, views/planSlots.tsx): no layer logic, no
// number logic, the "preliminary" tags and trust chips come with the components as they are.
//   map-edge tools (right edge, top; follows the right drawer's edge, z above the cards, so never covered)
//     zoom (L2f) · compass (MapFurniture) · Layers popover · 2D/3D (terrain control, L13 owns T and the
//     view state) · Flythrough (icon) · Storm replay (icon) · Rover card + Full screen (L2f, planChrome.tsx)
//     · Edit route under the column (L3's button, placed by planChrome.css)
//   popover "layers"  (L5 id)  map view (3D exaggeration slider, Flat vs real) · the console's layer
//                              checkboxes (first layer group, L0 Q3) · the U7 layer manager (LayerPanel)
//   popover "legend"  (L5 id)  the console's legend, as a corner chip (bottom left, above the scale bar)
// The MapLibre controls are created by their owners as before (ConsoleMap, TerrainController, MapFurniture,
// installStorm) and only re-parented here while the layout is mounted (<Borrow>); they go back to their
// MapLibre corner on unmount. ?legacy=1 (no shell frame) mounts none of this.
import { render } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { LayerPanel } from '../map/overlays/LayerPanel'
import { t } from '../ui/copy'
import { Popover, useLayoutInsets } from '../ui/layout'
import { hostIn } from '../ui/shell/store'
import { FullscreenButton, RoverButton } from './planChrome' // L2f: the last map-edge tools
import { registerPlanMount, SectionHost, type PlanMountCtx, type Sections } from './planSlots'
import './planLayers.css'

/** Layout store ids (L5 selector contract: DOM id hl-lay-<id>, opener aria-controls="hl-lay-<id>"). */
export const LAYERS_ID = 'layers'
export const LEGEND_ID = 'legend'

/** The MapLibre controls shown at the map edge or in the layers popover (selectors inside the map). */
export const EDGE_CONTROLS = {
  zoom: '.maplibregl-ctrl-group:has(> .maplibregl-ctrl-zoom-in)',
  compass: '.hl-compass',
  view: '.hl-terrain-ctrl',
  flythrough: '.hl-fly',
  storm: '.hl-storm-ctrl',
  exaggeration: '.hl-terrain-exag',
  collapse: '.collapse-toggle',
} as const

const closedOpener = (id: string) => `[aria-controls="hl-lay-${id}"][aria-expanded="false"]`

/**
 * Re-parent the first element matching `sel` inside `root` into this box while mounted (waits for it to
 * appear: MapLibre controls are added once the map loads); puts it back where it was on unmount.
 */
export function Borrow({ root, sel, class: cls }: { root: HTMLElement; sel: string; class?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    let el: HTMLElement | null = null
    let parent: Node | null = null
    let next: Node | null = null
    const take = (): boolean => {
      const found = Array.from(root.querySelectorAll<HTMLElement>(sel)).find((e) => !box.contains(e))
      if (!found) return false
      el = found
      parent = found.parentNode
      next = found.nextSibling
      box.appendChild(found)
      return true
    }
    let obs: MutationObserver | null = null
    if (!take() && typeof MutationObserver !== 'undefined') {
      obs = new MutationObserver(() => {
        if (take()) obs?.disconnect()
      })
      obs.observe(root, { childList: true, subtree: true })
    }
    return () => {
      obs?.disconnect()
      const e = el as HTMLElement | null
      const p = parent as Node | null
      if (!e || e.parentNode !== box) return // removed by its owner meanwhile (map destroyed)
      if (p && p.isConnected) p.insertBefore(e, next && next.parentNode === p ? next : null)
      else e.remove()
    }
  }, [root, sel])
  return <div ref={ref} class={cls ? `plan-borrow ${cls}` : 'plan-borrow'} />
}

function LayersBody({ sections, mapEl }: { sections: Sections; mapEl: HTMLElement }) {
  return (
    <>
      <section class="plan-layers__group plan-layers__view" aria-label={t('layers.manager.view')}>
        <h3 class="plan-layers__title hl-ovl__group-title">{t('layers.manager.view')}</h3>
        <Borrow root={mapEl} sel={EDGE_CONTROLS.exaggeration} class="plan-layers__exag" />
        <p class="plan-layers__hint">{t('layers.manager.exaggerationIn3d')}</p>
        <Borrow root={mapEl} sel={EDGE_CONTROLS.collapse} class="plan-layers__collapse" />
      </section>
      <section class="plan-layers__group plan-layers__plan" aria-label={t('layers.groups.planning')}>
        <h3 class="plan-layers__title hl-ovl__group-title">{t('layers.groups.planning')}</h3>
        <SectionHost name="layers" sections={sections} />
      </section>
      <LayerPanel />
    </>
  )
}

export function PlanEdge({ sections, mapEl }: { sections: Sections; mapEl: HTMLElement }) {
  const insets = useLayoutInsets()
  const label = t('layers.manager.label')
  const legend = t('layers.manager.legend')
  return (
    <>
      <div class="plan-tools" role="group" aria-label={t('layers.manager.tools')} style={{ right: `${insets.right}px` }}>
        <Borrow root={mapEl} sel={EDGE_CONTROLS.zoom} class="plan-tools__zoom" />
        <Borrow root={mapEl} sel={EDGE_CONTROLS.compass} class="plan-tools__compass" />
        <Popover id={LAYERS_ID} icon="layers" label={label} title={label} edge="right-top" class="plan-pop plan-pop--layers">
          <LayersBody sections={sections} mapEl={mapEl} />
        </Popover>
        <Borrow root={mapEl} sel={EDGE_CONTROLS.view} class="plan-tools__view" />
        <Borrow root={mapEl} sel={EDGE_CONTROLS.flythrough} class="plan-tools__fly" />
        <Borrow root={mapEl} sel={EDGE_CONTROLS.storm} class="plan-tools__storm" />
        <RoverButton />
        <FullscreenButton />
      </div>
      <Popover id={LEGEND_ID} icon="info" label={legend} title={legend} edge="bottom-left" class="plan-pop plan-pop--legend">
        <SectionHost name="legend" sections={sections} />
      </Popover>
    </>
  )
}

/** The L2c Plan mount (registered below): claims the console's layers + legend sections, hosts the U7 rail section. */
export function mountPlanEdge(ctx: PlanMountCtx): () => void {
  ctx.claim(['layers', 'legend'])
  ctx.reveal('layers', [closedOpener(LAYERS_ID)])
  ctx.reveal('legend', [closedOpener(LEGEND_ID)])
  const unhost = hostIn(LAYERS_ID) // the U7 rail section is not drawn in Plan: it is in the popover
  render(<PlanEdge sections={ctx.sections} mapEl={ctx.mapEl} />, ctx.el.edge)
  return () => {
    render(null, ctx.el.edge)
    unhost()
  }
}

registerPlanMount('layers', mountPlanEdge)
