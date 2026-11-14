// /nav map: fix-interval classes (D_max), tracks, 95% ellipses every 5 min, the ellipse in force
// at the playback time, fix events by type. MapLibre with WS5's offline style (no remote tiles,
// glyphs or sprites): every source is a local data file or a canvas-made image.
import { LngLatBounds, Map as MlMap, NavigationControl, type GeoJSONSource, type ImageSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { CONFIG } from '../config'
import { blankStyle } from '../map/consoleMap'
import { MarsScaleControl } from '../map/scale'
import type { Feature, FeatureCollection } from 'geojson'
import { NAV_THEME } from './theme'
import type { Fix, LonLat, TrackFeature } from './types'

export type NavLayer = 'fixint' | 'ellipses' | 'estimated' | 'truth' | 'route' | 'fixes'

/** SPEC §2.4: estimated track by default, the true track behind "show truth". */
export const NAV_DEFAULT_VISIBLE: Record<NavLayer, boolean> = {
  fixint: true,
  ellipses: true,
  estimated: true,
  truth: false,
  route: false,
  fixes: true,
}

const LAYERS: Record<NavLayer, string[]> = {
  fixint: ['fixint'],
  ellipses: ['ell5-fill', 'ell5-line'],
  estimated: ['est-line'],
  truth: ['true-line'],
  route: ['route-line'],
  fixes: ['fix-circles'],
}

type FC = FeatureCollection
const EMPTY: FC = { type: 'FeatureCollection', features: [] }

export interface FixPoint {
  fix: Fix
  at: LonLat
}

export class NavMap {
  readonly map: MlMap
  private readonly ready: Promise<void>
  private visible = { ...NAV_DEFAULT_VISIBLE }
  private hasFixint = false
  onPointer?: (p: { lon: number; lat: number } | null) => void
  onFixClick?: (fix: Fix) => void

  constructor(container: HTMLElement) {
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
    })
    this.map.touchZoomRotate.disableRotation()
    this.map.addControl(new NavigationControl({ showCompass: false }), 'top-left')
    this.map.addControl(new MarsScaleControl(CONFIG.marsRadiusM), 'bottom-left')
    this.ready = new Promise((res) => this.map.once('load', () => res()))
    this.ready.then(() => this.init())
    // the side panel fills after the map is created: follow the container's size
    this.ro = new ResizeObserver(() => {
      this.map.resize()
      if (this.lastFit) this.fitTo(this.lastFit)
    })
    this.ro.observe(container)
  }

  private readonly ro: ResizeObserver
  private lastFit: LonLat[] | null = null

  whenReady(): Promise<void> {
    return this.ready
  }

  private init(): void {
    const m = this.map
    for (const id of ['route', 'true', 'est', 'ell5', 'now', 'fixes']) m.addSource(id, { type: 'geojson', data: EMPTY })
    m.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': NAV_THEME.route, 'line-width': 1.5, 'line-dasharray': [2, 2] } })
    m.addLayer({ id: 'ell5-fill', type: 'fill', source: 'ell5', paint: { 'fill-color': NAV_THEME.ellipse, 'fill-opacity': 0.08 } })
    m.addLayer({ id: 'ell5-line', type: 'line', source: 'ell5', paint: { 'line-color': NAV_THEME.ellipse, 'line-width': 1, 'line-opacity': 0.7 } })
    m.addLayer({ id: 'true-line', type: 'line', source: 'true', paint: { 'line-color': NAV_THEME.trueTrack, 'line-width': 2 } })
    m.addLayer({ id: 'est-line', type: 'line', source: 'est', paint: { 'line-color': NAV_THEME.estimatedTrack, 'line-width': 2.5 } })
    m.addLayer({ id: 'now-fill', type: 'fill', source: 'now', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': NAV_THEME.ellipseNow, 'fill-opacity': 0.25 } })
    m.addLayer({ id: 'now-line', type: 'line', source: 'now', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': NAV_THEME.ellipseNow, 'line-width': 2 } })
    m.addLayer({
      id: 'fix-circles',
      type: 'circle',
      source: 'fixes',
      paint: {
        'circle-radius': 6,
        'circle-color': ['match', ['get', 'type'], 'rover', NAV_THEME.fix.rover, 'station', NAV_THEME.fix.station, 'skyline', NAV_THEME.fix.skyline, '#888888'],
        'circle-stroke-color': '#1a120e',
        'circle-stroke-width': 2,
      },
    })
    m.addLayer({
      id: 'now-marker',
      type: 'circle',
      source: 'now',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 5, 'circle-color': NAV_THEME.marker, 'circle-stroke-color': '#1a120e', 'circle-stroke-width': 2 },
    })
    m.on('mousemove', (e) => this.onPointer?.({ lon: e.lngLat.lng, lat: e.lngLat.lat }))
    m.on('mouseout', () => this.onPointer?.(null))
    m.on('click', 'fix-circles', (e) => {
      const p = e.features?.[0]?.properties as { idx?: number } | undefined
      if (p && typeof p.idx === 'number' && this.fixList[p.idx]) this.onFixClick?.(this.fixList[p.idx])
    })
    m.on('mouseenter', 'fix-circles', () => (m.getCanvas().style.cursor = 'pointer'))
    m.on('mouseleave', 'fix-circles', () => (m.getCanvas().style.cursor = ''))
    this.applyVisibility()
  }

  private src(id: string): GeoJSONSource | undefined {
    return this.map.getSource(id) as GeoJSONSource | undefined
  }

  setVisible(v: Record<NavLayer, boolean>): void {
    this.visible = { ...v }
    if (this.map.loaded() || this.map.isStyleLoaded()) this.applyVisibility()
  }

  private applyVisibility(): void {
    for (const [g, ids] of Object.entries(LAYERS) as [NavLayer, string[]][]) {
      for (const id of ids) {
        if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', this.visible[g] ? 'visible' : 'none')
      }
    }
  }

  setRoute(fc: FC | null): void {
    this.src('route')?.setData(fc ?? EMPTY)
  }

  setTracks(trueLine: TrackFeature | null, estLine: TrackFeature | null, ellipses: TrackFeature[]): void {
    const fc = (fs: (TrackFeature | null)[]): FC => ({ type: 'FeatureCollection', features: fs.filter((f): f is TrackFeature => !!f) as Feature[] })
    this.src('true')?.setData(fc([trueLine]))
    this.src('est')?.setData(fc([estLine]))
    this.src('ell5')?.setData(fc(ellipses))
  }

  private fixList: Fix[] = []
  setFixes(points: FixPoint[]): void {
    this.fixList = points.map((p) => p.fix)
    this.src('fixes')?.setData({
      type: 'FeatureCollection',
      features: points.map((p, idx) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p.at }, properties: { type: p.fix.type, idx } })),
    })
  }

  /** Marker and the ellipse in force at the playback time (ring may be null: no Monte Carlo). */
  setNow(at: LonLat | null, ring: LonLat[] | null): void {
    const features: Feature[] = []
    if (ring) features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} })
    if (at) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: at }, properties: {} })
    this.src('now')?.setData({ type: 'FeatureCollection', features })
  }

  /** Fix-interval classes as an image over the field bounds [w, s, e, n]; null removes it. */
  setFixInterval(url: string | null, bounds?: [number, number, number, number]): void {
    const m = this.map
    if (!url || !bounds) {
      if (this.hasFixint) {
        m.removeLayer('fixint')
        m.removeSource('fixint')
        this.hasFixint = false
      }
      return
    }
    const [w, s, e, n] = bounds
    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [w, n],
      [e, n],
      [e, s],
      [w, s],
    ]
    if (this.hasFixint) {
      ;(m.getSource('fixint') as ImageSource).updateImage({ url, coordinates })
      return
    }
    m.addSource('fixint', { type: 'image', url, coordinates })
    m.addLayer({ id: 'fixint', type: 'raster', source: 'fixint', paint: { 'raster-opacity': 1, 'raster-resampling': 'nearest' } }, 'route-line')
    this.hasFixint = true
    this.applyVisibility()
  }

  fitTo(points: LonLat[]): void {
    if (!points.length) return
    this.lastFit = points
    const b = new LngLatBounds(points[0], points[0])
    for (const p of points) b.extend(p)
    this.map.fitBounds(b, { padding: 60, duration: 0 })
  }

  destroy(): void {
    this.ro.disconnect()
    this.map.remove()
  }
}
