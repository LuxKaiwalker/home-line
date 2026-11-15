// Mount the pad tool (F24) and the crew panel (F26) into one panel element (the live slot), driven
// by the map through a MapPort. Lazy like the rest of src/live (loaded only behind VITE_LIVE). The
// one-line wiring in the console view is WS5/C's:
//   m.mountPadTool(panelSlot, m.consoleMapPort(cmap, restoreStaticScenario))
import { render } from 'preact'
import type { ApiClient } from './client'
import { createCrew, type CrewModel } from './crew'
import { CrewPanel, crewBlockedText } from './crewview'
import type { MapPort } from './mapPort'
import { createPadTool, type PadTool, type PadToolOptions } from './padtool'
import type { LiveState } from './health'
import { PadToolPanel, type RouteLinkView } from './view'
import { officialPart } from '../state/official'

/** WP12 (L6 W-1): the Edit-route panel as the card sees it (index.ts bridges it to the route mount). */
export interface RouteLink {
  compute(): void
  status(): RouteLinkView['status']
  subscribe(fn: () => void): () => void
}

export interface MountPadToolOptions extends Omit<PadToolOptions, 'client' | 'port' | 'jobInputs'> {
  client: ApiClient
  /** Live state source (index.ts onLiveState: U1's health watch). */
  onLiveState: (fn: (s: LiveState) => void) => () => void
  /** Show the crew panel next to the pad tool (default true); its changed fields go with the full plan. */
  crew?: boolean
  /** WP12: the Edit-route panel: the card's one button runs its compute (no job of the card's own) */
  route?: RouteLink | null
}

/** Renders the crew panel and the pad tool into `panel` on every state change; returns cleanup. */
export function mountPadTool(panel: Element, port: MapPort, opts: MountPadToolOptions): { tool: PadTool; crew: CrewModel | null; cleanup: () => void } {
  const { client, onLiveState, crew: withCrew = true, route = null, ...rest } = opts
  const crew = withCrew ? createCrew({ client }) : null
  const tool = createPadTool({ client, port, ...rest, ...(crew ? { jobInputs: () => crew.jobInputs() } : {}) })
  const engineHref = `${client.root}/engine/version`
  let ready = false
  const draw = () => {
    if (!ready) return
    render(
      <>
        {crew ? <CrewPanel state={crew.state} actions={crew} engineHref={engineHref} /> : null}
        <PadToolPanel
          state={tool.state}
          actions={tool}
          engineHref={engineHref}
          computeBlocked={crew ? crewBlockedText(crew.state) : null}
          route={route ? { status: route.status(), compute: () => route.compute() } : undefined}
        />
      </>,
      panel,
    )
  }
  const offState = tool.subscribe(draw)
  // design's "Official plan" action (L7b, D111 T9): a clicked pad or a live result differs from it
  const op = officialPart('live-pad', () => tool.clear())
  const offOp = tool.subscribe((s) => op.set(s.pad !== null || s.plan.kind !== 'idle'))
  const offCrew = crew ? crew.subscribe(draw) : () => {}
  const offRoute = route ? route.subscribe(draw) : () => {}
  ready = true
  draw()
  const offLive = onLiveState((s) => {
    crew?.setLive(s)
    tool.setLive(s)
  })
  const offClick = port.onClick((p) => tool.click(p))
  return {
    tool,
    crew,
    cleanup() {
      offClick()
      offLive()
      offState()
      offOp()
      op.dispose()
      offCrew()
      offRoute()
      tool.dispose()
      crew?.dispose()
      render(null, panel)
    },
  }
}
