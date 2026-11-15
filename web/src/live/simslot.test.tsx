// D110 "Send to simulator" on #/plan/{hash}: the plan's mission.json (contracts/bundle/mission.schema.json).
//  - a live result -> its sim_plan manifest entry, results/{hash}/mission.json (WP9b);
//  - the official plan -> the API's /results/{official_hash}/mission.json, then sim/official/mission.json (WP9c);
//  - 404 everywhere -> "Simulator file not available for this plan", no link;
//  - hooks for the WP8c harness: data-sim-export and data-origin on the control;
//  - the mock's mission.json is a valid mission (origin computed_live, labels.live).
import { describe, expect, it } from 'vitest'
import missionSchema from '../../../contracts/bundle/mission.schema.json'
import { checkSchema, type JsonSchema } from '../data/schema'
import type { Manifest } from '../data/types'
import { dataUrl } from '../env'
import { isMissionText, missionVersion, OFFICIAL_MISSION_PATH, officialMissionUrl, probeMission } from '../ui/cards/simslot'
import { createApiClient } from './client'
import { LIVE_LABEL, PRECOMPUTED_LABEL } from './config'
import { createMockFetch } from './mock/fetch'
import { MOCK_OFFICIAL_HASH } from './mock/hashes'
import { MOCK_MISSION_LIVE, MOCK_SIM_FILE, mockFinishedTree, mockResultFile } from './mock/result'
import { MOCK_STAGES, RUN_RECORD_LIVE } from './mock/fixtures'
import { officialMissionApiUrl } from './index'
import { missionTarget, SimSlot } from './simslot'
import { textOf, toHtml } from './testing/html'
import type { RunRecord } from './types'

const API = 'http://api.test'
const LIVE_HASH = (RUN_RECORD_LIVE as RunRecord).hash
const base = (h: string) => `${API}/api/v1/results/${h}`
const MISSION_TEXT = JSON.stringify(MOCK_MISSION_LIVE)
const json = (status: number, body: string) => new Response(body, { status })

/** Inline the schema's local #/$defs refs (checkSchema does not follow $ref). */
function inlineDefs(node: unknown, defs: Record<string, unknown>): unknown {
  if (Array.isArray(node)) return node.map((n) => inlineDefs(n, defs))
  if (!node || typeof node !== 'object') return node
  const { $ref, $defs: _d, ...rest } = node as Record<string, unknown>
  void _d
  const out = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, inlineDefs(v, defs)]))
  if (typeof $ref === 'string') return { ...(inlineDefs(defs[$ref.replace('#/$defs/', '')], defs) as object), ...out }
  return out
}

describe('the mock live job serves a mission.json (WP9b shape)', () => {
  it('validates against contracts/bundle/mission.schema.json, origin computed_live with labels.live', () => {
    const s = inlineDefs(missionSchema, (missionSchema as { $defs: Record<string, unknown> }).$defs) as JsonSchema
    expect(checkSchema(MOCK_MISSION_LIVE, s)).toEqual([])
    expect(MOCK_MISSION_LIVE.origin).toBe('computed_live')
    expect(MOCK_MISSION_LIVE.origin_label).toBe(LIVE_LABEL)
    expect(MOCK_MISSION_LIVE.planner.routing_grid_res_m).toBe(3)
  })

  it('a finished mock job lists it in the manifest (kind sim_plan) and serves it; before that, neither', async () => {
    const m = mockResultFile('manifest.json', MOCK_STAGES) as Record<string, { kind?: string; file?: string }>
    expect(Object.values(m).filter((e) => e.kind === 'sim_plan').map((e) => e.file)).toEqual([MOCK_SIM_FILE])
    expect(mockResultFile(MOCK_SIM_FILE, MOCK_STAGES)).toBe(MOCK_MISSION_LIVE)
    expect(mockResultFile(MOCK_SIM_FILE, MOCK_STAGES.slice(0, -1))).toBeNull()
    const early = mockResultFile('manifest.json', MOCK_STAGES.slice(0, -1)) as Record<string, { kind?: string }>
    expect(Object.values(early).some((e) => e.kind === 'sim_plan')).toBe(false)
  })
})

describe('where the mission.json is', () => {
  const live = mockFinishedTree(true)('manifest.json') as Manifest
  const plain = mockFinishedTree(false)('manifest.json') as Manifest

  it('a live result: the sim_plan entry under the result base, else results/{hash}/mission.json', () => {
    expect(missionTarget(live, base(LIVE_HASH), 'computed_live')).toEqual({ origin: 'computed_live', urls: [`${base(LIVE_HASH)}/mission.json`] })
    expect(missionTarget(plain, base(LIVE_HASH), 'computed_live')).toEqual({ origin: 'computed_live', urls: [`${base(LIVE_HASH)}/mission.json`] })
    const other = { x: { value: null, units: null, file: 'sim/plan_v2.json', script: 's', commit: 'c', utc: 'u', kind: 'sim_plan' } } as unknown as Manifest
    expect(missionTarget(other, base(LIVE_HASH), 'computed_live')!.urls).toEqual([`${base(LIVE_HASH)}/sim/plan_v2.json`])
    expect(missionTarget(null, base(LIVE_HASH), null)).toBeNull()
  })

  it('the official plan: the API copy first, then the static sim/official/mission.json (dataUrl-relative)', () => {
    expect(OFFICIAL_MISSION_PATH).toBe('../sim/official/mission.json')
    expect(officialMissionUrl()).toBe(dataUrl('../sim/official/mission.json', 'real'))
    expect(new URL(officialMissionUrl(), 'https://x.test/app/').pathname).toBe('/sim/official/mission.json')
    expect(missionTarget(plain, base(MOCK_OFFICIAL_HASH), 'precomputed')).toEqual({
      origin: 'precomputed',
      urls: [`${base(MOCK_OFFICIAL_HASH)}/mission.json`, officialMissionUrl()],
    })
  })

  it('the live layer finds the official hash through /defaults and /plans/import', async () => {
    const client = createApiClient({ base: API, fetch: createMockFetch() })
    expect(await officialMissionApiUrl(client)).toBe(`${base(MOCK_OFFICIAL_HASH)}/mission.json`)
    const down = createApiClient({ base: API, fetch: () => Promise.reject(new TypeError('Failed to fetch')) })
    expect(await officialMissionApiUrl(down)).toBeNull()
  })
})

describe('the check (probeMission): found, 404, failure', () => {
  it('a live result: found, with the format version read from the file', async () => {
    const fetch = createMockFetch({ trees: { [LIVE_HASH]: mockFinishedTree(true) } })
    const p = await probeMission([`${base(LIVE_HASH)}/mission.json`], () => fetch)
    expect(p).toMatchObject({ state: 'ok', url: `${base(LIVE_HASH)}/mission.json`, version: '1.1.0' })
  })

  it('404 -> missing; a 200 that is not a mission (an HTML fallback page) counts as missing too', async () => {
    const fetch = createMockFetch({ trees: { [LIVE_HASH]: mockFinishedTree(false) } })
    expect(await probeMission([`${base(LIVE_HASH)}/mission.json`], () => fetch)).toEqual({ state: 'missing' })
    expect(await probeMission(['/x'], () => async () => json(200, '<!doctype html><title>app</title>'))).toEqual({ state: 'missing' })
  })

  it('the official plan falls back to the static file when the API has none', async () => {
    const api = `${base(MOCK_OFFICIAL_HASH)}/mission.json`
    const fetchFor = (u: string) => async () => (u === api ? json(404, '{}') : json(200, MISSION_TEXT.replace('computed_live', 'precomputed')))
    expect(await probeMission([api, officialMissionUrl()], fetchFor)).toMatchObject({ state: 'ok', url: officialMissionUrl(), version: '1.1.0' })
  })

  it('a server error or network failure is "failed" (the link stays), not "missing"', async () => {
    expect(await probeMission(['/a'], () => async () => json(500, ''))).toEqual({ state: 'failed', message: 'HTTP 500' })
    expect(await probeMission(['/a'], () => () => Promise.reject(new TypeError('Failed to fetch')))).toEqual({ state: 'failed', message: 'Failed to fetch' })
  })

  it('reads only the version: no full parse needed', () => {
    expect(isMissionText(MISSION_TEXT)).toBe(true)
    expect(missionVersion(MISSION_TEXT)).toBe('1.1.0')
    expect(missionVersion('{"kind":"homeline_mission"}')).toBeNull()
    expect(isMissionText('{"kind":"pad-local"}')).toBe(false)
  })
})

describe('the slot: states and harness hooks', () => {
  const live = mockFinishedTree(true)('manifest.json') as Manifest
  const url = `${base(LIVE_HASH)}/mission.json`

  it('ready: the link to results/{hash}/mission.json, download name mission.json, format version, hooks', () => {
    const html = toHtml(<SimSlot enabled manifest={live} base={base(LIVE_HASH)} origin="computed_live" probe={{ state: 'ok', url, version: '1.1.0', text: MISSION_TEXT }} />)
    expect(html).toMatch(/<a [^>]*href="http:\/\/api\.test\/api\/v1\/results\/[0-9a-f]{16}\/mission\.json"/)
    expect(html).toContain('download="mission.json"')
    expect(html).toContain('data-sim-export="ready"')
    expect(html).toContain('data-origin="computed_live"')
    expect(html).toContain('data-sim-version="1.1.0"')
    const text = textOf(<SimSlot enabled manifest={live} base={base(LIVE_HASH)} origin="computed_live" probe={{ state: 'ok', url, version: '1.1.0', text: MISSION_TEXT }} />)
    expect(text).toContain('Download mission.json') // the link's accessible name
    expect(text).toContain('mission.json format 1.1.0')
    expect(text).toContain(LIVE_LABEL)
  })

  it('the official plan: data-origin precomputed, labels.precomputed, the static path when that is where it was found', () => {
    const s = officialMissionUrl()
    const html = toHtml(<SimSlot enabled manifest={live} base={base(MOCK_OFFICIAL_HASH)} origin="precomputed" probe={{ state: 'ok', url: s, version: '1.1.0', text: MISSION_TEXT }} />)
    expect(html).toContain(`href="${s}"`)
    expect(html).toContain('data-origin="precomputed"')
    expect(textOf(<SimSlot enabled manifest={live} base={base(MOCK_OFFICIAL_HASH)} origin="precomputed" />)).toContain(PRECOMPUTED_LABEL)
  })

  it('missing: the honest message with the hooks, no link; failed: the link with the reason', () => {
    const miss = toHtml(<SimSlot enabled manifest={live} base={base(LIVE_HASH)} origin="computed_live" probe={{ state: 'missing' }} />)
    expect(miss).toContain('Simulator file not available for this plan')
    expect(miss).toContain('data-sim-export="missing"')
    expect(miss).toContain('data-origin="computed_live"')
    expect(miss).not.toContain('<a ')
    const failed = toHtml(<SimSlot enabled manifest={live} base={base(LIVE_HASH)} origin="computed_live" probe={{ state: 'failed', message: 'HTTP 502' }} />)
    expect(failed).toContain(`href="${url}"`)
    expect(failed).toContain('data-sim-export="failed"')
    expect(failed).toContain('HTTP 502')
  })

  it('flag off: nothing, whatever the plan', () => {
    expect(toHtml(<SimSlot enabled={false} manifest={live} base={base(LIVE_HASH)} origin="computed_live" probe={{ state: 'ok', url, version: '1.1.0', text: MISSION_TEXT }} />)).toBe('')
  })
})
