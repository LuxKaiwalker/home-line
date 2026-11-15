// J1d (team lead 2026-11-15 16:57): the Mission Planer's pad choice = the four pads the browser has
// fields for, labelled as the app's Edit-route picker (I2b, edit/route/instant/padpick.tsx): "Official
// pad" (pad.json, the scenario's own fields) and P2, P3, P4 (scenarios/pads/index.json rank2..rank4,
// I2's fields `pads/{pad}/{scenario}/{t_home,o2_home,pointer}`, nom_104 only). Same keys and pad
// provenance as I2b's edit/route/browser/data.ts (fieldKeys, pickerPadOf); copied, not imported: the
// static tab must not import edit/route/** (static-isolation tests).
import type { PadMarkerInfo } from '../map/pad'
import { t } from '../ui/copy'

export const PADS_INDEX = 'scenarios/pads/index.json'
/** The picker pads with browser fields (I2): rank2..rank4 of the pads index. */
export const FIELD_PADS = ['rank2', 'rank3', 'rank4'] as const
/** copy.json mission.pads.official (the app's picker: I2b PAD_PICK_TEXT.official) */
export const OFFICIAL_PAD_LABEL = t('mission.pads.official')

/** The tab's pad: null = the official pad, else a FIELD_PADS id. */
export type MissionPad = string | null

/** The label the app's picker shows: "Official pad", "P2", "P3", "P4". */
export const padLabel = (pad: MissionPad): string => (pad === null ? OFFICIAL_PAD_LABEL : pad.replace(/^rank(\d+)$/, 'P$1'))

/** fields/index.json keys of a pad's T_home / O2_home / pointer (I2b fieldKeys). */
export function fieldKeys(pad: MissionPad, scenario: string): { tHome: string; o2Home: string; pointer: string } {
  const pre = pad === null ? `${scenario}/` : `pads/${pad}/${scenario}/`
  return { tHome: `${pre}t_home`, o2Home: `${pre}o2_home`, pointer: `${pre}pointer` }
}

export interface PadChoice {
  pad: MissionPad
  label: string
  /** false when fields/index.json has no T_home for this pad and scenario (P2–P4: nom_104 only) */
  available: boolean
}

/** Official pad first, then P2–P4; each available when its fields exist for the scenario. */
export function padChoices(fields: Record<string, unknown>, scenario: string): PadChoice[] {
  return [null, ...FIELD_PADS].map((pad) => ({ pad, label: padLabel(pad), available: !!fields[fieldKeys(pad, scenario).tHome] }))
}

/** A row of scenarios/pads/index.json, as far as the tab needs it. */
export interface PadIndexRow {
  id: string
  lon: number
  lat: number
  elev_m?: number | null
  rank?: number | null
}

/** A picker pad as the tab's pad: the marker and mission.json frame.pad (kind 'picker', I2b pickerPadOf). */
export function pickerPad(row: PadIndexRow): { marker: PadMarkerInfo; id: string; kind: 'picker'; elevM: number | null } {
  const rank = typeof row.rank === 'number' ? ` (D21 rank ${row.rank})` : ''
  const source = `${PADS_INDEX} ${row.id}${rank}`
  return {
    marker: { lon: row.lon, lat: row.lat, file: PADS_INDEX, sourceLabel: source, title: `Rover pad ${padLabel(row.id)} (${source})` },
    id: row.id,
    kind: 'picker',
    elevM: typeof row.elev_m === 'number' ? row.elev_m : null,
  }
}

/** The picker pad's own reachable-area layers (scenarios/pads/{pad}/): bands and edges; no isochrones. */
export function pickerLayerFiles(pad: string, suitKg: number): { bands: string; edges: string } {
  return { bands: `scenarios/pads/${pad}/bands_${suitKg}.geojson`, edges: `scenarios/pads/${pad}/edges.geojson` }
}
