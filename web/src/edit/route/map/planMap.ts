// PORT R3: the map side of planEdit.ts on the Plan map (map/extensions.ts context): one handle per
// free point (a DOM marker carrying data-r3-stop, which is how planEdit's handlers hit-test it), the
// ghost line while a handle is dragged (previous stop -> pointer -> next stop, dashed, "estimate";
// the routed legs come from the core when the drop is applied), the edit notice (role=status) and
// the editing cursor class. Keyboard: a focused handle is removed with Delete / Backspace; Escape
// cancels a drag; the handle's context menu (right click / long press) shows its remove button.
// Drawing "Your route" itself (numbers, legs, infeasible leg) is R4's (map/routes/).
import type { FeatureCollection } from 'geojson'
import type { MapExtensionContext } from '../../../map/extensions'
import { effect } from '../../../state/signal'
import { TOKENS } from '../../../ui/tokens'
import type { MapPointer } from '../../../map/extensions'
import { type PlanEditor } from './planEdit'
import { t } from '../../../ui/copy'
import './planEdit.css'

export const R3_GHOST_SOURCE = 'hl-r3-ghost'
export const R3_GHOST_LAYER = 'hl-r3-ghost'
/** Map layers whose features keep their click while editing (a station opens its card: "Add to route"). */
export const PASS_CLICK_LAYERS = ['access-pts', 'hl-pads', 'hl-pad-pins']

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

type El = HTMLElement
interface GeoJsonSourceLike {
  setData(d: unknown): unknown
}
interface MarkerLike {
  setLngLat(ll: [number, number]): unknown
  addTo(map: never): unknown
  remove(): unknown
}

export interface BindOptions {
  doc?: Pick<Document, 'createElement'>
  win?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null
}

/** Ghost while dragging: prev -> pointer -> next as one dashed line (valid = muted, refused = limit). */
export function ghostLine(d: { lon: number; lat: number; valid: boolean | null; prev: { lon: number; lat: number } | null; next: { lon: number; lat: number } | null } | null): FeatureCollection {
  if (!d) return EMPTY
  const coords: [number, number][] = []
  if (d.prev) coords.push([d.prev.lon, d.prev.lat])
  coords.push([d.lon, d.lat])
  if (d.next) coords.push([d.next.lon, d.next.lat])
  if (coords.length < 2) return EMPTY
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { valid: d.valid !== false, state: 'estimate' } }] }
}

/** Install the editor's handles, ghost and notice on a map. Returns the disposer. */
export function bindPlanEditMap(ed: PlanEditor, ctx: MapExtensionContext, o: BindOptions = {}): () => void {
  const doc = o.doc ?? document
  const win = o.win !== undefined ? o.win : typeof window === 'undefined' ? null : window
  const map = ctx.map
  const offs: (() => void)[] = []
  const container = map.getContainer() as El

  // ---- station / pad features keep their clicks ------------------------------------------------
  ed.setFeatureQuery((p: MapPointer) => {
    const layers = PASS_CLICK_LAYERS.filter((id) => map.getLayer(id))
    if (!layers.length) return false
    try {
      return map.queryRenderedFeatures([p.x, p.y], { layers }).length > 0
    } catch {
      return false
    }
  })
  offs.push(() => ed.setFeatureQuery(null))

  // ---- ghost while dragging ---------------------------------------------------------------------
  if (!map.getSource(R3_GHOST_SOURCE)) map.addSource(R3_GHOST_SOURCE, { type: 'geojson', data: EMPTY })
  if (!map.getLayer(R3_GHOST_LAYER))
    map.addLayer(
      {
        id: R3_GHOST_LAYER,
        type: 'line',
        source: R3_GHOST_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['case', ['get', 'valid'], TOKENS.color.textMuted, TOKENS.color.limit],
          'line-width': TOKENS.line.threadPx * 1.5,
          'line-dasharray': [2, 1.5],
        },
      },
      ctx.beforeId('edit'),
    )
  const ghostSrc = () => map.getSource(R3_GHOST_SOURCE) as GeoJsonSourceLike | undefined
  offs.push(effect(() => void ghostSrc()?.setData(ghostLine(ed.drag.value))))

  // ---- the map does not pan while a handle is dragged -------------------------------------------
  let panOff = false
  const dragPan = (map as unknown as { dragPan?: { isEnabled(): boolean; enable(): void; disable(): void } }).dragPan
  offs.push(
    effect(() => {
      const d = ed.drag.value
      if (d && !panOff && dragPan?.isEnabled()) {
        dragPan.disable()
        panOff = true
      } else if (!d && panOff) {
        dragPan?.enable()
        panOff = false
      }
    }),
  )

  // ---- handles ------------------------------------------------------------------------------------
  const handles = new Map<string, { m: MarkerLike; el: El; label: El; rm: El; off: () => void }>()
  function makeHandle(id: string) {
    const el = doc.createElement('div') as El
    el.className = 'hl-r3-handle'
    el.setAttribute('data-r3-stop', id)
    el.setAttribute('role', 'button')
    el.tabIndex = 0
    const label = doc.createElement('span') as El
    label.className = 'hl-r3-handle__name'
    const rm = doc.createElement('button') as El
    rm.className = 'hl-r3-handle__remove'
    rm.setAttribute('type', 'button')
    rm.setAttribute('data-r3-remove', id)
    rm.textContent = '×'
    el.appendChild(label)
    el.appendChild(rm)
    // the remove button never starts a drag or reaches the map
    const swallow = (e: Event) => e.stopPropagation()
    const onRemove = (e: Event) => {
      e.stopPropagation()
      e.preventDefault()
      ed.remove(id)
    }
    const onKey = (e: Event) => {
      const k = (e as KeyboardEvent).key
      if (k === 'Delete' || k === 'Backspace') {
        e.preventDefault()
        e.stopPropagation()
        ed.remove(id)
      }
    }
    const onMenu = (e: Event) => {
      e.preventDefault()
      el.classList.add('is-menu')
      el.focus()
    }
    const onBlur = () => el.classList.remove('is-menu')
    for (const t of ['pointerdown', 'mousedown', 'touchstart']) rm.addEventListener(t, swallow)
    rm.addEventListener('click', onRemove)
    el.addEventListener('keydown', onKey)
    el.addEventListener('contextmenu', onMenu)
    el.addEventListener('focusout', onBlur)
    const m = ctx.marker(el) as unknown as MarkerLike
    return {
      m,
      el,
      label,
      rm,
      off: () => {
        for (const t of ['pointerdown', 'mousedown', 'touchstart']) rm.removeEventListener(t, swallow)
        rm.removeEventListener('click', onRemove)
        el.removeEventListener('keydown', onKey)
        el.removeEventListener('contextmenu', onMenu)
        el.removeEventListener('focusout', onBlur)
        m.remove()
      },
    }
  }
  function place(): void {
    const on = ed.editing.value
    const pts = on ? ed.points.value : []
    const d = ed.drag.value
    const hover = ed.hoverId.value
    const ids = new Set(pts.map((p) => p.id))
    for (const [id, h] of handles)
      if (!ids.has(id)) {
        h.off()
        handles.delete(id)
      }
    for (const p of pts) {
      let h = handles.get(p.id)
      const fresh = !h
      if (!h) handles.set(p.id, (h = makeHandle(p.id)))
      const dragging = d?.id === p.id
      h.m.setLngLat(dragging ? [d.lon, d.lat] : [p.lon, p.lat])
      if (fresh) h.m.addTo(map as never)
      h.label.textContent = p.name
      const title = t('route.mapEdit.handle.title', { name: p.name })
      h.el.title = title
      h.el.setAttribute('aria-label', title)
      h.rm.setAttribute('aria-label', t('route.mapEdit.handle.remove', { name: p.name }))
      h.rm.title = t('route.mapEdit.handle.remove', { name: p.name })
      h.el.classList.toggle('is-dragging', dragging)
      h.el.classList.toggle('is-hover', hover === p.id)
      h.el.dataset.validity = dragging && d.valid === false ? 'invalid' : 'ok'
    }
  }
  offs.push(effect(place))

  // ---- notice + editing class ----------------------------------------------------------------------
  const box = doc.createElement('div') as El
  box.className = 'hl-r3-notice'
  box.setAttribute('role', 'status')
  box.setAttribute('aria-live', 'polite')
  container.appendChild(box)
  offs.push(() => box.remove())
  offs.push(
    effect(() => {
      const n = ed.notice.value
      box.textContent = n?.text ?? ''
      box.dataset.kind = n?.kind ?? ''
      box.hidden = !n
    }),
  )
  offs.push(effect(() => void container.classList.toggle('hl-r3-editing', ed.editing.value)))

  // ---- Escape cancels a drag ------------------------------------------------------------------------
  const onKey = (e: Event) => {
    if ((e as KeyboardEvent).key === 'Escape' && ed.cancelDrag()) e.stopPropagation()
  }
  win?.addEventListener('keydown', onKey)
  offs.push(() => win?.removeEventListener('keydown', onKey))

  return () => {
    for (const f of offs.reverse()) f()
    for (const h of handles.values()) h.off()
    handles.clear()
    if (panOff) dragPan?.enable()
    ghostSrc()?.setData(EMPTY)
  }
}
