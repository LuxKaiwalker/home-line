// PORT U4: where the export goes, from marvis/bridge.ts's own detection (never forked).
//   'api'      the page is served by MARVIS on the loopback address (bridge detect() = true):
//              POST the mission (sendMission); MARVIS hides the planner and starts the EVA, back to its menu.
//   'viewer'   the page runs in MARVIS's planner window (bridge inMarvisViewer()): the downloaded
//              mission.json is caught by the window and loaded into the game.
//   'download' anywhere else (the published site): the same button saves mission.json.
// The panel never waits: the target is 'download' (or 'viewer', known at once) until the probe answers.
import { detect as bridgeDetect, inMarvisViewer, sendMission as bridgeSend } from '../../../marvis/bridge'
import { signal, type ReadSignal } from '../../../state/signal'

export type ExportTarget = 'api' | 'viewer' | 'download'

export interface MarvisDeps {
  detect: () => Promise<boolean>
  inViewer: () => boolean
  send: (doc: unknown) => Promise<{ ok: boolean; error?: string }>
}

export const BRIDGE: MarvisDeps = { detect: bridgeDetect, inViewer: inMarvisViewer, send: bridgeSend }

export interface MarvisTarget {
  target: ReadSignal<ExportTarget>
  /** true once the probe answered (or gave up) */
  settled: ReadSignal<boolean>
  dispose(): void
}

/**
 * The export target, live. Starts at once ('viewer' or 'download'); upgrades to 'api' when the bridge's
 * probe says MARVIS serves the page. The bridge caches its answer, so many panels cost one request.
 * `timeoutMs`: after that the target is final for display ("settled"); a late yes still upgrades.
 */
export function createMarvisTarget(deps: MarvisDeps = BRIDGE, timeoutMs = 1500): MarvisTarget {
  const target = signal<ExportTarget>(deps.inViewer() ? 'viewer' : 'download')
  const settled = signal(false)
  let alive = true
  const timer = setTimeout(() => alive && (settled.value = true), timeoutMs)
  let probe: Promise<boolean>
  try {
    probe = deps.detect()
  } catch {
    probe = Promise.resolve(false)
  }
  void probe
    .catch(() => false)
    .then((yes) => {
      if (!alive) return
      if (yes) target.value = 'api'
      settled.value = true
      clearTimeout(timer)
    })
  return {
    target,
    settled,
    dispose() {
      alive = false
      clearTimeout(timer)
    },
  }
}
