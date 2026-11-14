// Mount the pad tool (F24) into a panel element, driven by the map through a MapPort. Lazy like the
// rest of src/live (loaded only behind VITE_LIVE). The one-line wiring in the console view is WS5/C's:
//   m.mountPadTool(panelSlot, m.consoleMapPort(cmap, restoreStaticScenario))
import { render } from 'preact'
import type { ApiClient } from './client'
import type { MapPort } from './mapPort'
import { createPadTool, type PadTool, type PadToolOptions } from './padtool'
import type { LiveState } from './health'
import { PadToolPanel } from './view'

export interface MountPadToolOptions extends Omit<PadToolOptions, 'client' | 'port'> {
  client: ApiClient
  /** Live state source (index.ts onLiveState: U1's health watch). */
  onLiveState: (fn: (s: LiveState) => void) => () => void
}

/** Renders the panel into `panel` on every state change; returns cleanup. */
export function mountPadTool(panel: Element, port: MapPort, opts: MountPadToolOptions): { tool: PadTool; cleanup: () => void } {
  const { client, onLiveState, ...rest } = opts
  const tool = createPadTool({ client, port, ...rest })
  const engineHref = `${client.root}/engine/version`
  const offState = tool.subscribe((state) => render(<PadToolPanel state={state} actions={tool} engineHref={engineHref} />, panel))
  const offLive = onLiveState((s) => tool.setLive(s))
  const offClick = port.onClick((p) => tool.click(p))
  return {
    tool,
    cleanup() {
      offClick()
      offLive()
      offState()
      tool.dispose()
      render(null, panel)
    },
  }
}
