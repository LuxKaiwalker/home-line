// A5s acceptance (WS15, D76) with the D110 mission.json export: the "Send to simulator" slot on the
// plan / route-summary card and the Report view placeholder, behind VITE_SIM_EXPORT (default off).
//  - flag off → nothing rendered, and the slot compiles to a few hundred bytes (its body is dropped);
//  - flag on, no props (the app's own tree = the official plan) → the official mission.json, WP9c's
//    static sim/official/mission.json (the live layer's API copy first when registered); 404 → the
//    "not available" message; the format version is read from the file, the plan is not parsed;
//  - flag on + a result manifest: its sim_plan entries as download links, no fetch of them;
//  - hooks for the WP8c harness: data-sim-export, data-origin.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, type VNode } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { build, type Plugin } from 'vite'
import type { Manifest } from '../../data/types'
import { dataUrl } from '../../env'
import { setManifest } from '../../prov/store'
import { ReportSimSlot } from '../../report'
import { t } from '../copy'
import { all, byTag, installDom, type FakeNode } from '../testing/dom'
import { RouteSummaryCard } from './cards'
import type { CardData } from './data'
import { officialMissionUrl, setOfficialMissionSource, SimSlot, simExportMode, simExportOn, simPlanFiles } from './simslot'
import { SendToSimulator } from './simslot-export'

const entry = (file: string, kind?: string) => ({ value: file, units: null, file, script: 'x', commit: 'c', utc: 'u', ...(kind ? { kind } : {}) })
/** A result manifest with two sim_plan files (neutral names: the format is open), a duplicate and other kinds. */
const TWO = {
  'export.a.first/plan.any': entry('first/plan.any', 'sim_plan'),
  'export.b.z_second': entry('z_second', 'sim_plan'),
  'export.b.dup': entry('z_second', 'sim_plan'),
  'figure.x': entry('figures/x.json', 'figure'),
  'route.nom_104': entry('route_nom_104.geojson'),
} as unknown as Manifest
const NONE = { 'figure.x': entry('figures/x.json', 'figure'), 'route.nom_104': entry('route_nom_104.geojson') } as unknown as Manifest

let root: FakeNode
const mount = (v: VNode): FakeNode => {
  act(() => render(v, root as unknown as Element))
  return root
}
const links = (n: FakeNode) => byTag(n, 'a')

beforeEach(() => {
  root = installDom().container
})
afterEach(() => {
  act(() => render(null, root as unknown as Element))
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  setManifest(null)
  setOfficialMissionSource(null)
})

describe('VITE_SIM_EXPORT off (default)', () => {
  it('the test environment runs with the flag off; only 1 or true turn it on', () => {
    expect(simExportOn()).toBe(false)
    for (const v of ['', '0', 'false', 'yes']) {
      vi.stubEnv('VITE_SIM_EXPORT', v)
      expect(simExportOn()).toBe(false)
    }
    for (const v of ['1', 'true', 'all', 'official']) {
      vi.stubEnv('VITE_SIM_EXPORT', v)
      expect(simExportOn()).toBe(true)
    }
    vi.stubEnv('VITE_SIM_EXPORT', 'official')
    expect(simExportMode()).toBe('official')
    for (const v of ['1', 'true', 'all']) {
      vi.stubEnv('VITE_SIM_EXPORT', v)
      expect(simExportMode()).toBe('all')
    }
  })

  it('renders nothing, even with sim_plan files in the manifest', () => {
    expect(mount(<SimSlot manifest={TWO} />).childNodes).toEqual([])
    setManifest(TWO)
    expect(mount(<SimSlot />).childNodes).toEqual([])
    expect(mount(<ReportSimSlot />).childNodes).toEqual([])
  })

  it('the plan card shows no slot', () => {
    setManifest(TWO)
    const n = mount(<RouteSummaryCard d={NO_ROUTE} />)
    expect(all(n, (x) => x.getAttribute('data-slot') === 'sim')).toEqual([])
    expect(n.textContent).not.toContain(t('simulator.sendSlot'))
  })

  it('compiles to a few hundred bytes: the slot body and its manifest reader are dropped', async () => {
    const off = await bundleOfSlot(undefined)
    const on = await bundleOfSlot('1')
    expect(off.length).toBeLessThan(400)
    expect(off).not.toContain('sim_plan')
    expect(on).toContain('sim_plan') // the measurement is not vacuous
    expect(on.length).toBeGreaterThan(off.length)
    const official = await bundleOfSlot('official') // D116: the static build with the flag set to official
    expect(official).toContain('sim/official/mission.json')
    expect(official.length).toBeGreaterThan(off.length)
  }, 60_000)
})

describe('VITE_SIM_EXPORT on', () => {
  beforeEach(() => vi.stubEnv('VITE_SIM_EXPORT', '1'))

  it('a result manifest without a sim_plan entry (or a null one) → nothing', () => {
    expect(mount(<SimSlot manifest={NONE} />).childNodes).toEqual([])
    expect(mount(<SimSlot manifest={null} />).childNodes).toEqual([])
    expect(mount(<ReportSimSlot manifest={NONE} />).childNodes).toEqual([])
  })

  it('two sim_plan entries → two download links with the manifest file names, no fetch of their contents', () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('no fetch expected')))
    vi.stubGlobal('fetch', fetchSpy)
    const n = mount(<SimSlot manifest={TWO} />)
    const a = links(n)
    expect(a.length).toBe(2)
    expect(a.map((x) => x.getAttribute('href'))).toEqual([dataUrl('first/plan.any'), dataUrl('z_second')])
    expect(a.map((x) => x.getAttribute('download'))).toEqual(['plan.any', 'z_second'])
    expect(a.map((x) => x.textContent.trim())).toEqual(['first/plan.any', 'z_second'])
    expect(a.map((x) => x.getAttribute('data-sim-export'))).toEqual(['ready', 'ready'])
    expect(n.textContent).toContain(t('simulator.sendSlot'))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('links point into the loaded result tree when a result base URL is given (origin computed_live)', () => {
    const base = 'https://example.test/api/v1/results/abc123'
    const a = links(mount(<SimSlot manifest={TWO} base={base} />))
    expect(a.map((x) => x.getAttribute('href'))).toEqual([`${base}/first/plan.any`, `${base}/z_second`])
    expect(a.map((x) => x.getAttribute('data-origin'))).toEqual(['computed_live', 'computed_live'])
  })

  it('the official plan (no props, on the plan card and the Report placeholder): sim/official/mission.json with its format version', async () => {
    const fetchSpy = vi.fn(async () => new Response(MISSION, { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    setManifest(NONE) // WP9c leaves the static manifest untouched: no sim_plan entry
    for (const v of [<SimSlot />, <ReportSimSlot />, <RouteSummaryCard d={NO_ROUTE} />]) {
      act(() => render(null, root as unknown as Element))
      const n = mount(v)
      const slot = all(n, (x) => x.getAttribute('data-slot') === 'sim')
      expect(slot.length).toBe(1)
      await settle(n)
      const a = links(slot[0])
      expect(a.length).toBe(1)
      expect(a[0].getAttribute('href')).toBe(officialMissionUrl())
      expect(a[0].getAttribute('href')).toBe(dataUrl('../sim/official/mission.json', 'real'))
      expect(a[0].getAttribute('download')).toBe('mission.json')
      expect(a[0].getAttribute('data-sim-export')).toBe('ready')
      expect(a[0].getAttribute('data-origin')).toBe('precomputed')
      expect(a[0].textContent).toContain('Download mission.json')
      expect(slot[0].textContent).toContain('mission.json format 1.1.0')
    }
    expect(fetchSpy.mock.calls.map((c) => (c as unknown[])[0])).toContain(officialMissionUrl())
  })

  it('the official plan, file missing (404) → "Simulator file not available for this plan", no link', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    const n = mount(<SimSlot />)
    await settle()
    expect(links(n)).toEqual([])
    const msg = all(n, (x) => x.getAttribute('data-sim-export') === 'missing')
    expect(msg.length).toBe(1)
    expect(msg[0].getAttribute('data-origin')).toBe('precomputed')
    expect(n.textContent).toContain('Simulator file not available for this plan')
  })

  it('while the live layer registers the API copy, that is tried first, the static file after it', async () => {
    const api = 'http://api.test/api/v1/results/0ff1c1a10ff1c1a1/mission.json'
    const apiFetch = vi.fn(async () => new Response(MISSION, { status: 200 }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    const n = mount(<SimSlot />)
    await settle()
    expect(n.textContent).toContain('Simulator file not available for this plan')
    act(() => setOfficialMissionSource({ url: api, fetch: apiFetch }))
    await settle(n, () => links(n)[0]?.getAttribute('data-sim-export') === 'ready')
    expect(links(n)[0].getAttribute('href')).toBe(api)
    expect(apiFetch).toHaveBeenCalled()
    act(() => setOfficialMissionSource(null)) // offline again: the static file
    await settle(n, () => links(n).length === 0 && n.textContent.includes('not available'))
    expect(links(n)).toEqual([])
    expect(n.textContent).toContain('Simulator file not available for this plan')
  })

  it('is format-agnostic: lists exactly the kind/file pairs, ignores malformed entries', () => {
    const m = {
      a: { kind: 'sim_plan', file: 'deep/dir/no-extension' },
      b: { kind: 'sim_plan', file: '' },
      c: { kind: 'sim_plan' },
      d: { kind: 'SIM_PLAN', file: 'x' },
      e: null,
      f: { kind: 'sim_plan', file: 'w.zip' },
    } as unknown as Manifest
    expect(simPlanFiles(m).map((f) => f.file)).toEqual(['deep/dir/no-extension', 'w.zip'])
    expect(simPlanFiles(null)).toEqual([])
  })
})

describe("VITE_SIM_EXPORT=official (D116): the official plan only, static file, no API call", () => {
  beforeEach(() => vi.stubEnv('VITE_SIM_EXPORT', 'official'))

  it('the plan card shows the official mission.json from sim/official/mission.json', async () => {
    const fetchSpy = vi.fn(async () => new Response(MISSION, { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    const n = mount(<RouteSummaryCard d={NO_ROUTE} />)
    await settle()
    const a = links(n)
    expect(a.length).toBe(1)
    expect(a[0].getAttribute('href')).toBe(officialMissionUrl())
    expect(a[0].getAttribute('data-sim-export')).toBe('ready')
    expect(a[0].getAttribute('data-origin')).toBe('precomputed')
    expect(fetchSpy.mock.calls.map((c) => (c as unknown[])[0])).toEqual([officialMissionUrl()])
  })

  it('ignores the API copy the live layer registers, and lists no live result files', async () => {
    const apiFetch = vi.fn(async () => new Response(MISSION, { status: 200 }))
    setOfficialMissionSource({ url: 'http://api.test/api/v1/results/0ff1c1a10ff1c1a1/mission.json', fetch: apiFetch })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(MISSION, { status: 200 })))
    const n = mount(<SimSlot />)
    await settle()
    expect(links(n)[0].getAttribute('href')).toBe(officialMissionUrl())
    expect(apiFetch).not.toHaveBeenCalled()
    expect(mount(<SimSlot manifest={TWO} base="https://example.test/api/v1/results/abc123" />).childNodes).toEqual([])
  })
})

describe('SendToSimulator: self-contained, props in (WP12 Edit-route result box, L3 drawer)', () => {
  const base = 'http://api.test/api/v1/results/0123456789abcdef'
  const LIVE_MANIFEST = { 'sim.nom_104.export': { ...entry('mission.json', 'sim_plan') } } as unknown as Manifest

  it('a live result: checks {base}/mission.json, offers it with the hooks (computed_live, idle)', async () => {
    const f = vi.fn(async () => new Response(MISSION, { status: 200 }))
    const n = mount(<SendToSimulator base={base} manifest={LIVE_MANIFEST} origin="computed_live" mode="all" fetchFor={() => f} />)
    await settle(n)
    const a = links(n)
    expect(a.length).toBe(1)
    expect(a[0].getAttribute('href')).toBe(`${base}/mission.json`)
    expect(a[0].getAttribute('download')).toBe('mission.json')
    expect(a[0].getAttribute('data-origin')).toBe('computed_live')
    expect(a[0].getAttribute('data-state')).toBe('idle')
    expect(a[0].getAttribute('data-sim-export')).toBe('ready')
    expect(n.textContent).toContain('mission.json format 1.1.0')
    expect(f).toHaveBeenCalledWith(`${base}/mission.json`, expect.anything())
  })

  it('404 -> the unavailable state, no link', async () => {
    const n = mount(<SendToSimulator base={base} origin="computed_live" fetchFor={() => async () => new Response('', { status: 404 })} />)
    await settle(n)
    expect(links(n)).toEqual([])
    const msg = all(n, (x) => x.getAttribute('data-state') === 'unavailable')
    expect(msg.length).toBe(1)
    expect(msg[0].getAttribute('data-sim-export')).toBe('missing')
    expect(n.textContent).toContain('Simulator file not available for this plan')
  })

  it("mode 'official' shows nothing for a live result; mode 'off' nothing at all", () => {
    expect(mount(<SendToSimulator base={base} origin="computed_live" mode="official" />).childNodes).toEqual([])
    expect(mount(<SendToSimulator mode="off" />).childNodes).toEqual([])
  })

  it('the official plan without a base: the static sim/official/mission.json', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(MISSION, { status: 200 })))
    const n = mount(<SendToSimulator origin="precomputed" mode="official" />)
    await settle(n)
    expect(links(n)[0].getAttribute('href')).toBe(officialMissionUrl())
    expect(links(n)[0].getAttribute('data-origin')).toBe('precomputed')
  })
})

describe('reads no more of the file than needed (D110)', () => {
  it('the slot reads the format version with a regex; it never JSON.parses the plan', () => {
    const src = readFileSync(resolve(__dirname, 'simslot.tsx'), 'utf8').replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, '')
    expect(src).not.toMatch(/JSON\.parse|\.json\(\)/)
  })
})

// ------------------------------------------------------------ helpers

/** A mission.json body (contracts/bundle/examples/mission.mission_planer.json, as served). */
const MISSION = readFileSync(resolve(__dirname, '../../../../contracts/bundle/examples/mission.mission_planer.json'), 'utf8')

/**
 * Let the official slot load its control (a lazy module), check the file and re-render: until a
 * control in a settled state (ready, missing, failed) is drawn, or `done` holds.
 */
async function settle(n: FakeNode = root, done?: () => boolean) {
  const settled = () => (done ? done() : all(n, (x) => ['ready', 'missing', 'failed'].includes(x.getAttribute('data-sim-export') ?? '')).length > 0)
  for (let i = 0; i < 400 && !settled(); i++) await act(async () => await new Promise((r) => setTimeout(r, 10)))
  await act(async () => await new Promise((r) => setTimeout(r, 0)))
}

/** Route summary card data with no route (the card's "no route" branch; enough to host the slot). */
const NO_ROUTE = {
  stations: [],
  official: { route: null, timeline: null, routeFile: 'route_x.geojson', timelineFile: 'timeline_x.json', routeKey: 'route.x', timelineKey: 'timeline.x' },
} as unknown as CardData

/**
 * Minified size of what a caller of <SimSlot/> ships, with VITE_SIM_EXPORT as given. Everything the
 * app already ships (preact, the manifest store, env, copy, components) is external; only the slot's
 * own code is measured. In-memory build of one tiny module (no output written).
 */
async function bundleOfSlot(flag: string | undefined): Promise<string> {
  const SLOT = resolve(__dirname, 'simslot.tsx')
  const virtual: Plugin = {
    name: 'simslot-entry',
    enforce: 'pre',
    resolveId: (id) => (id.endsWith('virtual:entry') ? '\0entry' : null),
    load: (id) => (id === '\0entry' ? `import { SimSlot } from ${JSON.stringify(SLOT)}\nexport default SimSlot\n` : null),
  }
  const out = await build({
    configFile: false,
    mode: 'production',
    root: resolve(__dirname, '../../..'),
    logLevel: 'silent',
    plugins: [virtual],
    define: { 'import.meta.env.VITE_SIM_EXPORT': flag === undefined ? 'undefined' : JSON.stringify(flag) },
    build: {
      write: false,
      minify: true,
      lib: { entry: 'virtual:entry', formats: ['es'], fileName: 'slot' },
      rollupOptions: { external: (id) => /^preact/.test(id) || /\/(prov\/store|env|copy|components)(\.tsx?)?$/.test(id) },
    },
  })
  const res = Array.isArray(out) ? out[0] : out
  const chunk = (res as { output: { type: string; code?: string }[] }).output.find((o) => o.type === 'chunk')
  return chunk?.code ?? ''
}
