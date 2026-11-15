// PORT U4: the export payload on the REAL published data (web/public/data): a user route's mission.json
// is the route core's exporter output byte for byte; with no route the official plan of the pad is
// exported (official pad: sim/official/mission.json unchanged; picker pad: its official stations through
// the core). File name homeline-mission-<hash8>.json, kind and origin_label as the core writes them.
/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { PadFile, Rad, Station } from '../../../data/types'
import { decodeRGBA, FieldGrid, fieldGrid } from '../../../hud/fields'
import { readPngRGBA, REPO } from '../../../hud/testutil'
import type { FieldsIndex } from '../../../hud/types'
import { PointerField } from '../../../hud/wayhome'
import { buildBrowserMission, computeBrowserRoute } from '../../../edit/route/browser/compute'
import { makeBrowserRouteData, type BrowserRouteData } from '../../../edit/route/browser/data'
import { ORIGIN_LABEL } from '../../../edit/route/browser/export'
import { withEvaStart } from '../../../edit/route/browser/start'
import { hash8 as estimateHash8 } from '../../../edit/route/instant/estimate'
import { routeGridOf, sampleElevation } from '../../../edit/route/map/grid'
import { codecOf, decodeHeights, farOrigin, gunzipIfNeeded, HeightGrid, lonLatToXY, parseEqc, parseIndex } from '../../../edit/route/map/heights'
import { gradeModel, scenarioParams } from '../../../edit/route/map/physio'
import { mockPadEnv, mockPadInfo } from '../../../pads/mock'
import type { PadEnv, PlanProducts } from '../../../pads/types'
import { EMPTY_ROUTE, makeStop, OFFICIAL_PAD_ID, toRouteStops, type PlanningDoc } from '../../../state/planning'
import { createExportCore, ExportError, officialStops } from './core'
import { buildExportPayload, hash8, missionFileName } from './payload'

const PUB = resolve(REPO, 'web/public/data')
const HAVE = existsSync(resolve(PUB, 'fields/index.json'))
const J = <T>(rel: string): T => JSON.parse(readFileSync(resolve(PUB, rel), 'utf8')) as T
const NOW = new Date('2026-11-15T19:30:00Z')

const fi = () => J<FieldsIndex>('fields/index.json')
function field(k: string): FieldGrid {
  const meta = fi().fields[k]
  const { rgba, width, height } = readPngRGBA(resolve(PUB, meta.file))
  return new FieldGrid(fieldGrid(fi(), k), decodeRGBA(rgba, width, height, meta.scale), meta.units)
}

/** As edit/route/browser/compute.test.ts: the official pad's data from the files. */
async function loadFromFiles(sid = 'nom_104'): Promise<BrowserRouteData> {
  const tHome = field(`${sid}/t_home`)
  const pMeta = fi().fields[`${sid}/pointer`]
  const fp = parseIndex(J('fp3d/index.json'))
  const raw = readFileSync(resolve(PUB, fp.far.file))
  const buf = await gunzipIfNeeded(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer)
  const [west, north] = farOrigin(fp)
  const heights = new HeightGrid(west, north, fp.far.res_m, fp.far.width, fp.far.height, decodeHeights(buf, fp.far.width, fp.far.height, codecOf(fp)))
  const eqc = parseEqc(fp.chunk_grid.crs)
  return makeBrowserRouteData({
    scenario: sid,
    tHome,
    o2Home: field(`${sid}/o2_home`),
    pointer: new PointerField(field(`${sid}/pointer`), pMeta.stencil!),
    grid: routeGridOf(tHome, sampleElevation(tHome, heights, (lon, lat) => lonLatToXY(eqc, lon, lat))),
    model: gradeModel(scenarioParams(sid)),
    stations: J<Station[]>('stations.json'),
    padFile: J<PadFile>('pad.json'),
    rad: J<Rad>('conditions/rad.json'),
    clock: J('conditions/clock.json'),
    files: { tHome: fi().fields[`${sid}/t_home`].file, o2Home: fi().fields[`${sid}/o2_home`].file, pointer: pMeta.file, elevation: fp.far.file },
    elevationResM: fp.far.res_m,
  })
}

const stations = (...ids: string[]) => ids.map((station) => makeStop({ kind: 'station', station }))
const plan = (padId: string, stops = stations(), extra: Partial<PlanningDoc['route']> = {}): PlanningDoc => ({ padId, route: { ...EMPTY_ROUTE, stops, ...extra } })
/* eslint-disable @typescript-eslint/no-explicit-any */
type Doc = Record<string, any>

describe.skipIf(!HAVE)('export payload (real data)', () => {
  let d: BrowserRouteData
  beforeAll(async () => {
    d = await loadFromFiles()
  }, 60_000)

  /** What the core exporter writes for the same inputs (no U4 code involved). */
  async function coreText(p: PlanningDoc): Promise<string> {
    const data = { ...withEvaStart(d, p.route.startUtc ? Date.parse(p.route.startUtc) : null), storm: p.route.storm }
    const r = computeBrowserRoute(data, data.fieldsPad, toRouteStops(p.route.stops))
    return JSON.stringify(await buildBrowserMission(r, { data, now: NOW }), null, 1)
  }

  it('user route: byte for byte the core exporter output (stations + a free point, storm on and off, moved start)', async () => {
    const core = createExportCore({ dataFor: async () => d })
    const fixtures = [
      plan(OFFICIAL_PAD_ID, stations('S4', 'S1', 'S6', 'S7')),
      plan(OFFICIAL_PAD_ID, [...stations('S4'), makeStop({ kind: 'point', lon: d.fieldsPad.lon + 0.002, lat: d.fieldsPad.lat + 0.001 })], { storm: true }),
      plan(OFFICIAL_PAD_ID, stations('S1', 'S4'), { startUtc: '2026-11-16T15:00:00Z' }),
    ]
    for (const p of fixtures) {
      const out = await buildExportPayload(p, core, NOW)
      expect(out.source).toBe('route')
      expect(out.text).toBe(await coreText(p))
      expect(out.doc.kind).toBe('homeline_mission')
      expect(String(out.doc.origin_label).startsWith(ORIGIN_LABEL)).toBe(true)
      expect(out.name).toBe(`homeline-mission-${String(out.doc.mission_id).slice(2, 10)}.json`)
      expect(out.name).toMatch(/^homeline-mission-[0-9a-f]{8}\.json$/)
    }
  }, 120_000)

  it('the exact strings Unity reads: kind, origin, origin_label', async () => {
    const out = await buildExportPayload(plan(OFFICIAL_PAD_ID, stations('S4', 'S1')), createExportCore({ dataFor: async () => d }), NOW)
    const doc = out.doc as Doc
    expect(doc.kind).toBe('homeline_mission')
    expect(doc.origin).toBe('mission_planer')
    expect(doc.origin_label).toBe('Estimate · browser, 5 m grid · not part of the validated scorecard')
    expect(doc.frame.pad.kind).toBe('official')
  }, 60_000)

  it('no user route on the official pad: the published official mission.json, unchanged', async () => {
    const text = readFileSync(resolve(REPO, 'web/public/sim/official/mission.json'), 'utf8')
    const urls: string[] = []
    const core = createExportCore({
      fetch: async (u) => {
        urls.push(u)
        return new Response(text, { status: 200 })
      },
    })
    const out = await buildExportPayload(plan(OFFICIAL_PAD_ID), core, NOW)
    expect(out.source).toBe('official')
    expect(out.text).toBe(text)
    expect(urls[0]).toMatch(/sim\/official\/mission\.json$/)
    const doc = out.doc as Doc
    expect(doc.kind).toBe('homeline_mission')
    expect(doc.origin_label).toBe('Precomputed · official plan')
    expect(out.name).toBe(`homeline-mission-${doc.mission_id.slice(2, 10)}.json`)
  })

  it('no user route on the official pad, file missing: an official error, not a crash', async () => {
    const core = createExportCore({ fetch: async () => new Response('<!doctype html>', { status: 200 }) })
    await expect(buildExportPayload(plan(OFFICIAL_PAD_ID), core)).rejects.toMatchObject({ code: 'official' })
    const core404 = createExportCore({ fetch: async () => new Response('nope', { status: 404 }) })
    await expect(buildExportPayload(plan(OFFICIAL_PAD_ID), core404)).rejects.toBeInstanceOf(ExportError)
  })

  it("picker pad, no user route: its official route's stations, in order, through the core on that pad's fields", async () => {
    const routeFc = J<PlanProducts['route']>('scenarios/pads/rank2/route_nom_104.geojson')
    expect(officialStops(routeFc).map((s) => (s.kind === 'station' ? s.station : '?'))).toEqual(['S7', 'S6', 'S1', 'S4'])
    const info = mockPadInfo('rank2', 2, 137.393301, -4.776468)
    const env: PadEnv = {
      ...mockPadEnv(info),
      routingFields: {
        padId: 'rank2',
        scenario: 'nom_104',
        pad: { lon: info.lon, lat: info.lat, elevM: -3779.5 },
        tHome: field('pads/rank2/nom_104/t_home'),
        o2Home: field('pads/rank2/nom_104/o2_home'),
        pointer: new PointerField(field('pads/rank2/nom_104/pointer'), fi().fields['pads/rank2/nom_104/pointer'].stencil!),
      },
      planProducts: async () => ({ bands: { type: 'FeatureCollection', features: [] }, edges: { type: 'FeatureCollection', features: [] }, partner: null, route: routeFc, timeline: null }) as unknown as PlanProducts,
    }
    const core = createExportCore({ padEnv: async () => env, baseData: async () => d })
    const out = await buildExportPayload(plan('rank2'), core, NOW)
    const doc = out.doc as Doc
    expect(out.source).toBe('official')
    expect(doc.kind).toBe('homeline_mission')
    expect(doc.frame.pad).toMatchObject({ kind: 'picker', id: 'rank2', lon: info.lon, lat: info.lat })
    expect(doc.waypoints.map((w: Doc) => w.note.split(' · ')[0])).toEqual(['S7', 'S6', 'S1', 'S4'])
    expect(doc.legs.every((l: Doc) => l.routed)).toBe(true)
    expect(doc.planner.files.tHome).toBe('fields/pads/rank2/nom_104/t_home.png')
  }, 120_000)

  it('a route the core cannot compute: a route error with the reason', async () => {
    const core = createExportCore({ dataFor: async () => d })
    const err = await buildExportPayload(plan(OFFICIAL_PAD_ID, stations('S99')), core).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ExportError)
    expect((err as ExportError).code).toBe('route')
    expect((err as ExportError).reason).toMatch(/S99|unknown station/)
  }, 60_000)

  it('a pad without routing fields: pad error', async () => {
    const info = { ...mockPadInfo('pad_default', 9, 137.4, -4.78), hasRoutingFields: false }
    const core = createExportCore({ padEnv: async () => mockPadEnv(info), baseData: async () => d })
    await expect(buildExportPayload(plan('pad_default', stations('S4')), core)).rejects.toMatchObject({ code: 'pad' })
  })
})

describe('file name', () => {
  it('hash8 is the Edit-route export hash8 (homeline-mission-<hash8>.json)', () => {
    for (const s of ['', 'a', 'official:', 'rank2:WzIsInJhbmsyIl0']) expect(hash8(s)).toBe(estimateHash8(s))
  })
  it('first 8 hex of mission_id, else hash8 of the plan key', () => {
    expect(missionFileName({ mission_id: 'm-d32c8e0e7c20' }, 'k')).toBe('homeline-mission-d32c8e0e.json')
    expect(missionFileName({ mission_id: '' }, 'k')).toBe(`homeline-mission-${estimateHash8('k')}.json`)
    expect(missionFileName({}, 'k')).toBe(`homeline-mission-${estimateHash8('k')}.json`)
  })
})
