// WS16 task 5 (M5): map furniture on the planning map (DESIGN U4): the thread home, the route
// draw-on, station markers, compass, cursor readout. ConsoleMap owns one MapFurniture; everything
// here reads the mission state (A3) and published files, and draws; it computes no number.
import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from 'maplibre-gl'
import { Marker } from 'maplibre-gl'
import { data } from '../../data/loader'
import type { RouteFC, Station } from '../../data/types'
import { dataUrl } from '../../env'
import { fieldGrid, loadField, type FieldGrid } from '../../hud/fields'
import { Plan } from '../../hud/plan'
import { userReplay, userReplayPosition } from '../../state/userReplay'
import { parseClockSun, type ClockFile } from '../../hud/sun'
import type { LonLat, TimelineEvent } from '../../hud/types'
import { loadPointer } from '../../hud/wayhome'
import { effect, mission, ui } from '../../state'
import { TOKENS } from '../../ui/tokens'
import { CompassControl } from '../compass'
import type { Metric } from '../flythrough/path'
import { fieldAt, FIELD_TRUST } from '../field'
import { MARKERS_TRUST, pulseFrame, stationFeatures, type MarkerStation } from '../markers'
import { CursorReadout, readoutValues } from '../readout'
import { playDrawOn, routeFeatures, routeLine, routeLineFromFC, turnBackTicks, type RouteLine, type TurnBackTick } from '../route'
import { dashPattern, setThreadSources, threadColor, threadPath, threadTooltip, THREAD_INTERVAL_MS, type ThreadPath } from '../thread'
import { hoverTipText, threadFrom, WAY_HOME_KEY, wayHomeHeld } from './hover'
import './furniture.css'

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

/** Metres per degree of the field grid (fields/index.json): the slope FieldGrid's metric, without the PNG. */
function gridMetric(ix: { bounds: number[]; width: number; height: number; res_m: number }): Metric {
  const [w, s, e, n] = ix.bounds
  return { mPerDegLon: (ix.width * ix.res_m) / (e - w), mPerDegLat: (ix.height * ix.res_m) / (n - s) }
}
/** Half length of a turn-back tick across the route, m. */
const TICK_HALF_M = 15
/** Station ring radius and pulse growth, px. */
const RING_R = 7
const PULSE_GROW = 12
/** Crew marker radius and halo radius, px (assumed: true, L10; one step larger than a station ring). */
const CREW_R = 8
const CREW_HALO_R = 14

/** L10 (D111): the crew marker (planned position at the mission clock), drawn with the route group. */
export const CREW_LAYERS = ['crew-halo', 'crew-dot']
export const ROUTE_LAYERS = ['route-coming', 'route-done', 'route-ticks', ...CREW_LAYERS]
export const MARKER_LAYERS = ['station-pulse', 'station-halo', 'station-rings']
const THREAD_LAYER = 'thread-line'

export class MapFurniture {
  private readonly map: MlMap
  private readonly readout = new CursorReadout()
  private readonly compass = new CompassControl()
  private readonly tooltip: HTMLDivElement
  private tooltipMarker: Marker | null = null
  /** L7a: the passive hover tooltip (a field lookup at the pointer, labelled estimate) */
  private readonly hoverTip: HTMLDivElement
  private hoverMarker: Marker | null = null
  private scenario: string | null = null
  private planSeq = 0
  private plan: Plan | null = null
  private line: RouteLine | null = null
  private ticks: TurnBackTick[] = []
  private drawFrac = 1
  private stopDraw: () => void = () => {}
  private routeShown = false
  private routeData: RouteFC | null = null
  private slope: FieldGrid | null = null
  private stations: MarkerStation[] = []
  private cursor: LonLat | null = null
  /** L7a: the way-home key (hover.ts WAY_HOME_KEY) is held: the explicit "thread from the pointer" mode */
  private wayHome = false
  private lastCompute = 0
  private timer = 0
  private raf = 0
  private dashStep = 0
  private dashAt = 0
  private thread: ThreadPath | null = null
  private pulseWas = false
  private paused = false
  private crewKey = ''
  /** L10: field grid metric from fields/index.json (= the slope grid's), set before the PNG fields load */
  private metric: Metric | null = null
  private pausedRenderAt = -Infinity
  private pulseKey = ''
  private readonly stops: (() => void)[] = []

  constructor(map: MlMap) {
    this.map = map
    const c = map.getContainer()
    c.setAttribute(MARKERS_TRUST.attr, MARKERS_TRUST.chip)
    c.setAttribute(MARKERS_TRUST.sourceAttr, MARKERS_TRUST.source)
    c.setAttribute('data-markers', 'rings')
    this.tooltip = document.createElement('div')
    this.tooltip.className = 'hl-thread-tooltip'
    this.tooltip.setAttribute('role', 'status')
    // trust-chip hook: the thread's numbers are Modelled (fieldAt over the WS2 fields)
    this.tooltip.setAttribute('data-trust', 'modelled')
    this.tooltip.setAttribute('data-trust-source', 'fields t_home.png o2_home.png pointer.png (fieldAt)')
    this.hoverTip = document.createElement('div')
    this.hoverTip.className = 'hl-thread-tooltip hl-hover-tip'
    this.hoverTip.setAttribute('role', 'status')
    this.hoverTip.setAttribute('data-trust', 'modelled')
    this.hoverTip.setAttribute('data-estimate', 'true')
    this.hoverTip.setAttribute('data-trust-source', 'fields t_home.png (fieldAt, nearest pixel)')
    this.addLayers()
    map.addControl(this.compass, 'top-right')
    map.addControl(this.readout, 'bottom-right')
    map.on('mousemove', this.onMove)
    map.on('mouseout', this.onOut)
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKey)
      window.addEventListener('keyup', this.onKey)
      window.addEventListener('blur', this.onBlur)
    }
    // the clock: crew position thread, done / coming route, next station, sun direction
    this.stops.push(
      effect(() => {
        const t = mission.clock.t.value
        void mission.clock.playing.value
        this.compass.setMinute(t)
        // L10: the crew marker moves on every clock change (frame-exact in capture, also in a live story)
        this.renderCrew(t)
        this.schedule()
        if (this.paused) this.clockWhilePaused()
      }),
      effect(() => {
        void ui.reducedMotion.value
        this.loop()
      }),
    )
    void data()
      .optional(() => data().clock())
      .then((c) => this.compass.setSun(c ? parseClockSun(c as unknown as ClockFile) : null))
      .catch(() => this.compass.setSun(null))
  }

  private addLayers(): void {
    const m = this.map
    const c = TOKENS.color
    m.addSource('route-m5', { type: 'geojson', data: EMPTY })
    m.addSource('stations-m5', { type: 'geojson', data: EMPTY })
    m.addSource('thread', { type: 'geojson', data: EMPTY })
    m.addSource('crew', { type: 'geojson', data: EMPTY })
    // route: coming legs 50 % under done legs (solid); turn-back ticks across the route
    m.addLayer({ id: 'route-coming', type: 'line', source: 'route-m5', filter: ['==', ['get', 'part'], 'coming'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.safe, 'line-width': 2.5, 'line-opacity': 0.5 } })
    m.addLayer({ id: 'route-done', type: 'line', source: 'route-m5', filter: ['==', ['get', 'part'], 'done'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.safe, 'line-width': 2.5 } })
    m.addLayer({ id: 'route-ticks', type: 'line', source: 'route-m5', filter: ['==', ['get', 'part'], 'tick'], layout: { 'line-cap': 'butt' }, paint: { 'line-color': c.text, 'line-width': 2 } })
    // stations: pulse (next only), scored-site halo, ring (thickness = value, fill = state)
    m.addLayer({ id: 'station-pulse', type: 'circle', source: 'stations-m5', filter: ['==', ['get', 'next'], true], paint: { 'circle-radius': RING_R, 'circle-opacity': 0, 'circle-stroke-color': c.science, 'circle-stroke-width': 2, 'circle-stroke-opacity': 0 } })
    m.addLayer({ id: 'station-halo', type: 'circle', source: 'stations-m5', filter: ['==', ['get', 'scored'], true], paint: { 'circle-radius': RING_R + 5, 'circle-opacity': 0, 'circle-stroke-color': ['get', 'stroke'], 'circle-stroke-width': 1 } })
    m.addLayer({ id: 'station-rings', type: 'circle', source: 'stations-m5', paint: { 'circle-radius': RING_R, 'circle-color': ['get', 'fill'], 'circle-stroke-color': ['get', 'stroke'], 'circle-stroke-width': ['get', 'ring'] } })
    // L10: the crew marker, above the route and the stations, under the thread home
    m.addLayer({ id: 'crew-halo', type: 'circle', source: 'crew', paint: { 'circle-radius': CREW_HALO_R, 'circle-color': c.text, 'circle-opacity': TOKENS.overlayOpacity.min, 'circle-pitch-alignment': 'viewport' } })
    m.addLayer({ id: 'crew-dot', type: 'circle', source: 'crew', paint: { 'circle-radius': CREW_R, 'circle-color': c.text, 'circle-stroke-color': c.bg, 'circle-stroke-width': 2, 'circle-pitch-alignment': 'viewport' } })
    // the thread home on top of everything
    m.addLayer({ id: THREAD_LAYER, type: 'line', source: 'thread', layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': c.text, 'line-width': TOKENS.line.threadPx, 'line-dasharray': dashPattern(0) } })
  }

  /** The published scenario the map shows (field loaded): its pointer field, pad, plan, slope. */
  async setScenario(scenarioId: string | null): Promise<void> {
    if (scenarioId === this.scenario) return
    this.scenario = scenarioId
    const seq = ++this.planSeq
    setThreadSources(null)
    if (!scenarioId) return this.schedule()
    const L = data()
    try {
      const [idx, pad] = await Promise.all([L.fieldsIndex(), L.optional(() => L.pad())])
      if (seq !== this.planSeq) return
      // L10: the plan (crew marker, legs) needs only the grid metric, the same numbers as the slope
      // grid's (FieldGrid: width × res_m / span); it no longer waits for the PNG fields to decode
      this.metric = idx.fields.slope ? gridMetric(fieldGrid(idx, 'slope')) : null
      await this.syncPlan()
      if (seq !== this.planSeq) return
      const key = `${scenarioId}/pointer`
      const [pointer, slope] = await Promise.all([
        idx.fields[key] ? loadPointer(idx, key, (p) => dataUrl(p)) : Promise.resolve(null),
        idx.fields.slope ? loadField(idx, 'slope', (p) => dataUrl(p)).catch(() => null) : Promise.resolve(null),
      ])
      if (seq !== this.planSeq) return
      this.slope = slope
      if (pointer && pad) setThreadSources({ pointer, pad: [pad.pad.lon, pad.pad.lat] })
      await this.syncPlan()
    } catch (e) {
      console.warn('thread home unavailable:', e)
    }
    this.schedule()
  }

  /** The route the console shows (null = none); draws itself on when a plan loads. */
  async setRoute(route: RouteFC | null): Promise<void> {
    this.routeData = route
    await this.syncPlan()
    this.drawOn()
  }

  /** Route group visibility (layer manager): turning it on draws the route on. */
  setRouteVisible(on: boolean): void {
    const was = this.routeShown
    this.routeShown = on
    this.markCrew()
    if (on && !was) this.drawOn()
  }

  setStations(stations: Station[]): void {
    this.stations = stations as unknown as MarkerStation[]
    this.renderStations()
  }

  /** WS7 Plan for the shown route, when its timeline is the published scenario's. */
  private async syncPlan(): Promise<void> {
    const r = this.routeData
    const L = data()
    let plan: Plan | null = null
    if (r && this.scenario) {
      const own = await L.optional(() => L.route(this.scenario!))
      const tl = own === r ? await L.optional(() => L.timeline(this.scenario!)) : null
      const metric = this.slope ?? this.metric
      if (tl && metric) {
        try {
          plan = new Plan(r as never, tl as unknown as TimelineEvent[], metric)
        } catch (e) {
          console.warn('route timing unavailable:', e)
        }
      }
    }
    if (r !== this.routeData) return
    this.plan = plan
    const lineMetric = this.slope ?? this.metric
    this.line = plan ? routeLine(plan) : r && lineMetric ? routeLineFromFC(r as never, lineMetric) : null
    this.ticks = plan ? turnBackTicks(plan, TICK_HALF_M) : []
    this.renderRoute()
    this.renderStations()
    this.renderCrew(mission.clock.t.peek())
  }

  /** L10: while a live story pauses the thread, the legs and the next station follow the clock at the thread rate. */
  private clockWhilePaused(): void {
    const now = performance.now()
    if (now - this.pausedRenderAt < THREAD_INTERVAL_MS) return
    this.pausedRenderAt = now
    this.renderRoute()
    this.renderStations()
  }

  /** L10: the crew's planned position at EVA minute t (none before the clock has started, as the thread). */
  private renderCrew(t: number): void {
    const src = this.map.getSource('crew') as GeoJSONSource | undefined
    if (!src) return
    const on = mission.clock.playing.peek() || t > 0
    // PORT F5: while the user's route replays, the crew walks the user's route (state/userReplay.ts)
    const mine = userReplay.peek() ? userReplayPosition(t) : null
    const st = mine ? (on ? { lon: mine[0], lat: mine[1], phase: 'walk' } : null) : this.plan && on ? this.plan.stateAt(t) : null
    const key = st ? `${st.lon},${st.lat}` : ''
    if (key === this.crewKey) return
    this.crewKey = key
    src.setData(st ? { type: 'Feature', geometry: { type: 'Point', coordinates: [st.lon, st.lat] }, properties: { phase: st.phase } } : EMPTY)
    this.markCrew()
  }

  /** html hook for tests and dry runs: map container data-crew = shown (drawn with the route) | hidden | none */
  private markCrew(): void {
    this.map.getContainer().setAttribute('data-crew', !this.crewKey ? 'none' : this.routeShown ? 'shown' : 'hidden')
  }

  private drawOn(): void {
    this.stopDraw()
    if (!this.line) return
    let first = true
    this.stopDraw = playDrawOn(
      (f) => {
        // L10: only on change. Under capture's frozen clock a frame repeats the same fraction; a setData
        // per animation frame kept the route source loading, so a capture step never settled (frame 0
        // took 8.5 min, notes/L10.md)
        if (!first && f === this.drawFrac) return
        first = false
        this.drawFrac = f
        this.renderRoute()
      },
      { reduced: ui.reducedMotion.peek() || !this.routeShown },
    )
  }

  private renderRoute(): void {
    const src = this.map.getSource('route-m5') as GeoJSONSource | undefined
    if (!src) return
    const l = this.line
    const walked = this.plan ? this.plan.stateAt(mission.clock.t.peek()).distanceWalkedM : 0
    src.setData(l ? routeFeatures(l, this.drawFrac, walked, this.ticks) : EMPTY)
  }

  private renderStations(): void {
    const src = this.map.getSource('stations-m5') as GeoJSONSource | undefined
    if (!src) return
    const onRoute = new Set(this.plan ? this.plan.legs.map((l) => l.to).filter((x): x is string => !!x) : [])
    const next = this.plan?.nextArrival(mission.clock.t.peek())?.station ?? null
    src.setData(stationFeatures(this.stations, onRoute, next))
  }

  // ---- cursor and clock: throttled to thread.update_hz ------------------------------------------
  // L7a (D111): a move only records where the pointer is; update() turns it into a passive lookup,
  // or into the thread from the pointer while the way-home key is held (never during the replay)
  private readonly onMove = (e: MapMouseEvent): void => {
    if (this.paused) return // a story is playing: hover changes nothing (D111)
    this.cursor = [e.lngLat.lng, e.lngLat.lat]
    this.wayHome = wayHomeHeld(e.originalEvent)
    this.schedule()
  }
  private readonly onOut = (): void => {
    this.cursor = null
    this.schedule()
  }
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key !== WAY_HOME_KEY) return
    const on = e.type === 'keydown'
    if (on === this.wayHome) return
    this.wayHome = on
    if (this.cursor) this.schedule()
  }
  private readonly onBlur = (): void => {
    if (!this.wayHome) return
    this.wayHome = false
    this.schedule()
  }

  /**
   * M10c pause hook: a live story (intro, kiosk) pauses the dash flow / pulse loop and the thread
   * updates (their layers are hidden or still while the camera flies); resume picks them up again.
   * L10 (D111): the crew marker and the done / coming legs and next station still follow the clock
   * while paused (clockWhilePaused), so the kiosk flythrough draws the route as it plays.
   */
  setPaused(on: boolean): void {
    if (this.paused === on) return
    this.paused = on
    if (on) {
      clearTimeout(this.timer)
      this.timer = 0
      this.cursor = null
    } else this.schedule()
    this.loop()
  }

  private schedule(): void {
    if (this.timer || this.paused) return
    const wait = Math.max(0, this.lastCompute + THREAD_INTERVAL_MS - performance.now())
    this.timer = window.setTimeout(() => {
      this.timer = 0
      this.lastCompute = performance.now()
      this.update()
    }, wait)
  }

  private update(): void {
    const t = mission.clock.t.peek()
    const playing = mission.clock.playing.peek()
    const mine = userReplay.peek() ? userReplayPosition(t) : null // PORT F5: the user's replay
    const crew = mine ? (playing || t > 0 ? { lon: mine[0], lat: mine[1] } : null) : this.plan && (playing || t > 0) ? this.plan.stateAt(t) : null
    // L7a (D111): hover never changes state: the replay keeps the crew's thread; the pointer gets one
    // only in the explicit mode (way-home key held, clock not playing)
    const start = threadFrom({ cursor: this.cursor, wayHome: this.wayHome, playing, crew: crew ? [crew.lon, crew.lat] : null })
    const from = start.at
    const c = this.map.getContainer()
    if (c.getAttribute('data-thread-from') !== start.kind) c.setAttribute('data-thread-from', start.kind) // tests, RR
    this.thread = from ? threadPath(from[0], from[1], t) : null
    const src = this.map.getSource('thread') as GeoJSONSource | undefined
    src?.setData(this.thread ? { type: 'Feature', geometry: { type: 'LineString', coordinates: this.thread.coords }, properties: {} } : EMPTY)
    if (this.map.getLayer(THREAD_LAYER)) this.map.setPaintProperty(THREAD_LAYER, 'line-color', threadColor(this.thread?.cls ?? 'none'))
    // tooltip at the start (inside the field grid only)
    const s = from ? fieldAt(from[0], from[1]) : null
    if (from && s?.inside) {
      this.tooltip.textContent = threadTooltip(this.thread)
      this.tooltip.setAttribute(FIELD_TRUST.attr, FIELD_TRUST.chip)
      this.tooltipMarker ??= new Marker({ element: this.tooltip, anchor: 'bottom-left', offset: [12, -12] })
      this.tooltipMarker.setLngLat(from).addTo(this.map)
    } else {
      this.tooltipMarker?.remove()
      this.tooltipMarker = null
    }
    // the passive hover tooltip: a field lookup at the pointer (estimate), unless the thread starts there
    const cs = this.cursor ? fieldAt(this.cursor[0], this.cursor[1]) : null
    const tip = this.cursor && start.kind !== 'pointer' ? hoverTipText(cs) : null
    if (this.cursor && tip !== null) {
      this.hoverTip.textContent = tip
      this.hoverTip.setAttribute(FIELD_TRUST.attr, FIELD_TRUST.chip)
      this.hoverMarker ??= new Marker({ element: this.hoverTip, anchor: 'top-left', offset: [12, 12] })
      this.hoverMarker.setLngLat(this.cursor).addTo(this.map)
    } else {
      this.hoverMarker?.remove()
      this.hoverMarker = null
    }
    this.readout.set(this.cursor ? readoutValues(this.cursor[0], this.cursor[1], cs, this.slope ? (lo, la) => this.slope!.valueAt(lo, la) : null) : null)
    this.renderRoute()
    this.renderStations()
    this.loop()
  }

  // ---- animation: dash flow (thread) and the next-station pulse; none under reduced motion ------
  private loop(): void {
    const reduced = ui.reducedMotion.peek()
    const want = !reduced && !this.paused && (this.thread !== null || this.hasNext())
    if (!want) {
      if (this.raf) cancelAnimationFrame(this.raf)
      this.raf = 0
      if (this.map.getLayer(THREAD_LAYER)) this.map.setPaintProperty(THREAD_LAYER, 'line-dasharray', dashPattern(0))
      this.setPulse(pulseFrame(0, true))
      return
    }
    if (this.raf) return
    const frame = (now: number): void => {
      this.raf = 0
      if (ui.reducedMotion.peek() || this.paused) return this.loop()
      if (this.thread && now - this.dashAt >= THREAD_INTERVAL_MS) {
        this.dashAt = now
        this.dashStep = (this.dashStep + 1) % 1e6
        // stepping is one dash pattern per update; the line runs start -> pad, so dashes flow home
        this.map.setPaintProperty(THREAD_LAYER, 'line-dasharray', dashPattern(this.dashStep))
      }
      this.setPulse(pulseFrame(now, false))
      if (this.thread || this.hasNext()) this.raf = requestAnimationFrame(frame)
    }
    this.raf = requestAnimationFrame(frame)
  }

  private hasNext(): boolean {
    return !!this.plan?.nextArrival(mission.clock.t.peek())
  }

  private setPulse(p: { active: boolean; grow: number; opacity: number }): void {
    if (!p.active && !this.pulseWas) return
    this.pulseWas = p.active
    if (!this.map.getLayer('station-pulse')) return
    // L10: only on change. A paint write marks the style dirty (map.loaded() false); under capture's
    // frozen clock the pulse repeats the same frame on every rAF, so a capture step never settled
    const key = `${p.grow},${p.opacity}`
    if (key === this.pulseKey) return
    this.pulseKey = key
    this.map.setPaintProperty('station-pulse', 'circle-radius', RING_R + PULSE_GROW * p.grow)
    this.map.setPaintProperty('station-pulse', 'circle-stroke-opacity', p.opacity)
  }

  destroy(): void {
    this.stops.forEach((s) => s())
    this.stopDraw()
    clearTimeout(this.timer)
    if (this.raf) cancelAnimationFrame(this.raf)
    this.map.off('mousemove', this.onMove)
    this.map.off('mouseout', this.onOut)
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKey)
      window.removeEventListener('keyup', this.onKey)
      window.removeEventListener('blur', this.onBlur)
    }
    this.tooltipMarker?.remove()
    this.hoverMarker?.remove()
    setThreadSources(null)
  }
}
