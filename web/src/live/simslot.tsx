// "Send to simulator" on #/plan/{hash} (D76 slot, D103 format, D110: the main feature for the ship),
// behind VITE_SIM_EXPORT (default off; config.ts SIM_EXPORT_MODE, D116: 'official' = the official
// plan only, from the static file; 'all' = also live results; npm run dev:live-demo uses all). It
// offers the plan's mission.json (contracts/bundle/mission.schema.json):
//  - a live result (origin computed_live): the manifest entry of kind "sim_plan" (WP9b's exporter
//    writes results/{hash}/mission.json for every live job), else results/{hash}/mission.json;
//  - the official plan (origin precomputed): the API's /results/{official_hash}/mission.json, then
//    WP9c's static sim/official/mission.json.
// planmount.tsx checks the file (probeMission) and passes the outcome in `probe`; this view stays a
// pure function of its props. 404 everywhere → "Simulator file not available for this plan". Hooks
// for the WP8c harness: data-sim-export and data-origin on the control (see ui/cards/simslot.tsx).
import type { Manifest } from '../data/types'
import {
  MISSION_TEXT,
  missionControlProps,
  missionNote,
  missionTargetFor,
  simPlanFiles as cardSimPlanFiles,
  type MissionFetchFor,
  type MissionOrigin,
  type MissionProbe,
  type MissionTarget,
} from '../ui/cards/simslot'
import { LIVE_LABEL, PRECOMPUTED_LABEL, type SimExportMode } from './config'
import type { RunOrigin } from './types'

export const SIM_PLAN_KIND = 'sim_plan'
export type { MissionFetchFor, MissionOrigin, MissionProbe, MissionTarget }

export interface SimFile {
  /** Manifest key of the entry. */
  key: string
  /** Path under the result tree, as the manifest gives it. */
  file: string
}

/** Every manifest entry of kind sim_plan (one per file, sorted by path). */
export function simPlanFiles(manifest: Manifest | null | undefined): SimFile[] {
  return cardSimPlanFiles(manifest)
}

/** Where the plan's mission.json is (ui/cards/simslot.tsx missionTargetFor; D110, D116 modes). */
export function missionTarget(manifest: Manifest | null | undefined, base: string, origin?: RunOrigin | null, mode: Exclude<SimExportMode, 'off'> = 'all'): MissionTarget | null {
  return missionTargetFor(manifest, base, origin, mode)
}

export interface SimSlotProps {
  /** SIM_EXPORT_ENABLED (VITE_SIM_EXPORT set to a mode). */
  enabled: boolean
  /** SIM_EXPORT_MODE when enabled (D116); default all. */
  mode?: SimExportMode
  manifest: Manifest | null
  /** Result base URL (files resolve as dataUrl(file, 'real', base)). */
  base: string
  /** The run record's origin (precomputed = the official plan). */
  origin?: RunOrigin | null
  /** planmount's check of the file; omitted = still checking. */
  probe?: MissionProbe
  /** Per-URL fetch for the download (planmount's simFetch; default fetch). */
  fetchFor?: MissionFetchFor
}

export function SimSlot({ enabled, mode = 'all', manifest, base, origin, probe = { state: 'checking' }, fetchFor }: SimSlotProps) {
  if (!enabled || mode === 'off') return null
  const target = missionTarget(manifest, base, origin, mode)
  if (!target) return null
  const label = target.origin === 'precomputed' ? PRECOMPUTED_LABEL : LIVE_LABEL
  return (
    <section class="live-card live-sim" aria-label="Send to simulator">
      <h3>Send to simulator</h3>
      <p class="caption">
        {target.origin === 'precomputed' ? MISSION_TEXT.official : MISSION_TEXT.live} · {label}
      </p>
      {probe.state === 'missing' ? (
        <p class="live-sim-missing" role="status" data-sim-export="missing" data-origin={target.origin} data-state="unavailable">
          {MISSION_TEXT.missing}
        </p>
      ) : (
        <p>
          <a class="live-btn live-sim-file" {...missionControlProps(probe, probe.state === 'ok' ? probe.url : target.urls[0], target.origin, fetchFor)}>
            {MISSION_TEXT.download}
          </a>{' '}
          <span class="caption live-sim-format" role="status" data-sim-status="" data-sim-version={probe.state === 'ok' ? (probe.version ?? '') : undefined}>
            {missionNote(probe)}
          </span>
        </p>
      )}
    </section>
  )
}
