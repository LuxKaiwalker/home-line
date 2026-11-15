// PORT P2: planning padId -> the pad environment on the map. "Plan from here" (pad card) and the Route
// panel's pad picker only call planning.setPad(id); this follows the store: the official pad = null (the
// official plan as ConsoleMap loads it), any other pad = pads/ loadPadEnv(id) (cached: at once; else the
// marker shows its loading state and the map keeps the previous plan until the env arrives). Never blocks.
import { loadPadEnv, peekPadEnv } from '../../pads'
import { OFFICIAL_PAD_ID, type PadEnv, type PadId } from '../../pads/types'
import { planning, selectPad, subscribePlanning, type PlanningStore } from '../../state/planning'
import { padLayer } from './padLayer'

export interface PadEnvTarget {
  setPadEnvironment(env: PadEnv | null): void
}

export function syncPadEnvironment(target: PadEnvTarget, store: PlanningStore = planning): () => void {
  let want: PadId = ''
  let alive = true
  const go = (id: PadId) => {
    if (id === want) return
    want = id
    if (id === OFFICIAL_PAD_ID) return target.setPadEnvironment(null)
    const hit = peekPadEnv(id)
    if (hit) return target.setPadEnvironment(hit)
    padLayer.shown.value = { id, status: 'loading' } // skeleton state at once, before any fetch
    loadPadEnv(id).then(
      (env) => alive && want === id && target.setPadEnvironment(env),
      (e) => {
        if (!alive || want !== id) return
        console.warn(`pad ${id} could not be loaded; the map keeps the previous plan:`, e)
        padLayer.shown.value = { id, status: 'error' }
      },
    )
  }
  go(selectPad(store.state.peek()))
  const off = subscribePlanning(selectPad, go, store)
  return () => {
    alive = false
    off()
  }
}
