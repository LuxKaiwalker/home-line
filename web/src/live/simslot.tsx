// "Send to simulator" on #/plan/{hash} (D76 slot, D103 format, D110: the main feature for the ship),
// behind VITE_SIM_EXPORT (default off; on only in the live demo build, npm run dev:live-demo). It
// offers the plan's mission.json (contracts/bundle/mission.schema.json):
//  - a live result (origin computed_live): the manifest entry of kind "sim_plan" (WP9b's exporter
//    writes results/{hash}/mission.json for every live job), else results/{hash}/mission.json;
//  - the official plan (origin precomputed): the API's /results/{official_hash}/mission.json, then
//    WP9c's static sim/official/mission.json.
// planmount.tsx checks the file (probeMission) and passes the outcome in `probe`; this view stays a
// pure function of its props. 404 everywhere → "Simulator file not available for this plan". Hooks
// for the WP8c harness: data-sim-export and data-origin on the control (see ui/cards/simslot.tsx).
import type { Manifest } from '../data/types'
import { dataUrl } from '../env'
import { MISSION_FILE, MISSION_TEXT, officialMissionUrl, onMissionClick, simPlanFiles as cardSimPlanFiles, type MissionOrigin, type MissionProbe } from '../ui/cards/simslot'
import { LIVE_LABEL, PRECOMPUTED_LABEL } from './config'
import type { RunOrigin } from './types'

export const SIM_PLAN_KIND = 'sim_plan'
export type { MissionOrigin, MissionProbe }

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

export interface MissionTarget {
  origin: MissionOrigin
  /** Candidate URLs, best first. */
  urls: string[]
}

const uniq = (xs: string[]) => [...new Set(xs)]

/**
 * Where the plan's mission.json is. Null when there is no plan to export (no manifest and no
 * origin). A missing origin counts as computed live (only the official tree is precomputed).
 */
export function missionTarget(manifest: Manifest | null | undefined, base: string, origin?: RunOrigin | null): MissionTarget | null {
  if (!manifest && !origin) return null
  const files = simPlanFiles(manifest)
  const declared = (files.find((f) => f.file.split('/').pop() === MISSION_FILE) ?? files[0])?.file
  const fromTree = dataUrl(declared ?? MISSION_FILE, 'real', base)
  if (origin === 'precomputed') return { origin: 'precomputed', urls: uniq([fromTree, officialMissionUrl()]) }
  return { origin: 'computed_live', urls: [fromTree] }
}

export interface SimSlotProps {
  /** SIM_EXPORT_ENABLED (VITE_SIM_EXPORT). */
  enabled: boolean
  manifest: Manifest | null
  /** Result base URL (files resolve as dataUrl(file, 'real', base)). */
  base: string
  /** The run record's origin (precomputed = the official plan). */
  origin?: RunOrigin | null
  /** planmount's check of the file; omitted = still checking. */
  probe?: MissionProbe
}

export function SimSlot({ enabled, manifest, base, origin, probe = { state: 'checking' } }: SimSlotProps) {
  if (!enabled) return null
  const target = missionTarget(manifest, base, origin)
  if (!target) return null
  const label = target.origin === 'precomputed' ? PRECOMPUTED_LABEL : LIVE_LABEL
  const note =
    probe.state === 'ok' ? (probe.version ? MISSION_TEXT.format(probe.version) : MISSION_TEXT.noVersion) : probe.state === 'failed' ? MISSION_TEXT.failed(probe.message) : probe.state === 'checking' ? MISSION_TEXT.checking : ''
  return (
    <section class="live-card live-sim" aria-label="Send to simulator">
      <h3>Send to simulator</h3>
      <p class="caption">
        {target.origin === 'precomputed' ? MISSION_TEXT.official : MISSION_TEXT.live} · {label}
      </p>
      {probe.state === 'missing' ? (
        <p class="live-sim-missing" role="status" data-sim-export="missing" data-origin={target.origin}>
          {MISSION_TEXT.missing}
        </p>
      ) : (
        <p>
          <a
            class="live-btn live-sim-file"
            href={probe.state === 'ok' ? probe.url : target.urls[0]}
            download={MISSION_FILE}
            data-sim-export={probe.state === 'ok' ? 'ready' : probe.state}
            data-origin={target.origin}
            onClick={onMissionClick(probe)}
          >
            {MISSION_TEXT.download}
          </a>{' '}
          <span class="caption live-sim-format" role="status" data-sim-version={probe.state === 'ok' ? (probe.version ?? '') : undefined}>
            {note}
          </span>
        </p>
      )}
    </section>
  )
}
