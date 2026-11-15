// V1 (D141, 3D far field): a diagnosis switch for the 3D map. `?tiles=debug` (search or hash query)
// turns on MapLibre's tile boundaries and leaves the map at globalThis.__hlMap3d so a Playwright probe
// can set the camera (flythrough pitch) and read which tiles are loaded. Off by default; nothing on
// screen changes without the parameter.
import type { Map as MlMap } from 'maplibre-gl'

function param(search: string, hash: string, key: string): string | null {
  const q = new URLSearchParams(search)
  const h = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  if (h) new URLSearchParams(h).forEach((v, k) => q.set(k, v))
  return q.get(key)
}

/** True when the page asks for the tile-debug view (?tiles=debug in the search or the hash query). */
export function tileDebugRequested(search: string, hash: string): boolean {
  return param(search, hash, 'tiles') === 'debug'
}

/**
 * V1: ?farfield=off draws 3D as before V1 (planning-extent DEM only, no sky or fog, the fixed tilt cap):
 * the before/after comparison and a review fallback.
 */
export function farFieldOff(): boolean {
  return typeof location !== 'undefined' && param(location.search, location.hash, 'farfield') === 'off'
}

export function installTileDebug(map: MlMap): void {
  if (typeof location === 'undefined' || !tileDebugRequested(location.search, location.hash)) return
  map.showTileBoundaries = true
  ;(globalThis as Record<string, unknown>).__hlMap3d = map
}
