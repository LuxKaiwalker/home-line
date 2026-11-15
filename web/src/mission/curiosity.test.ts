import { describe, expect, it } from 'vitest'
import { driveEndsIn, MAX_PARKED_SOLS, parkedSols, rawImageQuery, stopImages, traverseIn, type Bounds, type DriveEnd } from './curiosity'

const B: Bounds = [137.3, -4.9, 137.45, -4.7]
const pt = (sol: number, site: number, drive: number, lon: number, lat: number) => ({
  type: 'Feature',
  properties: { RMC: `${site}_${drive}`, sol, site, drive, lon, lat, dist_m: 10, dist_total_m: 30000 },
  geometry: { type: 'Point', coordinates: [lon, lat] },
})

describe('drive ends inside the map area', () => {
  it('keeps points inside the bounds, sorted by sol/site/drive', () => {
    const fc = { features: [pt(4200, 107, 2484, 137.4, -4.78), pt(10, 3, 0, 137.44, -4.59), pt(4190, 107, 2054, 137.41, -4.79)] }
    const s = driveEndsIn(fc, B)
    expect(s.map((x) => x.rmc)).toEqual(['107_2054', '107_2484'])
    expect(s[1]).toMatchObject({ sol: 4200, site: 107, drive: 2484, distM: 10, totalM: 30000 })
  })
  it('throws on a file without features', () => {
    expect(() => driveEndsIn({}, B)).toThrow(/no features/)
  })
})

describe('traverse clipped to the map area', () => {
  it('splits a line into inside runs with one vertex of slack', () => {
    const line = [[137.2, -4.8], [137.31, -4.8], [137.32, -4.8], [137.5, -4.8], [137.6, -4.8], [137.44, -4.8], [137.43, -4.8]]
    const runs = traverseIn({ features: [{ geometry: { type: 'LineString', coordinates: line } }] }, B)
    expect(runs).toEqual([
      [[137.2, -4.8], [137.31, -4.8], [137.32, -4.8], [137.5, -4.8]],
      [[137.6, -4.8], [137.44, -4.8], [137.43, -4.8]],
    ])
  })
})

const stop: DriveEnd = { rmc: '107_2484', sol: 4200, site: 107, drive: 2484, lon: 137.4, lat: -4.78, distM: 9, totalM: 1 }

describe('parked sols', () => {
  it('from the arrival sol to the sol before the next drive, capped', () => {
    expect(parkedSols(stop, { ...stop, sol: 4203 })).toEqual([4200, 4201, 4202])
    expect(parkedSols(stop, { ...stop, sol: 4200 })).toEqual([4200]) // next drive the same sol
    expect(parkedSols(stop, null)).toEqual([4200])
    expect(parkedSols(stop, { ...stop, sol: 4300 })).toHaveLength(MAX_PARKED_SOLS)
  })
})

describe('pictures of a stop', () => {
  const item = (o: Record<string, unknown>) => ({ imageid: o.id, instrument: o.inst, sol: o.sol, site: o.site ?? null, drive: o.drive ?? null, https_url: `https://x/${o.id}.jpg`, date_taken: '2024-05-30T12:00:00.000Z', extended: { sample_type: o.st ?? 'full' } })
  it('Navcam by site/drive, Mastcam by parked sol, no thumbnails, no duplicates', () => {
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
  it('query asks for one sol and both cameras', () => {
    expect(rawImageQuery(4200, 1)).toContain('condition_2=4200:sol:in')
    expect(rawImageQuery(4200, 1)).toContain('page=1')
    expect(rawImageQuery(4200, 0)).toContain('search=MAST_LEFT|MAST_RIGHT|NAV_LEFT_B|NAV_RIGHT_B')
  })
})
