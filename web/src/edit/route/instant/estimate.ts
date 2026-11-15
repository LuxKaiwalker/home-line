// I1b (D128, instant browser path): every route edit recomputes the whole route IN THE BROWSER (I1a's
// core through adapter.ts) on the next animation frame: one compute per frame however many edits
// land in it, no server call, nothing from src/live (works with the API down). The user's order is
// passed as is (waypoint rule 2: never reordered). "Send to simulator" builds mission.json from the
// shown estimate and downloads it at once (Blob, ui/cards/simslot.tsx saveMissionText).
import { effect, signal, type ReadSignal } from '../../../state/signal'
import { saveMissionText } from '../../../ui/cards/simslot'
import type { PlanRoute, RouteStop } from '../model'
import type { RouteStore } from '../store'
import { browserCore, padFields } from './adapter'
import { ESTIMATE_LABEL, type EstimateCore, type EstimateResult } from './types'

export type EstimateState =
  | { kind: 'off'; why: 'auto' | 'empty' }
  | { kind: 'loading' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'ready'; result: EstimateResult; ms: number; stops: readonly RouteStop[]; key: string }

export interface RouteEstimateOptions {
  store: Pick<RouteStore, 'route' | 'step' | 'catalog'>
  /** pad lon/lat of the plan the route is edited on */
  pad: () => { lon: number; lat: number }
  core?: EstimateCore
  /** frame scheduler (default requestAnimationFrame; tests pass a manual one) */
  raf?: (fn: () => void) => unknown
  now?: () => number
  /** the download (default saveMissionText) */
  save?: (text: string, name: string) => void
}

export const ESTIMATE_TEXT = {
  unavailablePad: 'The instant estimate runs on the official rover pad only (for now).',
  unavailableCore: 'Instant estimate unavailable: {why}',
}

const defaultRaf = (fn: () => void): unknown => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => fn()) : setTimeout(fn, 16))
const defaultNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** FNV-1a 32 bit as 8 hex characters (file name only; the content hash is mission_id). */
export function hash8(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** The pad id of the plan in use (a custom spot from the pad tool has none). */
function padIdOf(store: RouteEstimateOptions['store']): string | null {
  const p = store.step.peek().plan.pad
  return typeof p === 'string' ? p : null
}

export function createRouteEstimate(o: RouteEstimateOptions) {
  const core = o.core ?? browserCore
  const raf = o.raf ?? defaultRaf
  const now = o.now ?? defaultNow
  const state = signal<EstimateState>({ kind: 'off', why: 'empty' })
  /** computes run so far (tests: once per frame) */
  const runs = signal(0)
  const loaded = new Map<string, Promise<unknown>>()
  const data = new Map<string, unknown>()
  const failed = new Map<string, string>()
  let pending = false
  let alive = true

  function schedule(): void {
    if (pending || !alive) return
    pending = true
    raf(() => {
      pending = false
      if (alive) run()
    })
  }

  function run(): void {
    const route: PlanRoute = o.store.route.peek()
    if (route.mode !== 'ordered') return void (state.value = { kind: 'off', why: 'auto' })
    if (!route.stops.length) return void (state.value = { kind: 'off', why: 'empty' })
    const fields = padFields(padIdOf(o.store), o.store.catalog.officialPadId)
    if (!fields) return void (state.value = { kind: 'unavailable', reason: ESTIMATE_TEXT.unavailablePad })
    const why = failed.get(fields)
    if (why) return void (state.value = { kind: 'unavailable', reason: ESTIMATE_TEXT.unavailableCore.replace('{why}', why) })
    if (!data.has(fields)) {
      if (state.peek().kind !== 'ready') state.value = { kind: 'loading' }
      if (!loaded.has(fields))
        loaded.set(
          fields,
          core.load(fields).then(
            (d) => {
              data.set(fields, d)
              schedule()
            },
            (e) => {
              failed.set(fields, e instanceof Error ? e.message : String(e))
              schedule()
            },
          ),
        )
      return
    }
    const stops = route.stops.slice()
    const pad = o.pad()
    const t0 = now()
    try {
      const result = core.compute(data.get(fields), pad, stops)
      runs.value = runs.peek() + 1
      state.value = { kind: 'ready', result, ms: now() - t0, stops, key: JSON.stringify([pad, stops]) }
    } catch (e) {
      state.value = { kind: 'unavailable', reason: ESTIMATE_TEXT.unavailableCore.replace('{why}', e instanceof Error ? e.message : String(e)) }
    }
  }

  // every edit (route, pad, plan): one compute on the next frame
  const off = effect(() => {
    void o.store.route.value
    void o.store.step.value
    schedule()
  })

  /** Send to simulator: mission.json of the shown estimate, downloaded at once. False = nothing to send. */
  async function exportMission(): Promise<{ name: string; doc: Record<string, unknown> } | null> {
    const s = state.peek()
    if (s.kind !== 'ready' || !s.stops.length) return null
    const fields = padFields(padIdOf(o.store), o.store.catalog.officialPadId)
    const doc = await core.mission(s.result, { data: fields ? data.get(fields) : null, pad: o.pad(), padId: padIdOf(o.store), stops: s.stops })
    const text = JSON.stringify(doc, null, 1)
    const id = typeof doc.mission_id === 'string' ? doc.mission_id.replace(/^m-/, '').slice(0, 8) : ''
    const name = `homeline-mission-${/^[0-9a-f]{8}$/.test(id) ? id : hash8(s.key)}.json`
    ;(o.save ?? saveMissionText)(text, name)
    return { name, doc }
  }

  return {
    state: state as ReadSignal<EstimateState>,
    runs: runs as ReadSignal<number>,
    label: ESTIMATE_LABEL,
    /** recompute on the next frame (pad tool, plan changes outside the store) */
    schedule,
    exportMission,
    dispose(): void {
      alive = false
      off()
    },
  }
}

export type RouteEstimate = ReturnType<typeof createRouteEstimate>
