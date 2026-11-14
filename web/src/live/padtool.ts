// Pad tool (F24, WS13 task 2 of the brief): click the map -> POST /pads/validate; an invalid pad
// shows its reason and the nearest valid block; a valid pad gets the instant preview from
// POST /pads/screen; "Compute full plan" submits a plan job (jobs.ts) and draws each finished stage
// on the map through the contract-checking loader (stage.ts) and the console map's own setters.
// UI-free: the view (view.tsx) renders PadToolState; tests drive this with the mock fetch.
import type { ApiClient } from './client'
import { ApiError } from './client'
import { BACKEND_CONTRACT_VERSION } from './config'
import { bannerFor, type LiveState } from './health'
import { startJob, type JobHandle, type JobOptions } from './jobs'
import type { MapPort } from './mapPort'
import { loadStage, type LoaderFor, type StageResult } from './stage'
import type { Job, LonLat, PadCheck, PadScreen, PlanInputs } from './types'
import type { BandsFC, EdgesFC, IsochroneFC, PartnerFC } from '../data/types'

export type CheckState = { kind: 'idle' } | { kind: 'checking' } | { kind: 'done'; result: PadCheck } | { kind: 'error'; message: string }
export type PreviewState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; screen: PadScreen } | { kind: 'error'; message: string }
export type PlanState =
  | { kind: 'idle' }
  | { kind: 'running'; job: Job | null; result: StageResult | null }
  | { kind: 'done'; job: Job; result: StageResult | null }
  | { kind: 'failed'; job: Job | null; error: string; retryAfterS: number | null; result: StageResult | null }
  | { kind: 'cancelled'; job: Job | null; result: StageResult | null }

export interface PadToolState {
  live: LiveState
  pad: LonLat | null
  check: CheckState
  preview: PreviewState
  plan: PlanState
}

export interface PadToolActions {
  click(p: LonLat): void
  useNearest(): void
  computePlan(): void
  cancelPlan(): void
  clear(): void
}

export interface PadTool extends PadToolActions {
  readonly state: PadToolState
  setLive(s: LiveState): void
  subscribe(fn: (s: PadToolState) => void): () => void
  dispose(): void
}

export interface PadToolOptions {
  client: ApiClient
  port: MapPort
  /** Plan inputs other than the pad (crew, EVA ...); default: only contract_version, the server fills defaults. */
  inputs?: PlanInputs
  /** Default liveLoader (the one rendering path); the dev mock passes a loader over the mock fetch. */
  loaderFor?: LoaderFor
  /** Poll timing overrides (tests). */
  job?: Pick<JobOptions, 'pollInitialMs' | 'pollFactor' | 'pollMaxMs'>
}

const emptyFc = <T>() => ({ type: 'FeatureCollection', features: [] }) as unknown as T

function message(e: unknown): string {
  if (e instanceof ApiError) return e.code === 'timeout' || e.code === 'network' ? `no answer from the live API (${e.code})` : `${e.code} (HTTP ${e.status})`
  return e instanceof Error ? e.message : String(e)
}

export function planInputsFor(pad: LonLat, base: PlanInputs = {}): PlanInputs {
  const { title: _t, ...rest } = base as { title?: unknown }
  void _t
  return { contract_version: BACKEND_CONTRACT_VERSION, ...rest, pad: { lon: pad.lon, lat: pad.lat } }
}

export function createPadTool(opts: PadToolOptions): PadTool {
  const { client, port } = opts
  let state: PadToolState = { live: { kind: 'checking' }, pad: null, check: { kind: 'idle' }, preview: { kind: 'idle' }, plan: { kind: 'idle' } }
  const subs = new Set<(s: PadToolState) => void>()
  let seq = 0 // the click a pending answer belongs to; stale answers are dropped
  let req: AbortController | null = null
  let job: JobHandle | null = null
  let drawn = false

  const set = (patch: Partial<PadToolState>) => {
    state = { ...state, ...patch }
    for (const fn of subs) fn(state)
  }
  const controls = () => bannerFor(state.live).controls

  function stopJob() {
    job?.cancel()
    job = null
  }
  function resetMap() {
    if (drawn) port.restoreStatic()
    else port.setLivePad(null)
    drawn = false
  }

  async function check(pad: LonLat) {
    const my = ++seq
    req?.abort()
    stopJob()
    const ctl = (req = new AbortController())
    if (drawn) resetMap()
    port.setLivePad({ ...pad, valid: null })
    set({ pad, check: { kind: 'checking' }, preview: { kind: 'idle' }, plan: { kind: 'idle' } })
    let result: PadCheck
    try {
      result = await client.validatePad(pad, { signal: ctl.signal })
    } catch (e) {
      if (my === seq) set({ check: { kind: 'error', message: message(e) } })
      return
    }
    if (my !== seq) return
    port.setLivePad({ ...pad, valid: result.valid })
    set({ check: { kind: 'done', result } })
    if (!result.valid) return // F24: an invalid pad never produces a preview or a plan
    set({ preview: { kind: 'loading' } })
    try {
      const screen = await client.screenPad(planInputsFor(pad, opts.inputs), { signal: ctl.signal })
      if (my === seq) set({ preview: { kind: 'done', screen } })
    } catch (e) {
      if (my === seq) set({ preview: { kind: 'error', message: message(e) } })
    }
  }

  async function draw(r: StageResult) {
    if (r.bands || r.isochrones || r.edges || r.partner) {
      await port.setScenarioData({
        bands: r.bands ?? emptyFc<BandsFC>(),
        isochrones: r.isochrones ?? emptyFc<IsochroneFC>(),
        edges: r.edges ?? emptyFc<EdgesFC>(),
        partner: r.partner ?? emptyFc<PartnerFC>(),
        variant: r.scenario?.variant ?? 'nominal',
      })
      drawn = true
    }
    if (r.route) {
      await port.setRoute(r.route)
      drawn = true
    }
  }

  function computePlan() {
    const pad = state.pad
    const ok = state.check.kind === 'done' && state.check.result.valid
    if (!pad || !ok || !controls() || !bannerFor(state.live).heavyJobs) return
    if (state.plan.kind === 'running') return
    const my = seq
    let latest: StageResult | null = null
    // Stage snapshots are read in order; a slow read never overwrites a newer one.
    let chain = Promise.resolve()
    const planPatch = (p: Partial<{ job: Job | null; result: StageResult | null }>) => {
      if (my !== seq || state.plan.kind !== 'running') return
      set({ plan: { ...state.plan, ...p } })
    }
    set({ plan: { kind: 'running', job: null, result: null } })
    job = startJob(
      client,
      { type: 'plan', inputs: planInputsFor(pad, opts.inputs) },
      {
        ...opts.job,
        onUpdate: (j) => planPatch({ job: j }),
        onStage: (_stage, j, base) => {
          const stages = [...j.stages_done]
          chain = chain.then(async () => {
            if (my !== seq) return
            const r = await loadStage(base, stages, opts.loaderFor)
            if (my !== seq) return
            latest = r
            await draw(r)
            planPatch({ result: r })
          })
        },
      },
    )
    void job.promise.then(async (out) => {
      await chain
      if (my !== seq) return
      job = null
      if (out.status === 'done') {
        // The done state may list no new stage; read the final tree once more.
        const r = latest && latest.stages.length === out.job.stages_done.length ? latest : await loadStage(out.resultBase, out.job.stages_done, opts.loaderFor)
        if (my !== seq) return
        await draw(r)
        set({ plan: { kind: 'done', job: out.job, result: r } })
      } else if (out.status === 'failed') set({ plan: { kind: 'failed', job: out.job, error: out.error, retryAfterS: out.retryAfterS, result: latest } })
      else set({ plan: { kind: 'cancelled', job: out.job, result: latest } })
    })
  }

  return {
    get state() {
      return state
    },
    setLive(s) {
      set({ live: s })
      if (!bannerFor(s).controls) {
        // Offline or warming: controls hide behind the banner; drop pending work and the live layers.
        seq++
        req?.abort()
        stopJob()
        if (state.pad) resetMap()
        set({ pad: null, check: { kind: 'idle' }, preview: { kind: 'idle' }, plan: { kind: 'idle' } })
      }
    },
    subscribe(fn) {
      subs.add(fn)
      fn(state)
      return () => subs.delete(fn)
    },
    click(p) {
      if (!controls()) return
      void check(p)
    },
    useNearest() {
      const n = state.check.kind === 'done' ? state.check.result.nearest_valid : null
      if (n && controls()) void check({ lon: n.lon, lat: n.lat })
    },
    computePlan,
    cancelPlan() {
      job?.cancel()
    },
    clear() {
      seq++
      req?.abort()
      stopJob()
      resetMap()
      set({ pad: null, check: { kind: 'idle' }, preview: { kind: 'idle' }, plan: { kind: 'idle' } })
    },
    dispose() {
      seq++
      req?.abort()
      stopJob()
      if (state.pad) resetMap()
      subs.clear()
    },
  }
}
