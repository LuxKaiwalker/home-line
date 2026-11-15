// Mount the pad tool (F24) and the crew panel (F26) into one panel element (the live slot), driven
// by the map through a MapPort. Lazy like the rest of src/live (loaded only behind VITE_LIVE). The
// one-line wiring in the console view is WS5/C's:
//   m.mountPadTool(panelSlot, m.consoleMapPort(cmap, restoreStaticScenario))
// L3 / L3c (D111): with the Edit-route drawer mounted, the crew panel and the pad tool render into it
// instead (setEditRouteCrew / setEditRoutePad, collapsed "Crew" and "Custom pad" sections).
import { render } from 'preact'
import type { ApiClient } from './client'
import { createCrew, type CrewModel } from './crew'
import { CrewPanel, crewBlockedText } from './crewview'
import type { MapPort } from './mapPort'
import { createPadTool, type PadTool, type PadToolOptions } from './padtool'
import type { LiveState } from './health'
import { PadToolPanel, type RouteLinkView } from './view'
import { editRouteHosted, setEditRouteCrew, setEditRoutePad } from '../ui/shell/editroute'
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
  // L3 (D111): with the Edit-route drawer mounted (console map, live build, route editing on), the crew
  // panel goes into it as the "Crew" section; otherwise it stays next to the pad tool, as before
  const hosted = editRouteHosted()
  const inDrawer = crew !== null && hosted
  // L3c: the pad tool goes into the same drawer as the collapsed "Custom pad" section; otherwise it
  // stays in the panel element, as before (mount only: same panel, same props)
  const padInDrawer = hosted
  const draw = () => {
    if (!ready) return
    if (inDrawer) {
      const state = crew.state
      const inputs = crew.jobInputs() // {} = default crew; {crew} = changed fields; null = a field is not a number
      setEditRouteCrew({ summary: inputs && inputs.crew === undefined ? 'default' : 'changed', render: () => <CrewPanel state={state} actions={crew} engineHref={engineHref} /> })
    }
    const padPanel = (
      <PadToolPanel
        state={tool.state}
        actions={tool}
        engineHref={engineHref}
        computeBlocked={crew ? crewBlockedText(crew.state) : null}
        route={route ? { status: route.status(), compute: () => route.compute() } : undefined}
      />
    )
    if (padInDrawer) setEditRoutePad(() => padPanel)
    render(
      <>
        {crew && !inDrawer ? <CrewPanel state={crew.state} actions={crew} engineHref={engineHref} /> : null}
        {padInDrawer ? null : padPanel}
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
      if (inDrawer) setEditRouteCrew(undefined)
      if (padInDrawer) setEditRoutePad(undefined)
      render(null, panel)
    },
  }
}
