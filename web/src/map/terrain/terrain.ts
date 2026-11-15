// WS16 task 8 (M8): the 3D part of U1, loaded with import() only when 3D is turned on (DESIGN §5.4
// lazy loading). Adds the terrain raster-dem source + setTerrain, a separate raster-dem source for the
// relief-shading (hillshade) layer, unlocks tilt and rotation, and drapes the U2 field layer.
//
// Field drape: MapLibre 6.18's experimental CustomLayerInterface.renderToTerrainTile. While terrain
// is on, the field layer's implementation gets a renderToTerrainTile that calls its own render() with
// a matrix mapping Mercator 0..1 onto the terrain tile's clip space (SW = (-1, -1), NE = (1, 1)), so
// the field is drawn into the same per-tile textures as the basemap and the fill/line layers and stays
// registered with the ground at every tilt. terrainTileRevision is bumped on every field update so the
// draped tiles redraw. Chosen over M1's canvas-source proposal: no 8.8 MB re-upload per update, the
// same shader and params in 2D and 3D (DESIGN: "2D and 3D pictures are identical"), and nothing to
// keep in step. RR must check it (experimental API); on a GL error the field layer's own fallback
// (polygons, which drape natively) takes over.
import type { CustomLayerInterface, Map as MlMap } from 'maplibre-gl'
import { TOKENS } from '../../ui/tokens'
import { TERRAIN } from './config'
import { FAR_FIELD, farDemSource, pitchCap, type TileSet } from './farfield'
import { DEM_PROTOCOL, installDemProtocol, lowestFarHeight, type DemTileUrls } from './protocol'
import { DEM_SOURCE, demSource, type TerrainTiles } from './tiles'

export const RELIEF_LAYER_ID = 'relief-shading'
/** V1: the relief shading on the far-field pyramid; replaces relief-shading while 3D is on (not in a story) */
export const RELIEF_FAR = { layer: 'relief-shading-far', source: 'relief-far-dem' } as const

export interface TerrainHandle {
  /** terrain on (3D) or off (flat; the relief shading stays) */
  setTerrainOn(on: boolean, opts: { animate: boolean }): void
  setExaggeration(x: number): void
  /** relief light direction, deg clockwise from north; null = MapLibre's default light */
  setLightAzimuth(az: number | null): void
  /** drape the custom field layer (by id) while terrain is on; call again after it is (re)added */
  drapeField(layerId: string): void
  remove(): void
}

/** Mercator 0..1 -> terrain tile clip space for tile (z, x, y), column-major (CustomTerrainRenderInput). */
export function tileClipMatrix(z: number, x: number, y: number): Float64Array {
  const s = 2 ** (z + 1)
  // clip x = 2 (mx 2^z − x) − 1 ; clip y = 1 − 2 (my 2^z − y)   (north up)
  return Float64Array.from([s, 0, 0, 0, 0, -s, 0, 0, 0, 0, 1, 0, -2 * x - 1, 2 * y + 1, 0, 1])
}

type Drapeable = CustomLayerInterface & { terrainTileRevision?: number }

/** V1: sky and horizon fog while terrain is on (tokens; blends from terrain_3d.far_field.sky). */
export function skySpec(): Parameters<MlMap['setSky']>[0] {
  const c = TOKENS.color
  const s = FAR_FIELD.sky
  return {
    'sky-color': c.bg,
    'horizon-color': c.card,
    'fog-color': c.card,
    'sky-horizon-blend': s.skyHorizonBlend,
    'horizon-fog-blend': s.horizonFogBlend,
    'fog-ground-blend': s.fogGroundBlend,
    'atmosphere-blend': s.atmosphereBlend,
  }
}

/** A story (intro, kiosk, capture) owns the camera: StoryStage sets html[data-story]. */
function storyOn(): boolean {
  try {
    return typeof document !== 'undefined' && !!document.documentElement?.dataset?.story
  } catch {
    return false
  }
}

/** z/x/y into a tiles.json URL template, prefixed with the data root. */
const tileUrl = (tj: TerrainTiles, prefix: (p: string) => string) => (z: number, x: number, y: number) =>
  prefix(tj.tiles[0].replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)))

/**
 * @param far V1 (D141): terrain_low/tiles.json. With it the 3D mesh and the relief shading read one
 *   pyramid from terrain_low's zooms up (farfield.ts), so a pitched view has ground to its far edge;
 *   without it (an older data tree) the planning-extent tiles only, as before.
 */
export function addTerrain(
  map: MlMap,
  tj: TerrainTiles,
  prefix: (p: string) => string,
  beforeId: string | undefined,
  initial: { exaggeration: number; azimuth: number | null },
  far?: TerrainTiles | null,
): TerrainHandle {
  const c = TOKENS.color
  const nearSpec = demSource(tj, prefix)
  let uninstallProtocol: (() => void) | null = null
  let spec = nearSpec
  /** lowest far-field height (map m, exaggeration 1); null until read */
  let floor: number | null = null
  if (far && typeof (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas === 'function') {
    const nearSet: TileSet = { minzoom: tj.minzoom, maxzoom: nearSpec.maxzoom ?? tj.maxzoom, bounds: tj.bounds }
    const farSet: TileSet = { minzoom: far.minzoom, maxzoom: far.maxzoom, bounds: far.bounds }
    const urls: DemTileUrls = { near: nearSet, far: farSet, nearUrl: tileUrl(tj, prefix), farUrl: tileUrl(far, prefix) }
    uninstallProtocol = installDemProtocol(urls)
    void lowestFarHeight(urls)
      .then((h) => {
        floor = h
        clipFloor()
      })
      .catch(() => undefined)
    spec = farDemSource(nearSet, farSet, DEM_PROTOCOL, [tj.attribution, far.attribution].filter(Boolean).join('; ') || undefined)
  }
  const farOn = spec !== nearSpec
  if (!map.getSource(DEM_SOURCE.terrain)) map.addSource(DEM_SOURCE.terrain, spec)
  // the 2D relief shading keeps the planning-extent tiles (2D unchanged by V1; the intro has its own relief-low)
  if (!map.getSource(DEM_SOURCE.relief)) map.addSource(DEM_SOURCE.relief, nearSpec)
  const reliefLayer = (id: string, source: string, visible: boolean): void => {
    if (map.getLayer(id)) return
    map.addLayer(
      {
        id,
        type: 'hillshade',
        source,
        layout: { visibility: visible ? 'visible' : 'none' },
        paint: {
          'hillshade-illumination-anchor': 'map',
          ...(initial.azimuth !== null ? { 'hillshade-illumination-direction': initial.azimuth } : {}),
          'hillshade-shadow-color': c.shadow,
          'hillshade-highlight-color': c.light,
          'hillshade-accent-color': c.shadow,
        },
      },
      beforeId && map.getLayer(beforeId) ? beforeId : undefined,
    )
  }
  reliefLayer(RELIEF_LAYER_ID, DEM_SOURCE.relief, true)
  if (farOn) {
    if (!map.getSource(RELIEF_FAR.source)) map.addSource(RELIEF_FAR.source, spec)
    reliefLayer(RELIEF_FAR.layer, RELIEF_FAR.source, false)
  }
  let exag = initial.exaggeration
  let on = false
  /**
   * V1: MapLibre 6.18 puts the camera's far plane on a flat plane at the lowest point of the tile under
   * the map centre (Terrain.getMinTileElevationForLngLatZoom -> transform.minElevationForCurrentTile), so
   * from a ridge the lower ground beyond fell behind the far plane and was clipped (a black top edge with
   * every tile loaded). The floor is held at or below the lowest point of the Gale pyramid.
   */
  function clipFloor(): void {
    type T = { getMinTileElevationForLngLatZoom(l: unknown, z: number): number; __hlFloor?: true }
    const t = (map as unknown as { terrain?: T | null }).terrain
    if (!t || floor === null || t.__hlFloor) return
    const orig = t.getMinTileElevationForLngLatZoom.bind(t)
    t.getMinTileElevationForLngLatZoom = (l, z) => Math.min(orig(l, z), (floor ?? 0) * exag)
    t.__hlFloor = true
  }
  // V1: the manual tilt cap follows the camera height (zoom); a story sets its own camera
  // V1: in 3D (not in a story) the far relief replaces the planning-extent one (same tiles inside the extent)
  let farShown = false
  const reliefSwap = (): void => {
    const want = farOn && on && !storyOn()
    if (want === farShown || !map.getLayer(RELIEF_FAR.layer)) return
    farShown = want
    map.setLayoutProperty(RELIEF_FAR.layer, 'visibility', want ? 'visible' : 'none')
    map.setLayoutProperty(RELIEF_LAYER_ID, 'visibility', want ? 'none' : 'visible')
  }
  const capPitch = (): void => {
    if (!farOn) return
    reliefSwap()
    const zoom = (map as Partial<MlMap>).getZoom?.()
    if (!on || zoom === undefined) return
    map.setMaxPitch(storyOn() ? TERRAIN.maxPitch3d : pitchCap(zoom, FAR_FIELD.pitchCap))
  }
  const sky = (next: boolean): void => {
    if (!farOn) return
    // setSky(undefined) resets the style's sky to MapLibre's transparent default (the typing wants a spec)
    const m = map as unknown as { setSky?: (s: ReturnType<typeof skySpec> | undefined) => void }
    m.setSky?.(next ? skySpec() : undefined)
  }
  let draped: { id: string; impl: Drapeable } | null = null

  const drape = (): void => {
    if (!draped) return
    const { impl } = draped
    if (on && !impl.renderToTerrainTile) {
      impl.renderToTerrainTile = (gl, o) => {
        const m = tileClipMatrix(o.tileID.canonical.z, o.tileID.canonical.x, o.tileID.canonical.y)
        // the field layer's render() reads only defaultProjectionData.mainMatrix
        impl.render(gl, { defaultProjectionData: { mainMatrix: m } } as unknown as Parameters<CustomLayerInterface['render']>[1])
      }
      impl.terrainTileRevision = (impl.terrainTileRevision ?? 0) + 1
    } else if (!on && impl.renderToTerrainTile) {
      delete impl.renderToTerrainTile
    }
    map.triggerRepaint()
  }

  const handle: TerrainHandle = {
    setTerrainOn(next, { animate }) {
      on = next
      if (next) {
        map.setTerrain({ source: DEM_SOURCE.terrain, exaggeration: exag })
        clipFloor()
        map.setMaxPitch(TERRAIN.maxPitch3d)
        capPitch()
        sky(true)
        map.dragRotate.enable()
        map.touchZoomRotate.enableRotation()
        map.keyboard.enable()
      } else {
        map.setTerrain(null)
        sky(false)
        reliefSwap()
        map.dragRotate.disable()
        map.touchZoomRotate.disableRotation()
      }
      drape()
      const target = next ? { pitch: TERRAIN.pitch3d } : { pitch: 0, bearing: 0 }
      // reduced motion: no camera animation (DESIGN §3.5)
      if (animate) map.easeTo({ ...target, duration: TOKENS.motion.cameraMs[0] })
      else map.jumpTo(target)
      if (!next) {
        // maxPitch 0 once the camera is flat again (2D, as before M8)
        if (animate) map.once('moveend', () => !on && map.setMaxPitch(0))
        else map.setMaxPitch(0)
      }
    },
    setExaggeration(x) {
      exag = x
      if (on) {
        map.setTerrain({ source: DEM_SOURCE.terrain, exaggeration: x })
        clipFloor()
      }
    },
    setLightAzimuth(az) {
      for (const id of [RELIEF_LAYER_ID, RELIEF_FAR.layer]) if (map.getLayer(id)) map.setPaintProperty(id, 'hillshade-illumination-direction', az ?? undefined)
    },
    drapeField(layerId) {
      const l = map.getLayer(layerId) as unknown as { implementation?: Drapeable } | undefined
      const impl = l?.implementation
      if (!impl) return
      if (draped && draped.impl !== impl) delete draped.impl.renderToTerrainTile
      draped = { id: layerId, impl }
      drape()
    },
    remove() {
      on = false
      drape()
      map.setTerrain(null)
      sky(false)
      ;(map as Partial<MlMap>).off?.('zoom', capPitch)
      uninstallProtocol?.()
      for (const id of [RELIEF_LAYER_ID, RELIEF_FAR.layer]) if (map.getLayer(id)) map.removeLayer(id)
      for (const id of [...Object.values(DEM_SOURCE), RELIEF_FAR.source]) if (map.getSource(id)) map.removeSource(id)
    },
  }
  ;(map as Partial<MlMap>).on?.('zoom', capPitch)
  return handle
}

/** Bump the drape revision of a field layer so MapLibre redraws its terrain tiles (field update). */
export function bumpDrape(map: MlMap, layerId: string): void {
  const impl = (map.getLayer(layerId) as unknown as { implementation?: Drapeable } | undefined)?.implementation
  if (impl?.renderToTerrainTile) impl.terrainTileRevision = (impl.terrainTileRevision ?? 0) + 1
}
