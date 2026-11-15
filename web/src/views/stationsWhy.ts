// Why each science station was chosen (F7 scoring, D26/D44 placement), read from config/stations.yaml.
// The science objectives of the named stations are text from SPEC §1.4 (stations.yaml has none and
// stations.json `objective` is empty); scored extras get no invented objective, only what the score found.
import stationsRaw from '../../../config/stations.yaml'
import { cfg } from '../config'

export const STATIONS_SOURCE = 'config/stations.yaml'
export const OBJECTIVE_SOURCE = 'SPEC §1.4'
/** Citation of one stations.yaml key, as config.ts cites every other config value ("config/<file>: <path>"). */
export const stationsKey = (path: string) => `${STATIONS_SOURCE}: ${path}`

interface RawStation {
  id: string
  name: string
  rule: string
  manual_priority: number
  status?: string
}

const raw = cfg<RawStation[]>(stationsRaw, 'stations')
const weights = cfg<{ crism: number; ridge_density: number; manual: number }>(stationsRaw, 'scoring_weights')
const INDEX_WORDS = cfg<Record<string, string>>(stationsRaw, 'extras.index_words')

/** Scoring rule and placement constants, each from stations.yaml. */
export const SCORING = {
  weights,
  weightsAssumed: cfg<boolean>(stationsRaw, 'scoring_weights_assumed'),
  /** D44: the extras' placement assumptions (manual priority 0 among them) are labelled assumed. */
  extrasAssumed: cfg<boolean>(stationsRaw, 'extras.assumed'),
  ridgeRadiusM: cfg<number>(stationsRaw, 'ridge_density_radius_m'),
  minSpacingM: cfg<number>(stationsRaw, 'min_spacing_m'),
  crismIndices: cfg<{ sulfate: string; clay: string }>(stationsRaw, 'crism_indices'),
  crismCombine: cfg<string>(stationsRaw, 'scoring_assumptions.crism_combine'),
  crismNorm: cfg<string>(stationsRaw, 'scoring_assumptions.crism_normalisation'),
  ridgeNorm: cfg<string>(stationsRaw, 'scoring_assumptions.ridge_density_normalisation'),
  placementOrder: cfg<string[]>(stationsRaw, 'placement.order'),
  extrasMax: cfg<number>(stationsRaw, 'extras.max'),
  extrasDomain: cfg<string>(stationsRaw, 'extras.domain'),
  dropped: raw.filter((s) => s.status === 'dropped').map((s) => ({ id: s.id, name: s.name })),
} as const

/** SPEC §1.4 station table, "Science objective" column (named stations only). */
const OBJECTIVES: Record<string, string> = {
  S1: 'Ridge cement vs hollow floor: test groundwater cementation.',
  S2: 'Why these fracture patterns, and why only here.',
  S3: 'Where and why nodules form.',
  S4: 'Map the sulfur stones and find their source layer. It lies far out, so it makes the 30-vs-60-min trade visible.',
  S5: 'Sample the mountain without climbing it.',
}

export interface Selection {
  id: string
  /** named in the spec and placed by its own rule, or found by the F7 score (D26 extras) */
  kind: 'named' | 'extra' | 'unknown'
  /** the placement rule, verbatim from stations.yaml */
  rule: string | null
  manualPriority: number | null
  /** the stations.yaml key the manual priority is read from */
  manualPrioritySource: string | null
  /** true where config/stations.yaml (D44) labels the manual priority assumed */
  manualPriorityAssumed: boolean
  /** CRISM index used in the score: an index name or 'max' (larger of the normalised ones) */
  crismIndex: string | null
  objective: string | null
}

const extraIds = cfg<string[]>(stationsRaw, 'extras.ids')
const stationIndex = cfg<Record<string, string>>(stationsRaw, 'scoring_assumptions.station_crism_index')

export function selectionFor(id: string): Selection {
  const named = raw.find((s) => s.id === id)
  if (named) {
    return {
      id,
      kind: 'named',
      rule: named.rule,
      manualPriority: named.manual_priority,
      manualPrioritySource: stationsKey(`stations[${id}].manual_priority`),
      manualPriorityAssumed: false,
      crismIndex: stationIndex[id] ?? null, objective: OBJECTIVES[id] ?? null,
    }
  }
  if (extraIds.includes(id)) {
    return {
      id,
      kind: 'extra',
      rule: `one of the ${SCORING.extrasMax} highest F7 scores in the ${SCORING.extrasDomain}`,
      manualPriority: cfg<number>(stationsRaw, 'extras.manual_priority'),
      manualPrioritySource: stationsKey('extras.manual_priority'),
      manualPriorityAssumed: SCORING.extrasAssumed,
      crismIndex: cfg<string>(stationsRaw, 'extras.crism_index'),
      objective: null,
    }
  }
  return { id, kind: 'unknown', rule: null, manualPriority: null, manualPrioritySource: null, manualPriorityAssumed: false, crismIndex: null, objective: null }
}

/** Plain words for a CRISM index ('D2300' -> 'clay'); 'max' -> 'clay or sulfate, whichever is stronger'. */
export function indexWords(index: string | null): string | null {
  if (!index) return null
  if (index === 'max') return `${indexWords(SCORING.crismIndices.clay)} or ${indexWords(SCORING.crismIndices.sulfate)}, whichever is stronger`
  return INDEX_WORDS[index] ?? index
}
