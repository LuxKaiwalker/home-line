// Rover pad (F8). C 14:58: pad.json describes the pad *in use* (= config/site.yaml pad_default, user
// 11:24); without pad.json the app uses pad_default itself, labelled. WS2's F8 siting result is only
// a proposal: siting.png + siting_png.json, plus an optional pad.json `proposal` block. A proposal
// never becomes the pad.
import type { PadFile, PadProposalBlock } from '../data/types'

export interface PadMarkerInfo {
  lon: number
  lat: number
  /** Data file the position was read from (null = config/site.yaml). */
  file: string | null
  sourceLabel: string
  title: string
}

export function padMarker(p: PadFile | null, cfg: { lon: number; lat: number }): PadMarkerInfo {
  if (p) {
    return {
      lon: p.pad.lon,
      lat: p.pad.lat,
      file: 'pad.json',
      sourceLabel: 'pad.json, the pad in use',
      title: `Rover pad in use (pad.json, ${p.site_rule_version})`,
    }
  }
  return {
    lon: cfg.lon,
    lat: cfg.lat,
    file: null,
    sourceLabel: 'config/site.yaml pad_default (the pad in use)',
    title: 'Rover pad in use: config/site.yaml pad_default (kept by the user, 14 Nov 11:24)',
  }
}

export interface PadProposal {
  lon: number
  lat: number
  score: number | null
  maxSlopeDeg: number | null
  assessedPct: number | null
  rulePassed: boolean | null
  ruleLabel: 'passed' | 'NOT passed' | 'not evaluated'
  /** Ranked alternatives other than the proposal itself. */
  alternatives: { rank: number; lon: number; lat: number; score: number | null }[]
  /** Every alternative has the proposal's score: the rule cannot tell them apart. */
  tied: boolean
  rule: string | null
}

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The optional pad.json `proposal` block (F8 siting result), or null. */
export function padProposal(p: PadFile | null): PadProposal | null {
  const b: PadProposalBlock | undefined = p?.proposal
  if (!b || n(b.lon) === null || n(b.lat) === null) return null
  const c = b.checks ?? {}
  const passed = typeof c.rule_passed === 'boolean' ? c.rule_passed : null
  const alts = (b.alternatives ?? []).filter((a) => !(a.lon === b.lon && a.lat === b.lat))
  const score = n(b.score)
  return {
    lon: b.lon,
    lat: b.lat,
    score,
    maxSlopeDeg: n(c.max_slope_deg),
    assessedPct: n(c.assessed_pct_30min),
    rulePassed: passed,
    ruleLabel: passed === true ? 'passed' : passed === false ? 'NOT passed' : 'not evaluated',
    alternatives: alts.map((a) => ({ rank: a.rank, lon: a.lon, lat: a.lat, score: n(a.score) })),
    tied: score !== null && alts.length > 0 && alts.every((a) => a.score === score),
    rule: typeof b.rule === 'string' ? b.rule : null,
  }
}
