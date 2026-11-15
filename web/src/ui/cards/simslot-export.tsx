// "Send to simulator" as one self-contained component (D110, D116, SIM-1): props in, it finds the
// plan's mission.json, checks it, and offers the fetch -> Blob download with the harness hooks
// (data-sim-export, data-origin, data-state). No assumption about where it is mounted: the console's
// official slot (ui/cards/simslot.tsx, lazily), the Edit-route panel's result box (WP12), the
// drawer (L3). Not imported by the static app unless VITE_SIM_EXPORT is set, so a flag-off build
// stays byte-identical. Callers gate it on their mode (live/config.ts SIM_EXPORT_MODE or
// simExportMode() here); with mode 'off' it renders nothing.
//
// One-line mount for a live result (e.g. edit/route/panel.tsx result box):
//   <SendToSimulator base={client.resultBase({ hash, result_url: null })} manifest={tree.manifest} origin="computed_live" mode={simExportMode()} />
import { Component, render } from 'preact'
import type { Manifest } from '../../data/types'
import { t } from '../copy'
import {
  MISSION_TEXT,
  MissionControl,
  missionTargetFor,
  officialMissionSource,
  officialMissionUrls,
  probeMission,
  type MissionFetchFor,
  type MissionOrigin,
  type MissionProbe,
  type OfficialMissionSource,
} from './simslot'

export interface SendToSimulatorProps {
  /** Result tree root, e.g. {API}/api/v1/results/{hash} (client.resultBase). Omit for the official plan's static file. */
  base?: string
  /** The result's manifest (its sim_plan entry names the file); null/omitted: {base}/mission.json. */
  manifest?: Manifest | null
  /** computed_live (a live result) or precomputed (the official plan). Default computed_live with a base, else precomputed. */
  origin?: MissionOrigin
  /** VITE_SIM_EXPORT mode: 'official' = the official plan only, static file; 'all'; 'off' = nothing. Default all. */
  mode?: 'off' | 'official' | 'all'
  /** Per-URL fetch (default the global fetch). */
  fetchFor?: MissionFetchFor
  /** Heading and origin line around the control (default true); false: the control alone. */
  framed?: boolean
}

interface State {
  src: OfficialMissionSource | null
  probe: MissionProbe
}

/** The checked mission.json control for one plan. */
export class SendToSimulator extends Component<SendToSimulatorProps, State> {
  state: State = { src: null, probe: { state: 'checking' } }
  private ac: AbortController | null = null
  private key = ''
  private sub: ReturnType<typeof officialMissionSource> | null = null

  private origin(): MissionOrigin {
    return this.props.origin ?? (this.props.base ? 'computed_live' : 'precomputed')
  }

  /** Candidate URLs, best first; [] = nothing to offer in this mode. */
  urls(): string[] {
    const { mode = 'all', base, manifest } = this.props
    if (mode === 'off') return []
    const origin = this.origin()
    // the official plan without a result base: the console's tree (API copy first in mode all)
    if (origin === 'precomputed' && !base) return mode === 'all' ? officialMissionUrls(this.state.src) : officialMissionUrls(null).slice(-1)
    return missionTargetFor(manifest ?? null, base ?? '', origin, mode)?.urls ?? []
  }

  componentDidMount() {
    if ((this.props.mode ?? 'all') === 'all' && this.origin() === 'precomputed' && !this.props.base) {
      this.sub = officialMissionSource((src) => this.setState({ src }))
      if (this.sub.now) return this.setState({ src: this.sub.now })
    }
    this.check()
  }
  componentDidUpdate() {
    this.check()
  }
  componentWillUnmount() {
    this.sub?.off()
    this.ac?.abort()
  }

  private fetchFor(): MissionFetchFor {
    const src = this.state.src
    const own = this.props.fetchFor
    return (u) => (src && u === src.url && src.fetch) || own?.(u) || fetch
  }

  private check() {
    const urls = this.urls()
    if (urls.join('\n') === this.key) return
    this.key = urls.join('\n')
    this.ac?.abort()
    if (!urls.length) return
    const ac = (this.ac = new AbortController())
    if (this.state.probe.state !== 'checking') this.setState({ probe: { state: 'checking' } })
    probeMission(urls, this.fetchFor(), ac.signal).then(
      (probe) => !ac.signal.aborted && this.setState({ probe }),
      () => {},
    )
  }

  render() {
    const urls = this.urls()
    if (!urls.length) return null
    const { probe } = this.state
    const origin = this.origin()
    const control = <MissionControl probe={probe} href={probe.state === 'ok' ? probe.url : urls[0]} origin={origin} fetchFor={this.fetchFor()} />
    if (this.props.framed === false) return control
    return (
      <section class="hl-simslot" data-slot="sim" aria-label={t('simulator.sendSlot')}>
        <h4 class="hl-cardx__h">{t('simulator.sendSlot')}</h4>
        <p class="hl-cardx__muted">{origin === 'precomputed' ? MISSION_TEXT.official : MISSION_TEXT.live}</p>
        {control}
      </section>
    )
  }
}

const MOUNTED = '__hlSimOfficial'

/** The console's official slot (simslot.tsx OfficialSlot ref): render the bare control into `el` once. */
export function mountOfficialMission(el: Element, apiFirst: boolean): void {
  const box = el as Element & { [MOUNTED]?: boolean }
  if (box[MOUNTED]) return
  box[MOUNTED] = true
  render(<SendToSimulator origin="precomputed" mode={apiFirst ? 'all' : 'official'} framed={false} />, el)
}

/** The official slot went away: unmount its control (drops its subscription and pending check). */
export function unmountOfficialMission(el: Element): void {
  const box = el as Element & { [MOUNTED]?: boolean }
  if (!box[MOUNTED]) return
  render(null, el)
  box[MOUNTED] = false
}
