// Planning-console map (F17 default view, F5 slider, F6 scenario layers). Plain TS + MapLibre.
// Offline by construction: the style has no glyphs, sprite or remote source; every source is a
// local data file or a canvas-made image. Labels are HTML markers.
import { LngLatBounds, Map as MlMap, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl'
import type { ExpressionSpecification, FilterSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { CONFIG } from '../config'
import type { AnyFC, BandsFC, EdgesFC, IsochroneFC, PartnerFC, RouteFC, Station } from '../data/types'
import { THEME } from '../theme'
import type { BasemapSource } from './basemap'
import { hatchDataUrl } from './hatch'
import { edgeLabelPoints } from './labels'
import { binEdges, stepColorExpression } from './legend'
import { MarsScaleControl } from './scale'

// After bundling, MapLibre cannot find its worker next to itself; point it at the emitted asset.
setWorkerUrl(workerUrl)

export type LayerGroup = 'basemap' | 'bands' | 'unknown' | 'edges' | 'stations' | 'slider' | 'route' | 'partner'

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
}

const GROUP_LAYERS: Record<LayerGroup, string[]> = {
  basemap: ['basemap'],
  bands: ['band-opt', 'band-con', 'band-lines'],
  unknown: ['unknown-hatch'],
  edges: ['edges-line'],
  stations: [],
  slider: ['iso-fill', 'iso-lines', 'iso-current'],
  route: ['route-line'],
  partner: ['partner-line'],
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
  private edgeMarkers: Marker[] = []
  private hasBasemap = false
  private readonly onStation: (id: string) => void

  constructor(container: HTMLElement, onStation: (id: string) => void) {
    this.onStation = onStation
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
    for (const id of ['bands', 'iso', 'edges', 'partner', 'route']) m.addSource(id, { type: 'geojson', data: EMPTY })

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
    this.applyFilters()
    this.applyVisibility()
  }

  /** Basemap raster source (once WS1's tile layout is in the contract), under every other layer. */
  async setBasemap(src: BasemapSource | null): Promise<void> {
    await this.ready
    if (!src || this.hasBasemap) return
    this.map.addSource('basemap', { type: 'raster', tiles: src.tiles, tileSize: src.tileSize, minzoom: src.minzoom, maxzoom: src.maxzoom, bounds: src.bounds })
    this.map.addLayer({ id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-opacity': THEME.basemapOpacity } }, 'iso-fill')
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
    ;(this.map.getSource('partner') as GeoJSONSource).setData(d.partner)
    this.applyFilters()
    this.renderEdgeLabels()
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

  setStations(stations: Station[]): void {
    this.stationMarkers.forEach((m) => m.remove())
    this.stationMarkers = stations.map((s) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = 'station-marker'
      el.textContent = s.id
      el.title = `${s.name}: open the station card`
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        this.onStation(s.id)
      })
      return new Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(this.map)
    })
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

  fitTo(points: { lon: number; lat: number }[]): void {
    const f = CONFIG.aoiFocus
    const b = new LngLatBounds([f.west, f.south], [f.east, f.north])
    for (const p of points) b.extend([p.lon, p.lat])
    this.map.fitBounds(b, { padding: 50, duration: 0 })
  }

  setBudget(minutes: number): void {
    this.budget = minutes
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
    for (const [g, ids] of Object.entries(GROUP_LAYERS) as [LayerGroup, string[]][]) {
      for (const id of ids) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', this.visible[g] ? 'visible' : 'none')
    }
    for (const mk of this.stationMarkers) mk.getElement().hidden = !this.visible.stations
    if (this.padMarker) this.padMarker.getElement().hidden = !this.visible.stations
    for (const mk of this.edgeMarkers) mk.getElement().hidden = !this.visible.edges
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
    this.map.remove()
  }
}
