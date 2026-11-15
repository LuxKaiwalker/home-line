// L1c: the three base maps as ConsoleMap extensions (map/extensions.ts registerBasemap).
//   satellite: the existing HiRISE `basemap` layer; nothing to add (the default).
//   topo / material: one image source + raster layer just above the satellite tiles (aboveSatellite),
//   rendered once on first use from the relief source (relief.ts, ported from mission/relief.ts), hidden
//   again when another base map is chosen. Each install follows activeBasemap itself.
import type { Map as MlMap } from 'maplibre-gl'
import type { BasemapHandle, BasemapSpec, MapExtensionContext } from '../extensions'
import { t } from '../../ui/copy'
import { buildUnitField, renderRelief, ROCKS_FILE, type Relief, type ReliefMode, type Unit } from './relief'
import type { ReliefSource } from './source'
import { activeBasemap, setReliefStatus, type BasemapId } from './store'

export const BASEMAP_TITLE_KEYS: Record<BasemapId, string> = { satellite: 'route.basemaps.satellite', topo: 'route.basemaps.topo', material: 'route.basemaps.material' }
export const reliefSourceId = (mode: ReliefMode) => `hl-basemap-${mode}`
export const reliefLayerId = (mode: ReliefMode) => `hl-basemap-${mode}`

export interface ReliefDeps {
  load(): Promise<ReliefSource>
  /** RGBA raster to an image URL (browser: canvas → PNG blob URL) */
  toUrl(r: Relief): Promise<string>
}

type Rendered = { relief: Relief; units: Unit[]; url: string; corners: [[number, number], [number, number], [number, number], [number, number]] }
const rendered = new Map<ReliefMode, Promise<Rendered>>()
/** Tests: forget rendered rasters. */
export const resetReliefCache = () => rendered.clear()

function render(mode: ReliefMode, deps: ReliefDeps): Promise<Rendered> {
  let p = rendered.get(mode)
  if (!p) {
    p = (async () => {
      const src = await deps.load()
      await new Promise((res) => setTimeout(res, 20)) // let "Rendering…" paint
      const { grid: g, elev, resM } = src
      const u = mode === 'material' ? buildUnitField(ROCKS_FILE.rocks, ROCKS_FILE.classes, g, g.width * resM, g.height * resM) : null
      const relief = renderRelief(elev, g.width, g.height, resM, mode, u)
      setReliefStatus(mode, { kind: 'ready', relief, units: u?.units ?? [], elevationResM: src.elevationResM })
      return { relief, units: u?.units ?? [], url: await deps.toUrl(relief), corners: [[g.w, g.n], [g.e, g.n], [g.e, g.s], [g.w, g.s]] as Rendered['corners'] }
    })()
    rendered.set(mode, p)
    p.catch(() => rendered.get(mode) === p && rendered.delete(mode))
  }
  return p
}

/**
 * F3 (D146) fix: the layer just above the satellite imagery. ConsoleMap's HiRISE layers are `basemap-<i>`
 * (added before 'iso-fill'); there is no layer called `basemap`, so ctx.beforeId('basemap') answers the
 * BOTTOM layer and the relief raster landed under the opaque satellite tiles (drawn, never seen).
 * Order: the layer after the last `basemap-*`, else 'iso-fill' (where the basemap layers go), else the slot.
 */
export function aboveSatellite(m: MlMap, ctx: MapExtensionContext, own: string): string | undefined {
  const ids = (m.getStyle?.()?.layers ?? []).map((l) => l.id).filter((id) => id !== own)
  let last = -1
  ids.forEach((id, i) => id.startsWith('basemap-') && (last = i))
  if (last >= 0) return ids[last + 1]
  if (m.getLayer('iso-fill')) return 'iso-fill'
  return ctx.beforeId('basemap')
}

/** Satellite: ConsoleMap's own basemap layer stays as it is; the relief layers hide themselves. */
export const satelliteBasemap = (): BasemapSpec => ({
  id: 'satellite',
  titleKey: BASEMAP_TITLE_KEYS.satellite,
  isDefault: true,
  install: (ctx) => follow(ctx, 'satellite', { activate() {}, deactivate() {}, destroy() {} }),
})

export function reliefBasemap(mode: ReliefMode, deps: ReliefDeps): BasemapSpec {
  return {
    id: mode,
    titleKey: BASEMAP_TITLE_KEYS[mode],
    install(ctx) {
      const m: MlMap = ctx.map
      let on = false
      let dead = false
      const vis = (v: boolean) => m.getLayer(reliefLayerId(mode)) && m.setLayoutProperty(reliefLayerId(mode), 'visibility', v ? 'visible' : 'none')
      const handle: BasemapHandle = {
        activate() {
          on = true
          if (m.getLayer(reliefLayerId(mode))) {
            m.moveLayer(reliefLayerId(mode), aboveSatellite(m, ctx, reliefLayerId(mode))) // satellite tiles may have arrived since
            return void vis(true)
          }
          if (!rendered.has(mode)) setReliefStatus(mode, { kind: 'rendering' })
          render(mode, deps).then(
            (r) => {
              if (dead || m.getLayer(reliefLayerId(mode))) return vis(on)
              if (!m.getSource(reliefSourceId(mode))) m.addSource(reliefSourceId(mode), { type: 'image', url: r.url, coordinates: r.corners })
              m.addLayer({ id: reliefLayerId(mode), type: 'raster', source: reliefSourceId(mode), layout: { visibility: on ? 'visible' : 'none' }, paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, aboveSatellite(m, ctx, reliefLayerId(mode)))
            },
            (e: unknown) => setReliefStatus(mode, { kind: 'error', message: e instanceof Error ? e.message : String(e) }),
          )
        },
        deactivate() {
          on = false
          vis(false)
        },
        destroy() {
          dead = true
          if (m.getLayer(reliefLayerId(mode))) m.removeLayer(reliefLayerId(mode))
          if (m.getSource(reliefSourceId(mode))) m.removeSource(reliefSourceId(mode))
        },
      }
      return follow(ctx, mode, handle)
    },
  }
}

/** Activate/deactivate `h` with activeBasemap for as long as it is installed. */
function follow(_ctx: MapExtensionContext, id: BasemapId, h: BasemapHandle): BasemapHandle {
  let was = false
  const sync = (cur: BasemapId) => {
    const now = cur === id
    if (now === was) return
    was = now
    if (now) h.activate()
    else h.deactivate()
  }
  sync(activeBasemap.peek())
  const off = activeBasemap.subscribe(sync)
  return {
    activate: h.activate,
    deactivate: h.deactivate,
    destroy() {
      off()
      h.destroy()
    },
  }
}

/** Browser rasteriser (as the Mission Planer's MapsControl): canvas → PNG blob URL. */
export async function canvasUrl(r: Relief): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = r.width
  canvas.height = r.height
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.rgba), r.width, r.height), 0, 0)
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!blob) throw new Error(t('route.basemaps.encodeError'))
  return URL.createObjectURL(blob)
}
