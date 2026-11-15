// Why each science station was chosen (F7 scoring, D26/D44 placement), read from config/stations.yaml.
// The science objectives of the named stations are text from SPEC §1.4 (stations.yaml has none and
// stations.json `objective` is empty); scored extras get no invented objective, only what the score found.
import stationsRaw from '../../../config/stations.yaml'
import { cfg } from '../config'

export const STATIONS_SOURCE = 'config/stations.yaml'
export const OBJECTIVE_SOURCE = 'SPEC §1.4'

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
  /** CRISM index used in the score: an index name or 'max' (larger of the normalised ones) */
  crismIndex: string | null
  objective: string | null
}

const extraIds = cfg<string[]>(stationsRaw, 'extras.ids')
const stationIndex = cfg<Record<string, string>>(stationsRaw, 'scoring_assumptions.station_crism_index')

export function selectionFor(id: string): Selection {
  const named = raw.find((s) => s.id === id)
  if (named) {
    return { id, kind: 'named', rule: named.rule, manualPriority: named.manual_priority, crismIndex: stationIndex[id] ?? null, objective: OBJECTIVES[id] ?? null }
  }
  if (extraIds.includes(id)) {
    return {
      id,
      kind: 'extra',
      rule: `one of the ${SCORING.extrasMax} highest F7 scores in the ${SCORING.extrasDomain}`,
      manualPriority: cfg<number>(stationsRaw, 'extras.manual_priority'),
      crismIndex: cfg<string>(stationsRaw, 'extras.crism_index'),
      objective: null,
    }
  }
  return { id, kind: 'unknown', rule: null, manualPriority: null, crismIndex: null, objective: null }
}

/** Plain words for a CRISM index ('D2300' -> 'clay'); 'max' -> 'clay or sulfate, whichever is stronger'. */
export function indexWords(index: string | null): string | null {
  if (!index) return null
  if (index === 'max') return `${indexWords(SCORING.crismIndices.clay)} or ${indexWords(SCORING.crismIndices.sulfate)}, whichever is stronger`
  return INDEX_WORDS[index] ?? index
}

export interface SiteSummary {
  /** short display name: the plan's name, or an area name built from the score's own description */
  title: string
  /** CRISM index that drives this site, as a code ('D2300', 'SINDEX2') or 'max' when not recoverable */
  index: string | null
  /** one short line of what is there */
  note: string | null
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

/**
 * Concise card text for one site. Named stations keep their plan name and SPEC objective. Scored extras are
 * named "<Mineral> ridges, <area>" from their stations.json description (e.g. "dense ridge network + high
 * SINDEX2 sulfate signal (south-west, nearer)"); nothing is added that the description does not say.
 */
export function siteSummary(id: string, name: string): SiteSummary {
  const sel = selectionFor(id)
  if (sel.kind !== 'extra') return { title: name, index: sel.crismIndex, note: sel.objective }
  const m = /high\s+(\w+)\b.*?signal/i.exec(name)
  const code = m ? m[1] : null
  const words = code ? indexWords(code) : null
  const area = /\(([^)]+)\)\s*$/.exec(name)?.[1] ?? null
  const ridges = /ridge/i.test(name)
  const base = words ? `${cap(words)}${ridges ? ' ridges' : ' signal'}` : cap(name.replace(/\s*\(.*\)$/, ''))
  return {
    title: area ? `${base}, ${area}` : base,
    index: code ?? sel.crismIndex,
    note: words ? `${ridges ? 'Dense boxwork ridges' : 'High score'} with a strong ${words} signal.` : null,
  }
}
