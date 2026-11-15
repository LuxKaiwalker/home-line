// Curiosity (MSL) on the Mission Planer: the rover's real traverse and drive ends inside the map
// area, and the pictures it took at a drive end. All live from NASA (both answer CORS "*", no key):
//   - MMGIS layers MSL_waypoints.json (one point per drive end: sol, site, drive, lon/lat, ...) and
//     MSL_traverse.json (the driven line), docs/discovery.md §3.1
//   - the raw-image API (docs/discovery.md §3.3): one query per sol, both cameras in one search
// Matching pictures to a drive end ("stop"):
//   - Navcam items carry site + drive: a frame belongs to the stop when its site/drive equal the
//     stop's (the rover had not moved), on any sol the rover was parked there.
//   - Mastcam items carry NO site/drive (null in the API): they are matched by sol only, i.e. the
//     sols the rover was parked at this stop. A Mastcam frame from the morning of the arrival sol
//     can therefore be from before the drive; the popup says so.
// Nothing here is cached in the repo: it is NASA's current data, labelled "live" on screen.

export const MSL_WAYPOINTS_URL = 'https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json'
export const MSL_TRAVERSE_URL = 'https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json'
export const RAW_IMAGE_API = 'https://mars.nasa.gov/api/v1/raw_image_items/'
export const RAW_IMAGE_PAGE = 'https://mars.nasa.gov/msl/multimedia/raw-images/'
/** Instruments asked for: Mastcam (colour) and Navcam (both eyes, B side computer). */
export const CAMERAS = { mastcam: ['MAST_LEFT', 'MAST_RIGHT'], navcam: ['NAV_LEFT_B', 'NAV_RIGHT_B'] } as const
/** At most this many parked sols are searched per stop (long stays would mean many requests). */
export const MAX_PARKED_SOLS = 3
/** At most this many API pages (200 items each) per sol. */
export const MAX_PAGES_PER_SOL = 5

export type Bounds = [west: number, south: number, east: number, north: number]

export interface DriveEnd {
  rmc: string
  sol: number
  site: number
  drive: number
  lon: number
  lat: number
  /** this drive's length, m (MMGIS dist_m) */
  distM: number | null
  /** odometry since landing, m (MMGIS dist_total_m) */
  totalM: number | null
}

const inside = (b: Bounds, lon: number, lat: number) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Drive ends of MSL_waypoints.json inside `b`, in drive order (sol, site, drive). */
export function driveEndsIn(fc: unknown, b: Bounds): DriveEnd[] {
  const feats = (fc as { features?: unknown[] } | null)?.features
  if (!Array.isArray(feats)) throw new Error('MSL_waypoints.json: no features')
  const out: DriveEnd[] = []
  for (const f of feats) {
    const p = (f as { properties?: Record<string, unknown> }).properties ?? {}
    const lon = num(p.lon)
    const lat = num(p.lat)
    const sol = num(p.sol)
    const site = num(p.site)
    const drive = num(p.drive)
    if (lon === null || lat === null || sol === null || site === null || drive === null || !inside(b, lon, lat)) continue
    out.push({ rmc: String(p.RMC ?? `${site}_${drive}`), sol, site, drive, lon, lat, distM: num(p.dist_m), totalM: num(p.dist_total_m) })
  }
  return out.sort((a, c) => a.sol - c.sol || a.site - c.site || a.drive - c.drive)
}

type Pt = [number, number]

/** MSL_traverse.json clipped to `b`: each line split into runs of vertices inside (one vertex of
 *  slack on each side, so a run reaches the map edge). */
export function traverseIn(fc: unknown, b: Bounds): Pt[][] {
  const feats = (fc as { features?: unknown[] } | null)?.features
  if (!Array.isArray(feats)) throw new Error('MSL_traverse.json: no features')
  const runs: Pt[][] = []
  for (const f of feats) {
    const g = (f as { geometry?: { type?: string; coordinates?: unknown } }).geometry
    const lines: unknown[] = g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? (g.coordinates as unknown[]) : []
    for (const line of lines) {
      const pts = (line as number[][]).map((c) => [c[0], c[1]] as Pt)
      let run: Pt[] = []
      const flush = () => {
        if (run.length > 1) runs.push(run)
        run = []
      }
      for (let i = 0; i < pts.length; i++) {
        const inNow = inside(b, pts[i][0], pts[i][1])
        const inPrev = i > 0 && inside(b, pts[i - 1][0], pts[i - 1][1])
        const inNext = i + 1 < pts.length && inside(b, pts[i + 1][0], pts[i + 1][1])
        // two outside vertices in a row: the line left the map, end the run there
        if (!inNow && !inPrev && run.length) flush()
        if (inNow || inPrev || inNext) run.push(pts[i])
      }
      flush()
    }
  }
  return runs
}

/** Sols the rover sat at `stop`: its sol up to the sol before the next drive (at least one, capped). */
export function parkedSols(stop: DriveEnd, next: DriveEnd | null): number[] {
  const last = next && next.sol > stop.sol ? next.sol - 1 : stop.sol
  const out: number[] = []
  for (let s = stop.sol; s <= last && out.length < MAX_PARKED_SOLS; s++) out.push(s)
  return out
}

export interface RawImage {
  id: string
  camera: 'mastcam' | 'navcam'
  instrument: string
  sol: number
  takenUtc: string
  url: string
  sampleType: string
  title: string
  credit: string
}

/** One page of raw_image_items for one sol, Mastcam + Navcam. */
export function rawImageQuery(sol: number, page: number): string {
  const search = [...CAMERAS.mastcam, ...CAMERAS.navcam].join('|')
  return `${RAW_IMAGE_API}?order=date_taken+asc&per_page=200&page=${page}&condition_1=msl:mission&condition_2=${sol}:sol:in&search=${search}`
}

/** API items -> the pictures of `stop`: Navcam with the stop's site/drive, Mastcam by sol; no
 *  thumbnails (each frame also comes as a 64 px thumbnail item). */
export function stopImages(items: unknown[], stop: DriveEnd, sols: number[]): RawImage[] {
  const solSet = new Set(sols)
  const out: RawImage[] = []
  const seen = new Set<string>()
  for (const it of items) {
    const i = it as Record<string, unknown>
    const ext = (i.extended ?? {}) as Record<string, unknown>
    const inst = String(i.instrument ?? '')
    const camera = (CAMERAS.mastcam as readonly string[]).includes(inst) ? 'mastcam' : (CAMERAS.navcam as readonly string[]).includes(inst) ? 'navcam' : null
    const url = typeof i.https_url === 'string' ? i.https_url : typeof i.url === 'string' ? i.url : null
    const sampleType = String(ext.sample_type ?? '')
    const id = String(i.imageid ?? i.id ?? url)
    if (!camera || !url || sampleType === 'thumbnail' || seen.has(id)) continue
    if (camera === 'navcam' && (i.site !== stop.site || i.drive !== stop.drive)) continue
    if (camera === 'mastcam' && !solSet.has(Number(i.sol))) continue
    seen.add(id)
    out.push({ id, camera, instrument: inst, sol: Number(i.sol), takenUtc: String(i.date_taken ?? ''), url, sampleType, title: String(i.title ?? ''), credit: String(i.image_credit ?? 'NASA/JPL-Caltech') })
  }
  return out
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const r = await fetch(url, { signal })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return r.json()
}

/** Drive ends + traverse inside `b`, fetched live. */
export async function loadCuriosity(b: Bounds, signal?: AbortSignal): Promise<{ stops: DriveEnd[]; traverse: Pt[][] }> {
  const [wp, tr] = await Promise.all([getJson(MSL_WAYPOINTS_URL, signal), getJson(MSL_TRAVERSE_URL, signal).catch(() => null)])
  return { stops: driveEndsIn(wp, b), traverse: tr ? traverseIn(tr, b) : [] }
}

/** Pictures of `stop`, fetched live (one query per parked sol, paginated). */
export async function loadStopImages(stop: DriveEnd, next: DriveEnd | null, signal?: AbortSignal): Promise<{ images: RawImage[]; sols: number[]; truncated: boolean }> {
  const sols = parkedSols(stop, next)
  // Navcam frames taken just before the next drive keep this stop's site/drive: search that sol too.
  const searchSols = next && next.sol > sols[sols.length - 1] ? [...sols, next.sol] : sols
  let truncated = !!next && next.sol - stop.sol > MAX_PARKED_SOLS
  const items: unknown[] = []
  for (const sol of searchSols) {
    for (let page = 0; page < MAX_PAGES_PER_SOL; page++) {
      const d = (await getJson(rawImageQuery(sol, page), signal)) as { items?: unknown[]; more?: boolean }
      items.push(...(d.items ?? []))
      if (!d.more) break
      if (page === MAX_PAGES_PER_SOL - 1) truncated = true
    }
  }
  return { images: stopImages(items, stop, sols), sols, truncated }
}
