// PORT W0a: in-memory pad service for unit tests (no fetch, no PNG decoding). Fields are tiny fake
// grids cast to the real types: tests that need real field values use the real loader instead.
import type { FieldGrid } from '../hud/fields'
import { signal } from '../state/signal'
import { OFFICIAL_PAD_ID, type PadEnv, type PadId, type PadInfo, type PadLoadState, type PadService, type PlanProducts } from './types'

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] }

export function mockPadInfo(id: PadId, rank: number, lon: number, lat: number): PadInfo {
  const official = id === OFFICIAL_PAD_ID
  const dir = official ? 'scenarios' : `scenarios/pads/${id}`
  return {
    id,
    sourceId: official ? 'rank1' : id,
    label: official ? 'Official pad' : `P${rank}`,
    lon,
    lat,
    elevM: null,
    rank,
    official,
    hasRoutingFields: true,
    files: {
      fields: official ? { tHome: 'nom_104/t_home', o2Home: 'nom_104/o2_home', pointer: 'nom_104/pointer' } : { tHome: `pads/${id}/nom_104/t_home`, o2Home: `pads/${id}/nom_104/o2_home`, pointer: `pads/${id}/nom_104/pointer` },
      summary: official ? null : `${dir}/summary.json`,
      bands: `${dir}/bands_104.geojson`,
      edges: official ? 'scenarios/nom_104/edges.geojson' : `${dir}/edges.geojson`,
      partner: null,
      route: official ? 'route_nom_104.geojson' : `${dir}/route_nom_104.geojson`,
      timeline: official ? 'timeline_nom_104.json' : `${dir}/timeline_nom_104.json`,
    },
  }
}

/** Official pad + P2–P4 at their real positions (scenarios/pads/index.json). */
export const MOCK_PADS: readonly PadInfo[] = [
  mockPadInfo(OFFICIAL_PAD_ID, 1, 137.401783, -4.77748),
  mockPadInfo('rank2', 2, 137.393301, -4.776468),
  mockPadInfo('rank3', 3, 137.393301, -4.776114),
  mockPadInfo('rank4', 4, 137.387206, -4.781529),
]

export interface MockPadServiceOptions {
  pads?: readonly PadInfo[]
  /** ms before a load resolves (default 0) */
  delayMs?: number
  /** pad ids whose load rejects */
  failing?: readonly PadId[]
  products?: (id: PadId) => PlanProducts
}

export function mockPadEnv(info: PadInfo, products?: (id: PadId) => PlanProducts): PadEnv {
  const grid = { width: 1, height: 1 } as unknown as FieldGrid
  return {
    info,
    routingFields: { padId: info.id, scenario: 'nom_104', pad: { lon: info.lon, lat: info.lat, elevM: info.elevM }, tHome: grid, o2Home: null, pointer: null },
    planProducts: () => Promise.resolve(products?.(info.id) ?? { bands: EMPTY_FC, edges: EMPTY_FC, partner: null, route: null, timeline: null }),
    summary: null,
  }
}

export function createMockPadService(o: MockPadServiceOptions = {}): PadService & { calls: PadId[] } {
  const pads = o.pads ?? MOCK_PADS
  const cache = new Map<PadId, PadEnv>()
  const loadState = signal<Readonly<Record<PadId, PadLoadState>>>({})
  const calls: PadId[] = []
  const set = (id: PadId, s: PadLoadState) => (loadState.value = { ...loadState.peek(), [id]: s })
  const svc: PadService & { calls: PadId[] } = {
    calls,
    loadPadIndex: () => Promise.resolve([...pads]),
    listPads: () => [...pads],
    peekPadEnv: (id) => cache.get(id),
    prefetchPads: (ids) => ids.forEach((id) => void svc.loadPadEnv(id, { prefetch: true }).catch(() => {})),
    loadState,
    async loadPadEnv(id) {
      calls.push(id)
      const hit = cache.get(id)
      if (hit) return hit
      const info = pads.find((p) => p.id === id)
      set(id, { state: 'loading', since: 0 })
      if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs))
      if (!info || o.failing?.includes(id)) {
        const error = new Error(`mock: no pad ${id}`)
        set(id, { state: 'error', error })
        throw error
      }
      const env = mockPadEnv(info, o.products)
      cache.set(id, env)
      set(id, { state: 'ready', env })
      return env
    },
  }
  return svc
}
