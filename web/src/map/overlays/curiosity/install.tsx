// L1b: registration of the Curiosity layer on the Plan map (ConsoleMap extensions) and its row in the
// layer popover. Off by default (defaultOn false: no request until the user turns it on); `enabled` is
// the feature flag (store.ts setCuriosityEnabled). Idempotent: index.ts calls it at import, I1 may too.
import { registerMapControl, registerOverlay, type Dispose } from '../../extensions'
import { CuriosityControl } from './Control'
import { installCuriosityLayer } from './layer'
import { CURIOSITY_ID, curiosityEnabled } from './store'

/** layer popover position (after L1a's slope) */
export const CURIOSITY_CONTROL_ORDER = 20

let installed: Dispose | null = null

export function install(): Dispose {
  if (installed) return installed
  const offs = [
    registerOverlay({ id: CURIOSITY_ID, titleKey: 'route.layers.curiosity.title', defaultOn: false, enabled: () => curiosityEnabled.peek(), install: installCuriosityLayer }),
    registerMapControl({ id: CURIOSITY_ID, slot: 'layers-popover', order: CURIOSITY_CONTROL_ORDER, render: () => <CuriosityControl /> }),
  ]
  const off: Dispose = () => {
    for (const o of offs) o()
    if (installed === off) installed = null
  }
  installed = off
  return off
}
