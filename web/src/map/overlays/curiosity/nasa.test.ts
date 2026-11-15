// L1b: the NASA side of the Curiosity layer, all with fetch mocked (no network in tests).
// Ported from mission/curiosity.test.ts (pure parts unchanged) + request limits, session cache and the
// "unavailable" classification (timeout, CORS/network, 5xx, refused, bad JSON).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  driveEndsIn,
  FETCH_TIMEOUT_MS,
  getJson,
  loadCuriosity,
  loadStopImages,
  MAX_PAGES_PER_SOL,
  MAX_PARKED_SOLS,
  MSL_TRAVERSE_URL,
  MSL_WAYPOINTS_URL,
  NasaUnavailable,
  nasaRequestCount,
  parkedSols,
  RAW_IMAGE_API,
  rawImageQuery,
  resetNasaCache,
  stopImages,
  traverseIn,
  type Bounds,
  type DriveEnd,
} from './nasa'

const B: Bounds = [137.3, -4.9, 137.45, -4.7]
const pt = (sol: number, site: number, drive: number, lon: number, lat: number) => ({
  type: 'Feature',
  properties: { RMC: `${site}_${drive}`, sol, site, drive, lon, lat, dist_m: 10, dist_total_m: 30000 },
  geometry: { type: 'Point', coordinates: [lon, lat] },
})
const stop: DriveEnd = { rmc: '107_2484', sol: 4200, site: 107, drive: 2484, lon: 137.4, lat: -4.78, distM: 9, totalM: 1 }
const item = (o: Record<string, unknown>) => ({
  imageid: o.id,
  instrument: o.inst,
  sol: o.sol,
  site: o.site ?? null,
  drive: o.drive ?? null,
  https_url: `https://x/${o.id}.jpg`,
  date_taken: '2024-05-30T12:00:00.000Z',
  extended: { sample_type: o.st ?? 'full' },
  ...(o.small ? { image_files: { small: o.small } } : {}),
})

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response
const status = (n: number) => ({ ok: false, status: n, json: async () => ({}) }) as unknown as Response

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  resetNasaCache()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('drive ends inside the map area (ported)', () => {
  it('keeps points inside the bounds, sorted by sol/site/drive', () => {
    const fc = { features: [pt(4200, 107, 2484, 137.4, -4.78), pt(10, 3, 0, 137.44, -4.59), pt(4190, 107, 2054, 137.41, -4.79)] }
    const s = driveEndsIn(fc, B)
    expect(s.map((x) => x.rmc)).toEqual(['107_2054', '107_2484'])
    expect(s[1]).toMatchObject({ sol: 4200, site: 107, drive: 2484, distM: 10, totalM: 30000 })
  })
  it('a file without features is "unavailable: format"', () => {
    expect(() => driveEndsIn({}, B)).toThrow(NasaUnavailable)
    expect(() => driveEndsIn({}, B)).toThrow(/no features/)
  })
})

describe('traverse clipped to the map area (ported)', () => {
  it('splits a line into inside runs with one vertex of slack', () => {
    const line = [[137.2, -4.8], [137.31, -4.8], [137.32, -4.8], [137.5, -4.8], [137.6, -4.8], [137.44, -4.8], [137.43, -4.8]]
    const runs = traverseIn({ features: [{ geometry: { type: 'LineString', coordinates: line } }] }, B)
    expect(runs).toEqual([
      [[137.2, -4.8], [137.31, -4.8], [137.32, -4.8], [137.5, -4.8]],
      [[137.6, -4.8], [137.44, -4.8], [137.43, -4.8]],
    ])
  })
})

describe('parked sols (ported, limit kept)', () => {
  it('from the arrival sol to the sol before the next drive, capped at MAX_PARKED_SOLS = 3', () => {
    expect(MAX_PARKED_SOLS).toBe(3)
    expect(parkedSols(stop, { ...stop, sol: 4203 })).toEqual([4200, 4201, 4202])
    expect(parkedSols(stop, { ...stop, sol: 4200 })).toEqual([4200]) // next drive the same sol
    expect(parkedSols(stop, null)).toEqual([4200])
    expect(parkedSols(stop, { ...stop, sol: 4300 })).toHaveLength(MAX_PARKED_SOLS)
  })
})

describe('matching pictures to a drive end', () => {
  it('Navcam by site/drive, Mastcam by parked sol, no thumbnails, no duplicates (ported)', () => {
    const items = [
      item({ id: 'n1', inst: 'NAV_LEFT_B', sol: 4200, site: 107, drive: 2484 }),
      item({ id: 'n2', inst: 'NAV_LEFT_B', sol: 4200, site: 107, drive: 2394 }), // earlier stop
      item({ id: 'n3', inst: 'NAV_RIGHT_B', sol: 4201, site: 107, drive: 2484, st: 'thumbnail' }),
      item({ id: 'm1', inst: 'MAST_RIGHT', sol: 4200 }),
      item({ id: 'm2', inst: 'MAST_LEFT', sol: 4201 }), // next drive's sol, not parked
      item({ id: 'm1', inst: 'MAST_RIGHT', sol: 4200 }),
      item({ id: 'h1', inst: 'FHAZ_LEFT_B', sol: 4200, site: 107, drive: 2484 }),
    ]
    const got = stopImages(items, stop, [4200])
    expect(got.map((g) => `${g.camera}:${g.id}`)).toEqual(['navcam:n1', 'mastcam:m1'])
  })

  it('Navcam keeps the stop on any sol with its site/drive (also the next drive sol); Mastcam only on parked sols', () => {
    const items = [
      item({ id: 'n-next', inst: 'NAV_RIGHT_B', sol: 4202, site: 107, drive: 2484 }), // before the next drive
      item({ id: 'n-moved', inst: 'NAV_RIGHT_B', sol: 4202, site: 107, drive: 2600 }), // after it
      item({ id: 'm-park', inst: 'MAST_LEFT', sol: 4201 }),
      item({ id: 'm-next', inst: 'MAST_LEFT', sol: 4202 }),
    ]
    expect(stopImages(items, stop, [4200, 4201]).map((g) => g.id)).toEqual(['n-next', 'm-park'])
  })

  it('metadata for the card: camera, instrument, sol, time, smaller rendition for the thumbnail', () => {
    const [m] = stopImages([item({ id: 'm1', inst: 'MAST_LEFT', sol: 4200, small: 'https://x/m1-small.jpg' })], stop, [4200])
    expect(m).toMatchObject({ camera: 'mastcam', instrument: 'MAST_LEFT', sol: 4200, takenUtc: '2024-05-30T12:00:00.000Z', url: 'https://x/m1.jpg', thumbUrl: 'https://x/m1-small.jpg' })
    const [n] = stopImages([item({ id: 'n1', inst: 'NAV_LEFT_B', sol: 4200, site: 107, drive: 2484 })], stop, [4200])
    expect(n.thumbUrl).toBe(n.url)
  })

  it('query asks for one sol and both cameras (ported)', () => {
    expect(rawImageQuery(4200, 1)).toContain('condition_2=4200:sol:in')
    expect(rawImageQuery(4200, 1)).toContain('page=1')
    expect(rawImageQuery(4200, 0)).toContain('search=MAST_LEFT|MAST_RIGHT|NAV_LEFT_B|NAV_RIGHT_B')
    expect(rawImageQuery(4200, 0).startsWith(RAW_IMAGE_API)).toBe(true)
  })
})

describe('request limits (as mission/curiosity.ts)', () => {
  it('at most 3 parked sols + the next drive sol, at most 5 pages each, then "truncated"', async () => {
    expect(MAX_PAGES_PER_SOL).toBe(5)
    fetchMock.mockImplementation(async () => ok({ items: [], more: true }))
    const r = await loadStopImages(stop, { ...stop, rmc: 'next', sol: 4250 })
    // parked sols 4200..4202 (capped) + sol 4250 (Navcam before the next drive), 5 pages each
    expect(fetchMock).toHaveBeenCalledTimes((MAX_PARKED_SOLS + 1) * MAX_PAGES_PER_SOL)
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(new Set(urls.map((u) => /condition_2=(\d+)/.exec(u)![1]))).toEqual(new Set(['4200', '4201', '4202', '4250']))
    expect(urls.every((u) => u.startsWith(RAW_IMAGE_API))).toBe(true)
    expect(r).toMatchObject({ sols: [4200, 4201, 4202], truncated: true })
  })

  it('stops paging when NASA says there is no more', async () => {
    fetchMock.mockImplementation(async () => ok({ items: [], more: false }))
    const r = await loadStopImages(stop, null)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(r.truncated).toBe(false)
  })

  it('a closed card stops further pages', async () => {
    const ac = new AbortController()
    fetchMock.mockImplementation(async () => {
      ac.abort()
      return ok({ items: [], more: true })
    })
    await expect(loadStopImages(stop, null, ac.signal)).rejects.toThrow(/aborted/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('session cache', () => {
  it('each NASA URL is fetched once per session while it succeeds', async () => {
    fetchMock.mockImplementation(async (u: string) => (u === MSL_WAYPOINTS_URL ? ok({ features: [pt(4200, 107, 2484, 137.4, -4.78)] }) : u === MSL_TRAVERSE_URL ? ok({ features: [] }) : ok({ items: [], more: false })))
    await loadCuriosity(B)
    await loadCuriosity(B)
    await loadStopImages(stop, null)
    await loadStopImages(stop, null)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(nasaRequestCount()).toBe(3)
  })

  it('requests omit credentials (no cookies to mars.nasa.gov)', async () => {
    fetchMock.mockResolvedValue(ok({}))
    await getJson(MSL_TRAVERSE_URL)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'omit' })
  })
})

describe('unavailable: NASA does not answer', () => {
  const reason = async (p: Promise<unknown>) => {
    try {
      await p
    } catch (e) {
      return e instanceof NasaUnavailable ? e.reason : `other: ${String(e)}`
    }
    return 'resolved'
  }

  it('5xx -> server, 4xx -> http', async () => {
    fetchMock.mockResolvedValueOnce(status(503)).mockResolvedValueOnce(status(404))
    expect(await reason(getJson('https://mars.nasa.gov/a'))).toBe('server')
    expect(await reason(getJson('https://mars.nasa.gov/b'))).toBe('http')
  })

  it('CORS refusal / offline (fetch rejects with a TypeError) -> network', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await reason(loadCuriosity(B))).toBe('network')
  })

  it('no answer in time -> timeout (the request is aborted)', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(
      (_u: string, init: RequestInit) =>
        new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))),
    )
    const p = reason(getJson(MSL_WAYPOINTS_URL))
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 1)
    expect(await p).toBe('timeout')
  })

  it('not JSON / not the expected shape -> format', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => JSON.parse('<html>') } as unknown as Response)
    expect(await reason(getJson('https://mars.nasa.gov/c'))).toBe('format')
    fetchMock.mockResolvedValue(ok({ nope: true }))
    expect(await reason(loadCuriosity(B))).toBe('format')
  })

  it('a failed request is not cached: retry asks NASA again', async () => {
    fetchMock.mockResolvedValueOnce(status(502)).mockResolvedValueOnce(ok({ features: [] }))
    expect(await reason(getJson(MSL_WAYPOINTS_URL))).toBe('server')
    expect(await getJson(MSL_WAYPOINTS_URL)).toEqual({ features: [] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a broken traverse alone leaves the drive ends (as in Mission)', async () => {
    fetchMock.mockImplementation(async (u: string) => (u === MSL_WAYPOINTS_URL ? ok({ features: [pt(4200, 107, 2484, 137.4, -4.78)] }) : status(500)))
    const c = await loadCuriosity(B)
    expect(c.stops).toHaveLength(1)
    expect(c.traverse).toEqual([])
  })
})
