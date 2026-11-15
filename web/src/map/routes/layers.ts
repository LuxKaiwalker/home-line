// PORT R4: the route layers on the Plan map (interfaces §3 registerRouteLayer 'official' | 'mine').
//
//   official  the active pad's precomputed route (pad env plan products, P1/P2): thin, safe token,
//             labelled "Official route for this pad". Pad switch: the old pad's route goes at once.
//   mine      "Your route": bold line with a background casing, numbered stops (stopLabels), legs from
//             the route results (§9); first infeasible leg and onward in the limit token, legs still
//             computing as a dashed ghost (the edit ghost's style, edit/route/map/layer.ts), refined
//             legs swap silently (setData, no animation).
//
// Visibility = the host's setVisible AND the planning view toggle (view.showOfficial / showMine).
// Stacking: every layer goes in the 'route' slot (ctx.beforeId), above field / bands, under the
// furniture route, markers and labels. Updates are setData on one source per kind, coalesced to one
// per frame; layers are added once at install and removed at destroy.
import type { GeoJSONSource } from 'maplibre-gl'
import { padService as appPadService, type PadId, type PadService } from '../../pads'
import { planning, type PlanningStore, type PlanStop } from '../../state/planning'
import { t } from '../../ui/copy'
import { TOKENS } from '../../ui/tokens'
import type { MapExtensionContext, RouteLayerHandle, RouteLayerSpec } from '../extensions'
import { captureKeys, EMPTY_FC, labelAt, mineView, officialLines, type LonLat, type StopMark } from './features'
import { getRouteResults, subscribeRouteResults, type LegResult, type RouteResults } from '../../state/routeResults'


export const OFFICIAL_SOURCE = 'r4-official'
export const OFFICIAL_LAYER = 'r4-official-line'
export const MINE_SOURCE = 'r4-mine'
/** bottom to top */
export const MINE_LAYERS = ['r4-mine-casing', 'r4-mine-ghost', 'r4-mine-ok', 'r4-mine-bad'] as const

export interface ResultsSource {
  get(): RouteResults
  subscribe(fn: (r: RouteResults) => void): () => void
}

export interface RouteLayerDeps {
  /** planning store (default: the app's `planning`) */
  store?: PlanningStore
  /** pad service (default: pads/ padService(), read at call time so P1's swap is seen) */
  pads?: () => PadService
  /** route results (default: §9 getRouteResults / subscribeRouteResults) */
  results?: ResultsSource
  /** station position by id (I1 wires the station list); fallback: the result paths' ends */
  stationAt?: (id: string) => LonLat | null
  /** station display name by id (fallback: the id, as stopLabels) */
  stationName?: (id: string) => string | null
  /** frame scheduler (default requestAnimationFrame, else synchronous) */
  schedule?: (fn: () => void) => void
  doc?: Document
}

const defaultSchedule = (fn: () => void): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn)
  else fn()
}
const appResults: ResultsSource = { get: getRouteResults, subscribe: subscribeRouteResults }

type Marker = ReturnType<MapExtensionContext['marker']>

/** Replace an element's text (a text node: works on the DOM and on the test DOM, ui/testing/dom). */
function setText(doc: Document, el: HTMLElement, text: string): void {
  el.textContent = ''
  el.appendChild(doc.createTextNode(text))
}

/** One-shot-per-frame runner: many changes in a frame give one render. */
function frameRunner(schedule: (fn: () => void) => void, run: () => void) {
  let queued = false
  let dead = false
  return {
    request() {
      if (queued || dead) return
      queued = true
      schedule(() => {
        queued = false
        if (!dead) run()
      })
    },
    stop() {
      dead = true
    },
  }
}

function setVis(ctx: MapExtensionContext, ids: readonly string[], on: boolean): void {
  for (const id of ids) if (ctx.map.getLayer(id)) ctx.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
}
function setData(ctx: MapExtensionContext, id: string, data: GeoJSON.FeatureCollection): void {
  ;(ctx.map.getSource(id) as GeoJSONSource | undefined)?.setData(data)
}
function removeAll(ctx: MapExtensionContext, layers: readonly string[], source: string): void {
  for (const id of [...layers].reverse()) if (ctx.map.getLayer(id)) ctx.map.removeLayer(id)
  if (ctx.map.getSource(source)) ctx.map.removeSource(source)
}

function padPos(svc: PadService, id: PadId): LonLat | null {
  const env = svc.peekPadEnv(id)
  if (env) return [env.routingFields.pad.lon, env.routingFields.pad.lat]
  const info = svc.listPads().find((p) => p.id === id)
  return info ? [info.lon, info.lat] : null
}

// ---- official ------------------------------------------------------------------------------------

export function officialRouteLayer(deps: RouteLayerDeps = {}): RouteLayerSpec {
  return {
    kind: 'official',
    install(ctx: MapExtensionContext): RouteLayerHandle {
      const store = deps.store ?? planning
      const pads = deps.pads ?? appPadService
      const doc = deps.doc ?? document
      const m = ctx.map
      m.addSource(OFFICIAL_SOURCE, { type: 'geojson', data: EMPTY_FC })
      m.addLayer(
        {
          id: OFFICIAL_LAYER,
          type: 'line',
          source: OFFICIAL_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          // thin: the precomputed plan is the reference, your route is the bold one
          paint: { 'line-color': TOKENS.color.safe, 'line-width': TOKENS.line.fieldEdgePx, 'line-opacity': TOKENS.overlayOpacity.max },
        },
        ctx.beforeId('route'),
      )
      const el = doc.createElement('div')
      el.setAttribute('class', 'hl-r4-label hl-r4-label--official')
      el.setAttribute('data-route', 'official')
      setText(doc, el, t('route.map.official'))
      let label: Marker | null = null
      let anchor: LonLat | null = null
      let hostOn = true
      let viewOn = store.view.peek().showOfficial
      let seq = 0
      let dead = false

      const placeLabel = () => {
        const on = hostOn && viewOn && anchor !== null
        if (!on) {
          label?.remove()
          label = null
          return
        }
        label ??= ctx.marker(el)
        label.setLngLat(anchor!).addTo(m)
      }
      const show = (fc: ReturnType<typeof officialLines>) => {
        setData(ctx, OFFICIAL_SOURCE, fc)
        anchor = labelAt(fc)
        placeLabel()
      }
      const applyVis = () => {
        setVis(ctx, [OFFICIAL_LAYER], hostOn && viewOn)
        placeLabel()
      }
      const load = (padId: PadId) => {
        const my = ++seq
        show(EMPTY_FC) // never the previous pad's route under the new pad
        const svc = pads()
        const env = svc.peekPadEnv(padId)
        void (env ? Promise.resolve(env) : svc.loadPadEnv(padId))
          .then((e) => e.planProducts())
          .then((p) => {
            if (!dead && my === seq) show(officialLines(p.route))
          })
          .catch(() => {
            /* pad not loadable (stub service, offline): no official route drawn; the pad layer reports it */
          })
      }

      applyVis()
      load(store.doc.peek().padId)
      let lastPad = store.doc.peek().padId
      const offDoc = store.doc.subscribe((d) => {
        if (d.padId === lastPad) return
        lastPad = d.padId
        load(d.padId)
      })
      const offView = store.view.subscribe((v) => {
        if (v.showOfficial === viewOn) return
        viewOn = v.showOfficial
        applyVis()
      })
      return {
        setVisible(on) {
          hostOn = on
          applyVis()
        },
        destroy() {
          dead = true
          offDoc()
          offView()
          label?.remove()
          label = null
          removeAll(ctx, [OFFICIAL_LAYER], OFFICIAL_SOURCE)
        },
      }
    },
  }
}

// ---- mine ----------------------------------------------------------------------------------------

export function mineRouteLayer(deps: RouteLayerDeps = {}): RouteLayerSpec {
  return {
    kind: 'mine',
    install(ctx: MapExtensionContext): RouteLayerHandle {
      const store = deps.store ?? planning
      const pads = deps.pads ?? appPadService
      const results = deps.results ?? appResults
      const doc = deps.doc ?? document
      const m = ctx.map
      const c = TOKENS.color
      const w = TOKENS.line.threadPx
      const before = ctx.beforeId('route')
      const notGhost = ['!=', ['get', 'state'], 'ghost']
      m.addSource(MINE_SOURCE, { type: 'geojson', data: EMPTY_FC })
      const round = { 'line-cap': 'round', 'line-join': 'round' } as const
      // bold: a background casing under the line keeps it readable on the field colours
      m.addLayer({ id: 'r4-mine-casing', type: 'line', source: MINE_SOURCE, filter: notGhost as never, layout: round, paint: { 'line-color': c.bg, 'line-width': w * 3 } }, before)
      // still computing: the edit ghost's look (muted, dashed; edit/route/map/layer.ts)
      m.addLayer({ id: 'r4-mine-ghost', type: 'line', source: MINE_SOURCE, filter: ['==', ['get', 'state'], 'ghost'] as never, layout: round, paint: { 'line-color': c.textMuted, 'line-width': w * 1.5, 'line-dasharray': [2, 1.5] } }, before)
      m.addLayer({ id: 'r4-mine-ok', type: 'line', source: MINE_SOURCE, filter: ['==', ['get', 'state'], 'ok'] as never, layout: round, paint: { 'line-color': c.text, 'line-width': w * 2 } }, before)
      m.addLayer({ id: 'r4-mine-bad', type: 'line', source: MINE_SOURCE, filter: ['==', ['get', 'state'], 'infeasible'] as never, layout: round, paint: { 'line-color': c.limit, 'line-width': w * 2 } }, before)

      let hostOn = true
      let viewOn = store.view.peek().showMine
      let stops: readonly PlanStop[] = store.doc.peek().route.stops
      let padId = store.doc.peek().padId
      let res = results.get()
      let keys: Map<LegResult, string> = captureKeys(res, stops, padId)
      const pool: { el: HTMLElement; marker: Marker; at: LonLat | null; text: string; state: string; shown: boolean }[] = []
      // PORT I4 a11y: the infeasible part is not told by colour alone: a text label at the middle of the
      // first infeasible leg ("Not feasible from here on", the legend's words)
      const badEl = doc.createElement('div')
      badEl.setAttribute('class', 'hl-r4-label hl-r4-label--infeasible')
      badEl.setAttribute('data-route', 'mine-infeasible')
      setText(doc, badEl, t('route.map.infeasible'))
      let bad: { marker: Marker; at: LonLat } | null = null
      const syncBad = (fc: ReturnType<typeof mineView>['fc'], on: boolean) => {
        const leg = on ? fc.features.find((f) => f.properties.state === 'infeasible' && f.geometry.coordinates.length > 0) : undefined
        if (!leg) {
          bad?.marker.remove()
          bad = null
          return
        }
        const cs = leg.geometry.coordinates
        const at = cs[Math.floor((cs.length - 1) / 2)] as LonLat
        if (bad && bad.at[0] === at[0] && bad.at[1] === at[1]) return
        const marker = bad?.marker ?? ctx.marker(badEl)
        marker.setLngLat(at)
        if (!bad) marker.addTo(m)
        bad = { marker, at }
      }

      const visible = () => hostOn && viewOn
      const syncMarks = (marks: StopMark[]) => {
        const on = visible()
        for (let i = 0; i < marks.length; i++) {
          const s = marks[i]
          let p = pool[i]
          if (!p) {
            const el = doc.createElement('div')
            el.setAttribute('class', 'hl-r4-stop')
            el.setAttribute('data-route', 'mine')
            p = { el, marker: ctx.marker(el), at: null, text: '', state: '', shown: false }
            pool.push(p)
          }
          const text = String(s.n)
          if (p.text !== text) {
            p.text = text
            setText(doc, p.el, text)
          }
          const state = s.infeasible ? 'infeasible' : 'ok'
          const title = t(s.infeasible ? 'route.map.stopInfeasible' : 'route.map.stop', { n: s.n, name: s.label })
          if (p.state !== state + title) {
            p.state = state + title
            p.el.setAttribute('data-state', state)
            p.el.setAttribute('title', title)
            p.el.setAttribute('aria-label', title)
          }
          const show = on && s.at !== null
          if (show && (!p.at || p.at[0] !== s.at![0] || p.at[1] !== s.at![1])) {
            p.marker.setLngLat(s.at!)
            p.at = s.at
          }
          if (show && !p.shown) p.marker.addTo(m)
          if (!show && p.shown) p.marker.remove()
          p.shown = show
        }
        for (const p of pool.splice(marks.length)) p.marker.remove()
      }
      const render = () => {
        const v = mineView({ stops, padId, pad: padPos(pads(), padId), results: res, keys, stationAt: deps.stationAt, stationName: deps.stationName })
        setData(ctx, MINE_SOURCE, v.fc)
        syncMarks(v.stops)
        syncBad(v.fc, visible())
      }
      const frame = frameRunner(deps.schedule ?? defaultSchedule, render)

      const offDoc = store.doc.subscribe((d) => {
        if (d.route.stops === stops && d.padId === padId) return
        stops = d.route.stops
        padId = d.padId
        frame.request()
      })
      const offRes = results.subscribe((r) => {
        res = r
        keys = captureKeys(r, stops, padId)
        frame.request()
      })
      const offView = store.view.subscribe((v) => {
        if (v.showMine === viewOn) return
        viewOn = v.showMine
        setVis(ctx, MINE_LAYERS, visible())
        frame.request()
      })
      setVis(ctx, MINE_LAYERS, visible())
      render()
      return {
        setVisible(on) {
          if (on === hostOn) return
          hostOn = on
          setVis(ctx, MINE_LAYERS, visible())
          frame.request()
        },
        destroy() {
          frame.stop()
          offDoc()
          offRes()
          offView()
          for (const p of pool.splice(0)) p.marker.remove()
          bad?.marker.remove()
          bad = null
          removeAll(ctx, MINE_LAYERS, MINE_SOURCE)
        },
      }
    },
  }
}
