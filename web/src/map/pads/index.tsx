// PORT P2: pad layer on the Plan map (interfaces.md §3 registerPadEnvironment, §5 slot 'pad-layer').
// I1 wires it with one call in views/console.tsx: `import { install as installPads } from '../map/pads'`
// then `installPads()` once (returns dispose). Nothing happens until then.
//   - registerPadEnvironment: pad markers + labels, env swap (field, bands, edges, partner, official route) with fade
//   - registerPlanSlot('pad-layer'): planning.padId -> cmap.setPadEnvironment, the pad pop-up card, "Loading pad P3…"
import { registerPadEnvironment } from '../extensions'
import { registerPlanSlot } from '../../views/planPortSlots'
import { createPadEnvironmentHandler, type PadLayerOptions } from './padLayer'
import { PadLayerSlot } from './PadCard'

export { createPadEnvironmentHandler, openPadCard, padLayer, PAD_CARD_ID, type PadShown } from './padLayer'
export { PadCard, PadCardBody, PadLayerSlot, PadStatus, useCardNumbers } from './PadCard'
export { syncPadEnvironment } from './sync'
export { createEnvSwap, padSourceData } from './swap'
export { officialCardNumbers, padCardNumbers } from './numbers'

export function install(opts: PadLayerOptions = {}): () => void {
  const offEnv = registerPadEnvironment(createPadEnvironmentHandler(opts))
  const offSlot = registerPlanSlot('pad-layer', ({ cmap }) => <PadLayerSlot cmap={cmap} />)
  return () => {
    offSlot()
    offEnv()
  }
}
