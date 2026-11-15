// PORT P2: pad layer on the Plan map (Notion "Port Mission Planer into Plan" §2.2; interfaces.md §3, §7).
//   - markers + short labels for every pad of the pads index (official pad, P2–P4 …; pads/ listPads())
//   - a click opens the pad pop-up card (PadCard.tsx, rendered by the 'pad-layer' slot)
//   - setPadEnvironment(env): the env swap (swap.ts) with the pad's lazily loaded plan products
// Registered with registerPadEnvironment (map/extensions.ts); ConsoleMap installs it once its style is loaded.
// Nothing here waits on the network before the map draws: markers appear when the index is there, a pad's
// products replace the official plan when they arrive (the previous plan stays drawn until then).
import type { Marker } from 'maplibre-gl'
import type { Dispose, MapExtensionContext, PadEnvironmentHandler } from '../extensions'
import { listPads, loadPadIndex, prefetchPads } from '../../pads'
import { OFFICIAL_PAD_ID, type PadEnv, type PadId, type PadInfo } from '../../pads/types'
import { effect, signal } from '../../state/signal'
import { motionMs, TOKENS } from '../../ui/tokens'
import { containerSpec, openContainer, registerContainer, type CardMap } from '../../ui/layout'
import { createEnvSwap, type EnvSwap, type SwapMap } from './swap'
import { t } from '../../ui/copy'
import { GROUND_ATTR, groundPointers } from '../labels/pointer'

/** Layout-store id of the pad pop-up card (one card; its content follows padLayer.card). */
export const PAD_CARD_ID = 'pad-card'

/** What is drawn on the map: the pad whose env was set, and whether its products are drawn yet. */
export type PadShown = { id: PadId; status: 'ready' | 'loading' | 'error' }

/** Pad-layer state for the slot (card, status line) and tests. */
export const padLayer = {
  /** the pads with markers (index order: official first, then by rank) */
  pads: signal<readonly PadInfo[]>([]),
  /** the pad whose card is open (or was last opened) */
  card: signal<PadId | null>(null),
  shown: signal<PadShown>({ id: OFFICIAL_PAD_ID, status: 'ready' }),
  /** the installed map (card anchor); null when not installed */
  map: signal<CardMap | null>(null),
}

/** Open the pad pop-up card for `id` (marker click; I1 may bind the U13 label pills P2–P5 to this too). */
export function openPadCard(id: PadId, opener: HTMLElement | null = null): void {
  padLayer.card.value = id
  prefetchPads([id]) // the user is looking at this pad: start its fields early (cached service: no-op)
  if (!containerSpec(PAD_CARD_ID)) registerContainer({ id: PAD_CARD_ID, kind: 'card' })
  openContainer(PAD_CARD_ID, opener)
}

export interface PadLayerOptions {
  /** fade-in of a new pad's layers (ms); default the data-motion token, 0 under reduced motion */
  fadeMs?: () => number
}

/** Short marker label: the index label ("Official pad", "P2" …). */
export const markerLabel = (p: PadInfo): string => p.label

/** Marker classes: the pad on the map (is-active) and its loading (skeleton) state. */
export function markerClass(p: PadInfo, shown: PadShown | null): string {
  const on = shown?.id === p.id
  return ['hl-padmark', p.official && 'hl-padmark--official', on && 'is-active', on && shown.status === 'loading' && 'is-loading', on && shown.status === 'error' && 'is-error'].filter(Boolean).join(' ')
}

function markerEl(doc: Document, p: PadInfo): HTMLButtonElement {
  const el = doc.createElement('button')
  el.setAttribute('type', 'button')
  el.setAttribute('class', markerClass(p, null))
  el.setAttribute('data-pad-mark', p.id)
  el.setAttribute(GROUND_ATTR, '') // F10: 3D leader line down to a ground dot
  el.appendChild(doc.createTextNode(markerLabel(p)))
  el.setAttribute('title', t('route.padmap.marker.title', { pad: markerLabel(p) }))
  el.setAttribute('aria-haspopup', 'dialog')
  el.addEventListener('click', (ev) => {
    ev.stopPropagation() // not a map click (selection, waypoint editing)
    openPadCard(p.id, el)
  })
  return el
}

export function createPadEnvironmentHandler(opts: PadLayerOptions = {}): PadEnvironmentHandler {
  const fadeMs = opts.fadeMs ?? (() => motionMs('dataMs', 'min'))
  let swap: EnvSwap | null = null
  let seq = 0
  let pending: PadEnv | null | undefined = undefined

  const apply = (env: PadEnv | null): void => {
    const s = ++seq
    if (!swap) return void (pending = env)
    if (!env || env.info.official || env.info.id === OFFICIAL_PAD_ID) {
      swap.show(null)
      padLayer.shown.value = { id: OFFICIAL_PAD_ID, status: 'ready' }
      return
    }
    const id = env.info.id
    padLayer.shown.value = { id, status: 'loading' }
    let products: ReturnType<PadEnv['planProducts']>
    try {
      products = env.planProducts()
    } catch (e) {
      products = Promise.reject(e)
    }
    products.then(
      (p) => {
        if (s !== seq || !swap) return
        swap.show(p)
        padLayer.shown.value = { id, status: 'ready' }
      },
      (e) => {
        if (s !== seq) return
        console.warn(`pad ${id}: plan products unavailable; the map keeps the previous plan:`, e)
        padLayer.shown.value = { id, status: 'error' }
      },
    )
  }

  return {
    id: 'p2-pad-layer',
    install(ctx: MapExtensionContext): Dispose {
      swap = createEnvSwap(ctx.map as unknown as SwapMap, { fadeMs })
      padLayer.map.value = ctx.map as unknown as CardMap
      registerContainer({ id: PAD_CARD_ID, kind: 'card' })
      const doc = (ctx.map.getContainer?.()?.ownerDocument ?? globalThis.document) as Document
      let markers: { id: PadId; p: PadInfo; el: HTMLButtonElement; m: Marker }[] = []
      let alive = true
      // F10: in 3D each label floats above its pad with a leader line down to a ground dot
      const offGround = groundPointers(ctx.map)

      const draw = (list: readonly PadInfo[]) => {
        if (!alive) return
        for (const x of markers) x.m.remove()
        padLayer.pads.value = list
        markers = list.map((p) => {
          const el = markerEl(doc, p)
          // the label sits just under the pad point (the pad graphic and the rover drag stay clickable)
          const m = ctx.marker(el).setLngLat([p.lon, p.lat]).setOffset([0, TOKENS.space[4]]).addTo(ctx.map)
          return { id: p.id, p, el, m }
        })
        sync()
      }
      // marker states: the pad on the map, its loading state, the open card
      const sync = () => {
        const shown = padLayer.shown.peek()
        for (const x of markers) {
          // PORT F19: keep MapLibre's own classes (maplibregl-marker = position absolute at the projected
          // point); rewriting the whole class attribute dropped them and the pins fell out of place
          const keep = (x.el.getAttribute('class') ?? '').split(/\s+/).filter((c) => c.startsWith('maplibregl-'))
          x.el.setAttribute('class', [markerClass(x.p, shown), ...keep].join(' '))
          x.el.setAttribute('aria-current', x.id === shown.id ? 'true' : 'false')
        }
      }
      const stopSync = effect(() => {
        padLayer.shown.value
        sync()
      })

      const now = listPads()
      if (now.length) draw(now)
      else
        loadPadIndex().then(draw, (e) => {
          // no index (P1 not there yet, file missing): no markers, the official plan as today
          console.warn('pads index unavailable; no pad markers:', e)
        })

      if (pending !== undefined) {
        const env = pending
        pending = undefined
        apply(env)
      }
      return () => {
        alive = false
        stopSync()
        offGround()
        for (const x of markers) x.m.remove()
        markers = []
        swap?.dispose()
        swap = null
        seq++
        padLayer.map.value = null
        padLayer.pads.value = []
        padLayer.shown.value = { id: OFFICIAL_PAD_ID, status: 'ready' }
      }
    },
    setPadEnvironment: apply,
  }
}
