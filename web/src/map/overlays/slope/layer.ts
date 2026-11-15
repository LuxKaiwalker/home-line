// PORT L1a: the map side of the slope layer (port of the slope half of mission/LayersControl.tsx and
// MissionMap.setSlopeImage). Registered through map/extensions.ts registerOverlay with
// `replaces: 'slopeClass'`, so it takes the place of Plan's built-in U7 slope-classes overlay.
// Lazy: nothing is fetched until the layer is first turned on; then the slope field is decoded,
// coloured in the config classes (classes.ts) and added as one image source under the homeline
// lines (beforeId 'overlay'). Afterwards only visibility and opacity change.
import { data } from '../../../data/loader'
import { dataUrl } from '../../../env'
import { loadField } from '../../../hud/fields'
import type { FieldsIndex as HudFieldsIndex } from '../../../hud/types'
import { effect } from '../../../state/signal'
import { t } from '../../../ui/copy'
import type { MapExtensionContext, OverlayHandle, OverlaySpec } from '../../extensions'
import { renderSlope, REPLACES, SLOPE_DEFAULT_ON, slopeClasses, type SlopeLimits } from './classes'
import { setSlopeOn, setSlopeOpacity, slopeError, slopeFile, slopeOn, slopeOpacity, slopeStatus } from './state'


export const SLOPE_OVERLAY_ID = 'slope'
export const SLOPE_SOURCE_ID = 'l1a-slope'
export const SLOPE_LAYER_ID = 'l1a-slope-raster'
/** Seed key in copy.json (route.layers.slope.title); I4 keeps it. */
export const SLOPE_TITLE_KEY = 'route.layers.slope.title'

/** The decoded slope field on its grid. */
export interface SlopeRaster {
  width: number
  height: number
  counts: ArrayLike<number>
  known: ArrayLike<number>
  /** degrees per count */
  scale: number
  w: number
  s: number
  e: number
  n: number
  /** data file (for the trust chip and the note) */
  file: string
}

export interface SlopeDeps {
  loadRaster(): Promise<SlopeRaster>
  /** RGBA → an image URL MapLibre can load */
  toImageUrl(rgba: Uint8ClampedArray, width: number, height: number): Promise<string>
  revokeUrl?(url: string): void
  /** class edges (tests pass a fixture); default config/site.yaml through CITED */
  limits?: SlopeLimits
}

/** The subset of MapLibre's Map the slope layer uses (a fake in the tests). */
export interface SlopeMap {
  addSource(id: string, spec: unknown): unknown
  getSource(id: string): unknown
  removeSource(id: string): unknown
  addLayer(spec: unknown, before?: string): unknown
  getLayer(id: string): unknown
  removeLayer(id: string): unknown
  setLayoutProperty(id: string, k: string, v: unknown): unknown
  setPaintProperty(id: string, k: string, v: unknown): unknown
}

/** fields/index.json key of the slope field ('slope' today). */
export function slopeFieldKey(fi: { fields: Record<string, unknown> }): string | undefined {
  return Object.keys(fi.fields).find((k) => k === 'slope' || k.endsWith('/slope'))
}

async function loadRasterFromData(): Promise<SlopeRaster> {
  const fi = (await data().fieldsIndex()) as unknown as HudFieldsIndex
  const key = slopeFieldKey(fi)
  if (!key) throw new Error(t('route.layers.slope.noField'))
  const g = await loadField(fi, key, (p) => dataUrl(p))
  return { width: g.data.width, height: g.data.height, counts: g.data.counts, known: g.data.known, scale: g.data.scale, w: g.w, s: g.s, e: g.e, n: g.n, file: fi.fields[key].file }
}

async function rgbaToObjectUrl(rgba: Uint8ClampedArray, w: number, h: number): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const c2d = canvas.getContext('2d')
  if (!c2d) throw new Error(t('route.layers.slope.encodeError'))
  c2d.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0)
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!blob) throw new Error(t('route.layers.slope.encodeError'))
  return URL.createObjectURL(blob)
}

export const BROWSER_SLOPE_DEPS: SlopeDeps = {
  loadRaster: loadRasterFromData,
  toImageUrl: rgbaToObjectUrl,
  revokeUrl: (u) => URL.revokeObjectURL(u),
}

/** Corners NW, NE, SE, SW for an image source. */
export const corners = (r: Pick<SlopeRaster, 'w' | 's' | 'e' | 'n'>): [number, number][] => [
  [r.w, r.n],
  [r.e, r.n],
  [r.e, r.s],
  [r.w, r.s],
]

/** Install the slope layer on a map; it follows state.ts (slopeOn, slopeOpacity). */
export function installSlopeLayer(ctx: Pick<MapExtensionContext, 'beforeId'> & { map: unknown }, deps: SlopeDeps = BROWSER_SLOPE_DEPS): OverlayHandle & { settled(): Promise<void> } {
  const map = ctx.map as SlopeMap
  let loading: Promise<void> | null = null
  let added = false
  let url: string | null = null
  let destroyed = false

  const apply = () => {
    if (!added || destroyed || !map.getLayer(SLOPE_LAYER_ID)) return
    map.setLayoutProperty(SLOPE_LAYER_ID, 'visibility', slopeOn.peek() ? 'visible' : 'none')
    map.setPaintProperty(SLOPE_LAYER_ID, 'raster-opacity', slopeOpacity.peek())
  }

  const load = async (): Promise<void> => {
    slopeStatus.value = 'loading'
    slopeError.value = null
    try {
      const r = await deps.loadRaster()
      const rgba = renderSlope(r.counts, r.known, r.scale, slopeClasses(deps.limits))
      const u = await deps.toImageUrl(rgba, r.width, r.height)
      if (destroyed) {
        deps.revokeUrl?.(u)
        return
      }
      url = u
      map.addSource(SLOPE_SOURCE_ID, { type: 'image', url: u, coordinates: corners(r) })
      map.addLayer(
        {
          id: SLOPE_LAYER_ID,
          type: 'raster',
          source: SLOPE_SOURCE_ID,
          layout: { visibility: 'none' },
          paint: { 'raster-fade-duration': 0, 'raster-resampling': 'nearest', 'raster-opacity': slopeOpacity.peek() },
        },
        ctx.beforeId('overlay'),
      )
      added = true
      slopeFile.value = r.file
      slopeStatus.value = 'ready'
      apply()
    } catch (e) {
      if (destroyed) return
      slopeStatus.value = 'error'
      slopeError.value = e instanceof Error ? e.message : String(e)
      loading = null // the next "on" retries
    }
  }

  const stop = effect(() => {
    const on = slopeOn.value
    void slopeOpacity.value
    if (on && !added && !loading) loading = load()
    apply()
  })

  return {
    setVisible: (on) => setSlopeOn(on),
    setOpacity: (v) => setSlopeOpacity(v),
    async settled() {
      await loading
    },
    destroy() {
      destroyed = true
      stop()
      if (map.getLayer(SLOPE_LAYER_ID)) map.removeLayer(SLOPE_LAYER_ID)
      if (map.getSource(SLOPE_SOURCE_ID)) map.removeSource(SLOPE_SOURCE_ID)
      if (url) deps.revokeUrl?.(url)
      url = null
      added = false
    },
  }
}

/** The overlay registration (map/extensions.ts registerOverlay). */
export function slopeOverlaySpec(deps: SlopeDeps = BROWSER_SLOPE_DEPS): OverlaySpec {
  return {
    id: SLOPE_OVERLAY_ID,
    titleKey: SLOPE_TITLE_KEY,
    defaultOn: SLOPE_DEFAULT_ON,
    replaces: REPLACES,
    install: (ctx) => installSlopeLayer(ctx, deps),
  }
}
