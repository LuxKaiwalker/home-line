// Planning-console map (F17 default view, F5 slider, F6 scenario layers). Plain TS + MapLibre.
// Offline by construction: the style has no glyphs, sprite or remote source; every source is a
// local data file or a canvas-made image. Labels are HTML markers.
import { LngLatBounds, Map as MlMap, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl'
import type { ExpressionSpecification, FilterSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { CONFIG } from '../config'
import { accessFor, walkInLines } from '../data/access'
import { data } from '../data/loader'
import { drawnPartner } from '../data/partner'
import type { AnyFC, BandsFC, EdgesFC, IsochroneFC, PartnerFC, RouteFC, ScenarioEntry, Station } from '../data/types'
import { THEME } from '../theme'
import type { BasemapSource } from './basemap'
import { hatchDataUrl } from './hatch'
import { edgeLabelPoints } from './labels'
import { binEdges, stepColorExpression } from './legend'
import { MarsScaleControl } from './scale'
import { activeField, FIELD_TRUST, fieldRequested, loadFieldData, loadFieldLayer, setActiveField, VARIANT_OF, webgl2Available, type FieldData } from './field'

/** The GPU field layer handle (field/layer.ts, loaded lazily). */
type FieldLayerHandle = ReturnType<Awaited<ReturnType<typeof loadFieldLayer>>['addFieldLayer']>

/** Polygon layers the GPU field replaces while it is on (they stay as the fallback, DESIGN U2 item 8). */
const POLYGON_BAND_LAYERS = ['band-opt', 'band-con', 'band-lines']

// After bundling, MapLibre cannot find its worker next to itself; point it at the emitted asset.
setWorkerUrl(workerUrl)

export type LayerGroup = 'basemap' | 'bands' | 'unknown' | 'edges' | 'stations' | 'slider' | 'route' | 'partner' | 'siting'

/** Default visibility: SPEC F17 default view = basemap, 30-min nominal band, edge causes, stations. */
export const DEFAULT_VISIBLE: Record<LayerGroup, boolean> = {
  basemap: true,
  bands: true,
  unknown: true,
  edges: true,
  stations: true,
  slider: false,
  route: false,
  partner: false, // never in the default view (brief WS5 "Don't")
  siting: false, // F8 heatmap (siting score); D21 picks the official pad by feasible EVAs
}

const GROUP_LAYERS: Record<LayerGroup, string[]> = {
  basemap: ['basemap'],
  bands: ['band-opt', 'band-con', 'band-lines'],
  unknown: ['unknown-hatch'],
  edges: ['edges-line'],
  stations: ['walkin-line', 'access-pts'],
  slider: ['iso-fill', 'iso-lines', 'iso-current'],
  route: ['route-line'],
  partner: ['partner-line'],
  siting: ['siting-img'],
}

export function blankStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': THEME.mapBackground } }],
  }
}

const EMPTY: AnyFC = { type: 'FeatureCollection', features: [] }

export class ConsoleMap {
  readonly map: MlMap
  private ready: Promise<void>
  private visible: Record<LayerGroup, boolean> = { ...DEFAULT_VISIBLE }
  private budget: number = CONFIG.walkbackBudgetsMin[0]
  private variant = 'nominal'
  private sliderMin = CONFIG.walkbackBudgetsMin[0]
  private edges: EdgesFC | null = null
  private stationMarkers: Marker[] = []
  private padMarker?: Marker
  private sitingMarkers: Marker[] = []
  private padOptionMarkers: Marker[] = []
  private edgeMarkers: Marker[] = []
  private hasBasemap = false
  private groupLayers: Record<LayerGroup, string[]> = Object.fromEntries(Object.entries(GROUP_LAYERS).map(([k, v]) => [k, [...v]])) as Record<LayerGroup, string[]>
  private readonly onStation: (id: string) => void
  // WS16 task 2: GPU field layer (bands mode). Drawn only for the published scenario bands (the field
  // PNGs exist for those); D21 parking options, live previews, no WebGL2 or ?field=off -> polygons.
  private readonly fieldWanted = fieldRequested(location.search, location.hash) && webgl2Available()
  private fieldFailed = false
  private fieldSeq = 0
  private fieldLayer: FieldLayerHandle | null = null
  private fieldData: FieldData | null = null
  private fieldOn = false
  private stationsScenario: string | null = null

  constructor(container: HTMLElement, onStation: (id: string) => void) {
    this.onStation = onStation
    // Trust-chip hook (DESIGN §3.6): the homeline layer group is Modelled; A2's chip attaches here.
    container.setAttribute(FIELD_TRUST.attr, FIELD_TRUST.chip)
    container.setAttribute(FIELD_TRUST.renderAttr, 'polygons')
    const f = CONFIG.aoiFocus
    this.map = new MlMap({
      container,
      style: blankStyle(),
      bounds: [f.west, f.south, f.east, f.north],
      fitBoundsOptions: { padding: 40 },
      attributionControl: false,
      maxPitch: 0,
      dragRotate: false,
      renderWorldCopies: false,
      canvasContextAttributes: { preserveDrawingBuffer: true }, // screen capture (Sun 12:00-16:00) reads the canvas
    })
    this.map.touchZoomRotate.disableRotation()
    this.map.addControl(new NavigationControl({ showCompass: false }), 'top-left')
    this.map.addControl(new MarsScaleControl(CONFIG.marsRadiusM), 'bottom-left')
    this.ready = new Promise((res) => this.map.once('load', () => res()))
    this.ready.then(() => this.initLayers())
  }

  whenReady(): Promise<void> {
    return this.ready
  }

  private initLayers(): void {
    const m = this.map
    for (const id of ['bands', 'iso', 'edges', 'partner', 'route', 'walkin', 'access']) m.addSource(id, { type: 'geojson', data: EMPTY })

    const { max } = CONFIG.isochroneMinutes
    const isoColor = stepColorExpression('minutes', binEdges(max, THEME.isoBinStepMin), [...THEME.isoRamp]) as ExpressionSpecification
    m.addLayer({ id: 'iso-fill', type: 'fill', source: 'iso', paint: { 'fill-color': isoColor, 'fill-opacity': THEME.isoFillOpacity } })
    m.addLayer({
      id: 'band-opt',
      type: 'fill',
      source: 'bands',
      paint: { 'fill-color': THEME.variant.optimistic, 'fill-opacity': THEME.bandFillOpacity.optimistic },
    })
    m.addLayer({
      id: 'band-con',
      type: 'fill',
      source: 'bands',
      paint: { 'fill-color': THEME.variant.conservative, 'fill-opacity': THEME.bandFillOpacity.conservative },
    })
    m.addLayer({ id: 'iso-lines', type: 'line', source: 'iso', paint: { 'line-color': isoColor, 'line-width': 1, 'line-opacity': 0.9 } })
    m.addLayer({ id: 'iso-current', type: 'line', source: 'iso', paint: { 'line-color': '#ffffff', 'line-width': 2 } })
    m.addLayer({
      id: 'band-lines',
      type: 'line',
      source: 'bands',
      paint: {
        'line-color': ['match', ['get', 'variant'], 'optimistic', THEME.variant.optimistic, 'conservative', THEME.variant.conservative, THEME.variant.nominal],
        'line-width': THEME.bandLineWidth.other,
      },
    })
    m.addLayer({ id: 'partner-line', type: 'line', source: 'partner', paint: { 'line-color': THEME.partner, 'line-width': 2, 'line-dasharray': [3, 2] } })
    m.addLayer({
      id: 'edges-line',
      type: 'line',
      source: 'edges',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['match', ['get', 'cause'], 'physiology', THEME.cause.physiology, 'slope', THEME.cause.slope, THEME.cause.data],
        'line-width': THEME.edgeLineWidth,
      },
    })
    m.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': THEME.route, 'line-width': 2.5, 'line-dasharray': [1, 1.5] },
    })
    // Access-cell rule (user 11:40): straight walk-in line science -> access cell, and the access cell.
    m.addLayer({ id: 'walkin-line', type: 'line', source: 'walkin', paint: { 'line-color': THEME.station, 'line-width': 1.5, 'line-dasharray': [1, 1] } })
    m.addLayer({
      id: 'access-pts',
      type: 'circle',
      source: 'access',
      paint: { 'circle-radius': 4, 'circle-color': THEME.mapBackground, 'circle-stroke-color': THEME.station, 'circle-stroke-width': 2 },
    })
    this.applyFilters()
    this.applyVisibility()
  }

  /** Basemap raster sources (tilejson.json, see basemap.ts), under every other layer. */
  async setBasemap(sources: BasemapSource[]): Promise<void> {
    await this.ready
    if (!sources.length || this.hasBasemap) return
    const ids: string[] = []
    sources.forEach((src, i) => {
      const id = `basemap-${i}`
      this.map.addSource(id, { type: 'raster', tiles: src.tiles, tileSize: src.tileSize, minzoom: src.minzoom, maxzoom: src.maxzoom, bounds: src.bounds, attribution: src.attribution })
      this.map.addLayer(
        { id, type: 'raster', source: id, ...(src.layerMinzoom !== undefined ? { minzoom: src.layerMinzoom } : {}), paint: { 'raster-opacity': THEME.basemapOpacity, 'raster-fade-duration': 0 } },
        'iso-fill',
      )
      ids.push(id)
    })
    this.groupLayers.basemap = ids
    this.hasBasemap = true
    this.applyVisibility()
  }

  async setScenarioData(d: { bands: BandsFC; isochrones: IsochroneFC; edges: EdgesFC; partner: PartnerFC; variant: string }): Promise<void> {
    await this.ready
    this.variant = d.variant
    this.edges = d.edges
    ;(this.map.getSource('bands') as GeoJSONSource).setData(d.bands)
    ;(this.map.getSource('iso') as GeoJSONSource).setData(d.isochrones)
    ;(this.map.getSource('edges') as GeoJSONSource).setData(d.edges)
    ;(this.map.getSource('partner') as GeoJSONSource).setData(drawnPartner(d.partner)) // D20: cart only, drag never drawn
    this.applyFilters()
    this.renderEdgeLabels()
    void this.syncField(d.bands)
  }

  /**
   * The published scenario these bands belong to, by identity with the loader's cached file (the
   * scenario last passed to setStations, then the default). null for anything else (D21 parking
   * options, live previews): those have no field PNGs, so they keep the polygons.
   */
  private async publishedScenario(bands: BandsFC): Promise<ScenarioEntry | null> {
    const L = data()
    const idx = await L.scenarios()
    for (const id of new Set([this.stationsScenario, idx.default])) {
      const s = idx.scenarios.find((x) => x.id === id)
      if (s && (await L.bands(s)) === bands) return s
    }
    return null
  }

  private async syncField(bands: BandsFC): Promise<void> {
    const seq = ++this.fieldSeq
    try {
      const entry = await this.publishedScenario(bands)
      if (seq !== this.fieldSeq) return
      if (!entry) return this.showField(null)
      const fd = await loadFieldData(entry.suit_kg)
      if (seq !== this.fieldSeq) return
      this.fieldData = fd
      setActiveField(fd) // fieldAt() works with or without WebGL2
      if (!this.fieldWanted || this.fieldFailed) return this.showField(null)
      const mod = await loadFieldLayer()
      if (seq !== this.fieldSeq || this.fieldFailed) return
      const variant = VARIANT_OF[this.variant] ?? 'nom'
      if (!this.fieldLayer) {
        const h = mod.addFieldLayer(this.map, fd, { budget: this.budget, variant, showBands: this.visible.bands, showHatch: this.visible.unknown }, 'iso-lines', (e) => this.fieldError(e))
        if (this.fieldFailed) return h.remove()
        this.fieldLayer = h
      } else this.fieldLayer.setData(fd)
      this.fieldLayer.update({ variant, budget: this.budget })
      this.showField(fd)
    } catch (e) {
      this.fieldError(e)
    }
  }

  private fieldError(e: unknown): void {
    this.fieldFailed = true
    console.warn('GPU field layer unavailable; showing the polygon bands:', e)
    this.fieldLayer?.remove()
    this.fieldLayer = null
    this.showField(null)
  }

  private showField(fd: FieldData | null): void {
    this.fieldOn = fd !== null && this.fieldLayer !== null
    if (!fd && this.fieldData && activeField() === this.fieldData) setActiveField(null)
    const c = this.map.getContainer()
    c.setAttribute(FIELD_TRUST.renderAttr, this.fieldOn ? 'gpu' : 'polygons')
    if (fd) c.setAttribute(FIELD_TRUST.sourceAttr, fd.sources.join(' '))
    else c.removeAttribute(FIELD_TRUST.sourceAttr)
    this.applyVisibility()
  }

  /** True while the GPU field draws the bands (the polygons are hidden). */
  get fieldActive(): boolean {
    return this.fieldOn
  }

  async setRoute(route: RouteFC | null): Promise<void> {
    await this.ready
    ;(this.map.getSource('route') as GeoJSONSource).setData(route ?? EMPTY)
  }

  /** Hatched unknown cells from a field alpha (A = 0 unknown), placed on the field-index bounds. */
  async setUnknownMask(mask: { alpha: Uint8ClampedArray; width: number; height: number; bounds: [number, number, number, number] }): Promise<void> {
    await this.ready
    if (this.map.getSource('unknown')) return
    const [w, s, e, n] = mask.bounds
    this.map.addSource('unknown', {
      type: 'image',
      url: hatchDataUrl(mask.alpha, mask.width, mask.height, THEME.hatch),
      coordinates: [
        [w, n],
        [e, n],
        [e, s],
        [w, s],
      ],
    })
    this.map.addLayer({ id: 'unknown-hatch', type: 'raster', source: 'unknown', paint: { 'raster-resampling': 'nearest', 'raster-fade-duration': 0 } }, 'iso-lines')
    this.applyVisibility()
  }

  /** Station science points (markers), access cells and walk-in lines for one scenario. */
  async setStations(stations: Station[], scenarioId: string): Promise<void> {
    this.stationsScenario = scenarioId
    this.stationMarkers.forEach((m) => m.remove())
    this.stationMarkers = stations.map((s) => {
      const a = accessFor(s, scenarioId)
      const el = document.createElement('button')
      el.type = 'button'
      el.className = `station-marker${a.state === 'none' ? ' no-access' : ''}`
      el.textContent = s.id
      const acc =
        a.state === 'access'
          ? `access cell ${a.dist_m} m from the science point`
          : a.state === 'none'
            ? `no access cell within ${a.radius_m ?? '?'} m${a.reason ? ` (${a.reason})` : ''}`
            : 'access cell: no data'
      el.title = `${s.name} (science point; ${acc}): open the station card`
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        this.onStation(s.id)
      })
      return new Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(this.map)
    })
    await this.ready
    ;(this.map.getSource('walkin') as GeoJSONSource).setData(walkInLines(stations, scenarioId))
    const pts = stations.flatMap((s) => {
      const a = accessFor(s, scenarioId)
      return a.access ? [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [a.access.lon, a.access.lat] }, properties: { station: s.id } }] : []
    })
    ;(this.map.getSource('access') as GeoJSONSource).setData({ type: 'FeatureCollection', features: pts })
    this.applyVisibility()
  }

  /** F8 siting heatmap (siting.png on siting_png.json corners) and the proposed pad + alternatives. */
  async setSiting(img: { url: string; coordinates: [number, number][] } | null, proposal: { lon: number; lat: number; title: string; alternatives: { rank: number; lon: number; lat: number }[] } | null): Promise<void> {
    this.sitingMarkers.forEach((m) => m.remove())
    this.sitingMarkers = []
    if (proposal) {
      const mk = (cls: string, text: string, title: string, lon: number, lat: number) => {
        const el = document.createElement('div')
        el.className = cls
        el.textContent = text
        el.title = title
        this.sitingMarkers.push(new Marker({ element: el }).setLngLat([lon, lat]).addTo(this.map))
      }
      mk('pad-marker pad-proposal', 'Pad?', proposal.title, proposal.lon, proposal.lat)
      for (const a of proposal.alternatives) mk('pad-alt', `#${a.rank}`, `Siting alternative rank ${a.rank} (pad.json): same rule, not adopted`, a.lon, a.lat)
    }
    await this.ready
    if (img && !this.map.getSource('siting')) {
      const c = img.coordinates as [[number, number], [number, number], [number, number], [number, number]]
      this.map.addSource('siting', { type: 'image', url: img.url, coordinates: c })
      this.map.addLayer({ id: 'siting-img', type: 'raster', source: 'siting', paint: { 'raster-opacity': THEME.sitingOpacity, 'raster-fade-duration': 0 } }, 'iso-lines')
    }
    this.applyVisibility()
  }

  setPad(p: { lon: number; lat: number; label: string; title: string }): void {
    this.padMarker?.remove()
    const el = document.createElement('div')
    el.className = 'pad-marker'
    el.textContent = p.label
    el.title = p.title
    this.padMarker = new Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(this.map)
    this.applyVisibility()
  }

  /** D21 parking options (scenarios/pads/index.json, official pad excluded): small markers, the selected one highlighted; click selects. */
  setPadOptions(opts: { id: string; lon: number; lat: number; label: string; title: string; selected: boolean }[], onPick: (id: string) => void): void {
    this.padOptionMarkers.forEach((m) => m.remove())
    this.padOptionMarkers = opts.map((o) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = `pad-option${o.selected ? ' on' : ''}`
      el.textContent = o.label
      el.title = o.title
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        onPick(o.id)
      })
      return new Marker({ element: el }).setLngLat([o.lon, o.lat]).addTo(this.map)
    })
    this.applyVisibility()
  }

  fitTo(points: { lon: number; lat: number }[]): void {
    const f = CONFIG.aoiFocus
    const b = new LngLatBounds([f.west, f.south], [f.east, f.north])
    for (const p of points) b.extend([p.lon, p.lat])
    this.map.fitBounds(b, { padding: 50, duration: 0 })
  }

  setBudget(minutes: number): void {
    this.budget = minutes
    this.fieldLayer?.update({ budget: minutes })
    this.applyFilters()
    this.renderEdgeLabels()
  }

  setSliderMinutes(minutes: number): void {
    this.sliderMin = minutes
    this.applyFilters()
  }

  setVisible(group: LayerGroup, on: boolean): void {
    this.visible[group] = on
    this.applyVisibility()
  }

  private applyFilters(): void {
    const m = this.map
    if (!m.getLayer('band-opt')) return
    const b = this.budget
    const f = (expr: unknown) => expr as FilterSpecification
    m.setFilter('band-opt', f(['all', ['==', ['get', 'budget'], b], ['==', ['get', 'variant'], 'optimistic']]))
    m.setFilter('band-con', f(['all', ['==', ['get', 'budget'], b], ['==', ['get', 'variant'], 'conservative']]))
    m.setFilter('band-lines', f(['==', ['get', 'budget'], b]))
    m.setPaintProperty('band-lines', 'line-width', ['case', ['==', ['get', 'variant'], this.variant], THEME.bandLineWidth.selected, THEME.bandLineWidth.other] as ExpressionSpecification)
    m.setFilter('edges-line', f(['==', ['get', 'budget'], b]))
    // F5: the slider is a MapLibre filter on `minutes`; no recomputation.
    const v = this.sliderMin
    m.setFilter('iso-fill', f(['==', ['get', 'minutes'], v]))
    m.setFilter('iso-lines', f(['all', ['<', ['get', 'minutes'], v], ['==', ['%', ['get', 'minutes'], THEME.isoBinStepMin], 0]]))
    m.setFilter('iso-current', f(['==', ['get', 'minutes'], v]))
  }

  private applyVisibility(): void {
    const m = this.map
    for (const [g, ids] of Object.entries(this.groupLayers) as [LayerGroup, string[]][]) {
      for (const id of ids) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', this.visible[g] ? 'visible' : 'none')
    }
    for (const mk of this.stationMarkers) mk.getElement().hidden = !this.visible.stations
    if (this.padMarker) this.padMarker.getElement().hidden = !this.visible.stations
    for (const mk of this.padOptionMarkers) mk.getElement().hidden = !this.visible.stations
    for (const mk of this.sitingMarkers) mk.getElement().hidden = !this.visible.siting
    for (const mk of this.edgeMarkers) mk.getElement().hidden = !this.visible.edges
    // GPU field: replaces the polygon bands (and the hatch image when it has the cell states).
    const fl = this.fieldLayer
    if (fl && m.getLayer(fl.id)) {
      const hatch = this.fieldOn && !!this.fieldData?.state
      const showBands = this.fieldOn && this.visible.bands
      const showHatch = hatch && this.visible.unknown
      if (this.fieldOn) for (const id of POLYGON_BAND_LAYERS) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'none')
      if (hatch && m.getLayer('unknown-hatch')) m.setLayoutProperty('unknown-hatch', 'visibility', 'none')
      fl.update({ showBands, showHatch })
      m.setLayoutProperty(fl.id, 'visibility', showBands || showHatch ? 'visible' : 'none')
    }
  }

  private renderEdgeLabels(): void {
    this.edgeMarkers.forEach((m) => m.remove())
    this.edgeMarkers = []
    if (!this.edges) return
    const minSepDeg = THEME.edgeLabelMinSepM / ((CONFIG.marsRadiusM * Math.PI) / 180)
    for (const p of edgeLabelPoints(this.edges, this.budget, THEME.maxEdgeLabelsPerFeature, { maxTotal: THEME.maxEdgeLabels, minSepDeg })) {
      const el = document.createElement('div')
      el.className = `edge-label edge-${p.cause}`
      el.textContent = THEME.causeLabel[p.cause] ?? p.cause
      el.title = `Edge set by ${THEME.causeLabel[p.cause]}: ${THEME.causeHelp[p.cause]}`
      this.edgeMarkers.push(new Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(this.map))
    }
    this.applyVisibility()
  }

  destroy(): void {
    this.fieldSeq++
    if (this.fieldData && activeField() === this.fieldData) setActiveField(null)
    this.map.remove()
  }
}
