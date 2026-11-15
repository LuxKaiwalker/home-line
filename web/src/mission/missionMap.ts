// Mission Planer map (plain TS + MapLibre, offline like the Plan page): HiRISE basemap, the chosen
// reachable-area boundary, planned legs (solid), the way home from the last waypoint (dashed),
// the pad, and numbered draggable waypoints. Click adds a waypoint.
// 3D: the Plan page's terrain (map/terrain TerrainController: DEM tiles, relief shading, tilt and
// rotation). The planer opens in 3D; lines drape on the terrain and markers sit on it.
import { LngLatBounds, Map as MlMap, Marker, NavigationControl, Popup, setWorkerUrl, type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl'
import type { FilterSpecification } from '@maplibre/maplibre-gl-style-spec'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { CONFIG } from '../config'
import type { AnyFC, BandsFC, EdgesFC, IsochroneFC } from '../data/types'
import type { BasemapSource } from '../map/basemap'
import { blankStyle } from '../map/consoleMap'
import { MarsScaleControl } from '../map/scale'
import { TerrainController } from '../map/terrain'
import { effect, ui } from '../state'
import { THEME } from '../theme'
import type { BoundaryOption, LonLat } from './plan'
import { SLOPE_OPACITY } from './slope'

setWorkerUrl(workerUrl)

const EMPTY: AnyFC = { type: 'FeatureCollection', features: [] }
const NOTHING: FilterSpecification = ['==', ['literal', 1], 0]

export type MapType = 'satellite' | 'topo' | 'material'
/** Overlays drawn on top of any map type (LayersControl). */
export type Overlay = 'slope' | 'curiosity'

export interface MissionMapHandlers {
  onAdd: (lon: number, lat: number) => void
  onMove: (index: number, lon: number, lat: number) => void
}

export class MissionMap {
  readonly map: MlMap
  private readonly ready: Promise<void>
  private markers: Marker[] = []
  private stationMarkers: Marker[] = []
  private popup?: Popup
  private padMarker?: Marker
  private hasBasemap = false
  private basemapIds: string[] = []
  private reliefUrl: string | null = null
  private mapType: MapType = 'satellite'
  private slopeUrl: string | null = null
  private slopeOpacity = SLOPE_OPACITY
  private stopClick: ((i: number) => void) | null = null
  private terrain: TerrainController | null = null
  private stopCompass: () => void
  private destroyed = false
  private readonly h: MissionMapHandlers

  constructor(container: HTMLElement, handlers: MissionMapHandlers) {
    this.h = handlers
    const f = CONFIG.aoiFocus
    this.map = new MlMap({
      container,
      style: blankStyle(),
      bounds: [f.west, f.south, f.east, f.north],
      fitBoundsOptions: { padding: 40 },
      attributionControl: false,
      // 2D until the terrain is on: TerrainController lifts maxPitch and rotation in 3D
      maxPitch: 0,
      dragRotate: false,
      renderWorldCopies: false,
      doubleClickZoom: false, // a double click would add two waypoints and zoom
    })
    this.map.touchZoomRotate.disableRotation()
    // Compass (user 2026-11-15): turns with the view, tilts with the camera, a click turns back to north.
    // Shown in 3D only: in 2D the map cannot rotate, so it would always point up.
    this.map.addControl(new NavigationControl({ showCompass: true, visualizePitch: true }), 'top-left')
    this.stopCompass = effect(() => {
      container.classList.toggle('mp-3d', ui.view.value === '3d')
    })
    this.map.addControl(new MarsScaleControl(CONFIG.marsRadiusM), 'bottom-left')
    this.map.getCanvas().style.cursor = 'crosshair'
    this.ready = new Promise((res) => this.map.once('load', () => res()))
    void this.ready.then(() => !this.destroyed && this.init())
  }

  whenReady(): Promise<void> {
    return this.ready
  }

  private init(): void {
    const m = this.map
    for (const id of ['band', 'iso', 'edges', 'legs', 'home', 'msl-trav', 'msl-stops']) m.addSource(id, { type: 'geojson', data: EMPTY })
    m.addLayer({ id: 'band-fill', type: 'fill', source: 'band', filter: NOTHING, paint: { 'fill-color': THEME.variant.nominal, 'fill-opacity': 0.18 } })
    m.addLayer({ id: 'band-line', type: 'line', source: 'band', filter: NOTHING, paint: { 'line-color': THEME.variant.nominal, 'line-width': 2.5 } })
    m.addLayer({ id: 'iso-fill', type: 'fill', source: 'iso', filter: NOTHING, paint: { 'fill-color': THEME.variant.nominal, 'fill-opacity': 0.15 } })
    m.addLayer({ id: 'iso-line', type: 'line', source: 'iso', filter: NOTHING, paint: { 'line-color': '#ffffff', 'line-width': 2 } })
    m.addLayer({
      id: 'edges-line',
      type: 'line',
      source: 'edges',
      filter: NOTHING,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['match', ['get', 'cause'], 'physiology', THEME.cause.physiology, 'slope', THEME.cause.slope, THEME.cause.data],
        'line-width': 3,
      },
    })
    // Curiosity's real traverse and drive ends (LayersControl "Curiosity"), under the plan.
    m.addLayer({ id: 'msl-trav-line', type: 'line', source: 'msl-trav', layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#f2f2f2', 'line-width': 1.6, 'line-opacity': 0.85 } })
    m.addLayer({
      id: 'msl-stops-circle',
      type: 'circle',
      source: 'msl-stops',
      layout: { visibility: 'none' },
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 16, 6], 'circle-color': '#ffd166', 'circle-stroke-color': '#1a120e', 'circle-stroke-width': 1 },
    })
    m.on('mouseenter', 'msl-stops-circle', () => (m.getCanvas().style.cursor = 'pointer'))
    m.on('mouseleave', 'msl-stops-circle', () => (m.getCanvas().style.cursor = 'crosshair'))
    m.addLayer({
      id: 'home-line',
      type: 'line',
      source: 'home',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#7fd8ff', 'line-width': 2.5, 'line-dasharray': [2, 2] },
    })
    m.addLayer({ id: 'legs-casing', type: 'line', source: 'legs', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1a120e', 'line-width': 5 } })
    m.addLayer({ id: 'legs-line', type: 'line', source: 'legs', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': THEME.route, 'line-width': 3 } })
    m.on('click', (e: MapMouseEvent) => {
      // A click on a Curiosity drive end opens its pictures instead of adding a waypoint.
      if (m.getLayoutProperty('msl-stops-circle', 'visibility') === 'visible') {
        const hit = m.queryRenderedFeatures(e.point, { layers: ['msl-stops-circle'] })[0]
        if (hit) {
          this.stopClick?.(Number(hit.properties?.i))
          return
        }
      }
      this.h.onAdd(e.lngLat.lng, e.lngLat.lat)
    })
    // Relief shading above the basemap / topography / slope rasters, under the boundary and the plan.
    this.terrain = new TerrainController(m, 'band-fill', 'bottom-right') // 2D/3D control styled in mission.css
    ui.view.value = '3d'
  }

  /** Slope overlay raster (corners NW, NE, SE, SW), just under the boundary layers. */
  async setSlopeImage(url: string, corners: [LonLat, LonLat, LonLat, LonLat]): Promise<void> {
    await this.ready
    const m = this.map
    if (m.getLayer('slope')) m.removeLayer('slope')
    if (m.getSource('slope')) m.removeSource('slope')
    if (this.slopeUrl) URL.revokeObjectURL(this.slopeUrl)
    this.slopeUrl = url
    m.addSource('slope', { type: 'image', url, coordinates: corners })
    m.addLayer({ id: 'slope', type: 'raster', source: 'slope', layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 0, 'raster-resampling': 'nearest', 'raster-opacity': this.slopeOpacity } }, 'band-fill')
  }

  /** Curiosity's traverse (lines) and drive ends (points; a click calls onStop with the index). */
  async setCuriosity(traverse: LonLat[][], stops: { lon: number; lat: number; sol: number }[], onStop: (i: number) => void): Promise<void> {
    await this.ready
    this.stopClick = onStop
    ;(this.map.getSource('msl-trav') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: traverse.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })),
    })
    ;(this.map.getSource('msl-stops') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: stops.map((s, i) => ({ type: 'Feature', properties: { i, sol: s.sol }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })),
    })
  }

  /** Slope overlay opacity, 0..1. */
  async setSlopeOpacity(v: number): Promise<void> {
    await this.ready
    this.slopeOpacity = v
    if (this.map.getLayer('slope')) this.map.setPaintProperty('slope', 'raster-opacity', v)
  }

  async setOverlay(o: Overlay, on: boolean): Promise<void> {
    await this.ready
    const ids = o === 'slope' ? ['slope'] : ['msl-trav-line', 'msl-stops-circle']
    for (const id of ids) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
  }

  /** A popup with arbitrary content (closes the previous one); returns it so the caller can react to close. */
  openPopup(at: LonLat, content: HTMLElement, maxWidth = '380px'): Popup {
    this.popup?.remove()
    for (const ev of ['mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'wheel']) content.addEventListener(ev, (e) => e.stopPropagation())
    this.popup = new Popup({ offset: 10, closeButton: true, maxWidth, className: 'mp-pop-wide' }).setLngLat(at).setDOMContent(content).addTo(this.map)
    return this.popup
  }

  async setBasemap(sources: BasemapSource[]): Promise<void> {
    await this.ready
    if (!sources.length || this.hasBasemap) return
    sources.forEach((src, i) => {
      const id = `basemap-${i}`
      this.basemapIds.push(id)
      this.map.addSource(id, { type: 'raster', tiles: src.tiles, tileSize: src.tileSize, minzoom: src.minzoom, maxzoom: src.maxzoom, bounds: src.bounds, attribution: src.attribution })
      this.map.addLayer(
        { id, type: 'raster', source: id, ...(src.layerMinzoom !== undefined ? { minzoom: src.layerMinzoom } : {}), paint: { 'raster-opacity': THEME.basemapOpacity, 'raster-fade-duration': 0 } },
        'band-fill',
      )
    })
    this.hasBasemap = true
    this.applyMapType()
  }

  /** Topography / material raster over the routing grid (corners NW, NE, SE, SW); replaces the previous one. */
  async setRelief(url: string, corners: [LonLat, LonLat, LonLat, LonLat]): Promise<void> {
    await this.ready
    const m = this.map
    if (m.getLayer('relief')) m.removeLayer('relief')
    if (m.getSource('relief')) m.removeSource('relief')
    if (this.reliefUrl) URL.revokeObjectURL(this.reliefUrl)
    this.reliefUrl = url
    m.addSource('relief', { type: 'image', url, coordinates: corners })
    // under the slope overlay when it exists, so a map switch never covers it
    m.addLayer({ id: 'relief', type: 'raster', source: 'relief', paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, m.getLayer('slope') ? 'slope' : 'band-fill')
    this.applyMapType()
  }

  /** Satellite shows the HiRISE basemap; topography / material show the relief raster instead. */
  async setMapType(t: MapType): Promise<void> {
    await this.ready
    this.mapType = t
    this.applyMapType()
  }

  private applyMapType(): void {
    const sat = this.mapType === 'satellite'
    for (const id of this.basemapIds) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', sat ? 'visible' : 'none')
    if (this.map.getLayer('relief')) this.map.setLayoutProperty('relief', 'visibility', sat ? 'none' : 'visible')
  }

  async setBoundaryData(d: { bands: BandsFC | null; isochrones: IsochroneFC | null; edges: EdgesFC | null }): Promise<void> {
    await this.ready
    ;(this.map.getSource('band') as GeoJSONSource).setData(d.bands ?? EMPTY)
    ;(this.map.getSource('iso') as GeoJSONSource).setData(d.isochrones ?? EMPTY)
    ;(this.map.getSource('edges') as GeoJSONSource).setData(d.edges ?? EMPTY)
  }

  async showBoundary(o: BoundaryOption | undefined): Promise<void> {
    await this.ready
    const m = this.map
    const band: FilterSpecification = o?.kind === 'band' ? ['all', ['==', ['get', 'budget'], o.budget], ['==', ['get', 'variant'], o.variant]] : NOTHING
    const iso: FilterSpecification = o?.kind === 'iso' ? ['==', ['get', 'minutes'], o.minutes] : NOTHING
    const edges: FilterSpecification = o?.kind === 'edges' ? ['==', ['get', 'budget'], o.budget] : NOTHING
    m.setFilter('band-fill', band)
    m.setFilter('band-line', band)
    m.setFilter('iso-fill', iso)
    m.setFilter('iso-line', iso)
    m.setFilter('edges-line', edges)
    if (o?.kind === 'band') {
      const c = THEME.variant[o.variant] ?? THEME.variant.nominal
      m.setPaintProperty('band-fill', 'fill-color', c)
      m.setPaintProperty('band-line', 'line-color', c)
    }
  }

  setPad(p: { lon: number; lat: number; title: string }): void {
    this.padMarker?.remove()
    const el = document.createElement('div')
    el.className = 'pad-marker'
    el.textContent = 'Pad'
    el.title = p.title
    this.padMarker = new Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(this.map)
  }

  /** Science stations: a click opens a popup with "Add as waypoint" and a link to the station card. */
  setStations(list: { id: string; name: string; lon: number; lat: number; detailHref: string; inPlan: boolean }[], onAdd: (id: string) => void): void {
    this.stationMarkers.forEach((mk) => mk.remove())
    this.popup?.remove()
    this.stationMarkers = list.map((s) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = `station-marker mp-station${s.inPlan ? ' in-plan' : ''}`
      el.textContent = s.id
      el.title = `${s.id} · ${s.name}: click for options`
      const box = document.createElement('div')
      box.className = 'mp-st-pop'
      const title = document.createElement('b')
      title.textContent = `${s.id} · ${s.name}`
      const add = document.createElement('button')
      add.type = 'button'
      add.textContent = s.inPlan ? 'Already in the plan' : '+ Add as waypoint'
      add.disabled = s.inPlan
      add.addEventListener('click', () => {
        this.popup?.remove()
        onAdd(s.id)
      })
      const link = document.createElement('a')
      link.href = s.detailHref
      link.textContent = 'Details →'
      const row = document.createElement('div')
      row.append(add, link)
      box.append(title, row)
      // Clicks in the popup must not add a waypoint on the map below.
      for (const ev of ['mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'pointerup', 'touchstart', 'touchend']) box.addEventListener(ev, (e) => e.stopPropagation())
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        this.popup?.remove()
        this.popup = new Popup({ offset: 18, closeButton: true, maxWidth: '260px' }).setLngLat([s.lon, s.lat]).setDOMContent(box).addTo(this.map)
      })
      return new Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(this.map)
    })
  }

  /** Waypoint markers, numbered from 1, draggable; a drag end moves that waypoint. */
  setWaypoints(points: { lon: number; lat: number; bad: boolean; info?: string }[]): void {
    this.markers.forEach((mk) => mk.remove())
    this.markers = points.map((p, i) => {
      const el = document.createElement('div')
      el.className = `mp-wp${p.bad ? ' mp-wp-bad' : ''}`
      el.textContent = String(i + 1)
      el.title = `Waypoint ${i + 1}${p.info ? `: ${p.info}` : ''}\nDrag to move`
      if (p.info) el.classList.add('mp-wp-noted')
      el.addEventListener('click', (e) => e.stopPropagation()) // a click on a marker never adds a waypoint
      const mk = new Marker({ element: el, draggable: true }).setLngLat([p.lon, p.lat]).addTo(this.map)
      mk.on('dragend', () => {
        const ll = mk.getLngLat()
        this.h.onMove(i, ll.lng, ll.lat)
      })
      return mk
    })
  }

  async setRoute(legs: LonLat[][], home: { coords: LonLat[]; reachesPad: boolean } | null): Promise<void> {
    await this.ready
    ;(this.map.getSource('legs') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: legs.filter((c) => c.length > 1).map((coordinates, i) => ({ type: 'Feature', properties: { leg: i + 1 }, geometry: { type: 'LineString', coordinates } })),
    })
    ;(this.map.getSource('home') as GeoJSONSource).setData(
      home && home.coords.length > 1 ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { reachesPad: home.reachesPad }, geometry: { type: 'LineString', coordinates: home.coords } }] } : EMPTY,
    )
  }

  fitTo(points: LonLat[]): void {
    if (!points.length) return
    const b = new LngLatBounds(points[0], points[0])
    for (const p of points) b.extend(p)
    this.map.fitBounds(b, { padding: 60, duration: 0, maxZoom: 15 })
  }

  destroy(): void {
    this.destroyed = true
    this.stopCompass()
    this.terrain?.destroy()
    this.markers.forEach((mk) => mk.remove())
    this.stationMarkers.forEach((mk) => mk.remove())
    this.popup?.remove()
    this.padMarker?.remove()
    if (this.reliefUrl) URL.revokeObjectURL(this.reliefUrl)
    if (this.slopeUrl) URL.revokeObjectURL(this.slopeUrl)
    this.map.remove()
  }
}
