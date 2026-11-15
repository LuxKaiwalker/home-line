// Crew configuration page data (user 2026-11-15): the crew, masses, physiology and O2 / EVA limits the
// Mission Planer plans with, read from config/crew.yaml (and the scenario index for the assigned suit),
// never re-typed. Derived values are the planner's own (mission/budget.ts BUDGET_CONSTANTS), so this page
// and the planner cannot disagree.
import crewRaw from '../../../config/crew.yaml'
import { cfg } from '../config'
import { BUDGET_CONSTANTS } from '../mission/budget'

export const CREW_SOURCE = 'config/crew.yaml'

export interface CrewRow {
  label: string
  value: string
  /** where it comes from: a config key, or "derived: <formula>" */
  source: string
  assumed?: boolean
  note?: string
}

export interface CrewGroup {
  title: string
  rows: CrewRow[]
}

const num = (path: string): number => {
  const v = cfg<unknown>(crewRaw, path)
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${CREW_SOURCE}: ${path} is not a number`)
  return v
}
const fmt = (v: number, d = 0) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const key = (k: string) => `${CREW_SOURCE} ${k}`

/** The assigned scenario: suit mass and walking-model estimate the planner uses (scenarios/index.json default). */
export interface Assigned {
  id: string
  suitKg: number
  variant: string
}

export function crewGroups(a: Assigned): CrewGroup[] {
  const body = num('body_mass_kg')
  const tools = num('tools_kg')
  const suits = cfg<number[]>(crewRaw, 'suit_masses_kg')
  const carried = a.suitKg + tools
  const vSafe = cfg<{ max_deg: number; v: number }[]>(crewRaw, 'v_safe_ms')
  const budgets = cfg<number[]>(crewRaw, 'walkback_budgets_min')
  const B = BUDGET_CONSTANTS
  return [
    {
      title: 'Crew and masses',
      rows: [
        { label: 'Crew size', value: `${num('crew_size')} astronauts`, source: key('crew_size') },
        { label: 'Body mass', value: `${fmt(body)} kg`, source: key('body_mass_kg'), assumed: true, note: 'per astronaut' },
        {
          label: 'Suit mass',
          value: `${fmt(a.suitKg)} kg`,
          source: `scenarios/index.json (${a.id}); options ${key('suit_masses_kg')}`,
          note: `also precomputed: ${suits.filter((s) => s !== a.suitKg).map((s) => `${s} kg`).join(', ')}`,
        },
        { label: 'Tools', value: `${fmt(tools)} kg`, source: key('tools_kg'), note: 'per astronaut' },
        { label: 'Carried mass', value: `${fmt(carried)} kg`, source: 'derived: suit + tools', note: 'suit + tools' },
        { label: 'Total moving mass', value: `${fmt(body + carried)} kg`, source: 'derived: body + suit + tools', note: 'body + suit + tools' },
      ],
    },
    {
      title: 'Physiology',
      rows: [
        { label: 'VO₂max', value: `${fmt(num('vo2max_ml_kg_min'))} mL/kg/min`, source: key('vo2max_ml_kg_min') },
        { label: 'Effort cap', value: `${fmt(num('effort_cap_frac') * 100)} % of VO₂max`, source: key('effort_cap_frac') },
        { label: 'O₂ at max effort', value: `${fmt(B.effortRateLMin, 2)} L/min`, source: 'derived: effort cap × VO₂max × body mass' },
        {
          label: 'O₂ at station work',
          value: `${fmt(B.stationRateLMin, 3)} L/min`,
          source: `derived: ${key('o2_margin.station_task_rate_btu_h')} (${fmt(num('o2_margin.station_task_rate_btu_h'))} BTU/h)`,
          note: 'during stops',
        },
        {
          label: 'Safe walking speed',
          value: `${vSafe.map((r) => fmt(r.v, 1)).join(' · ')} m/s`,
          source: key('v_safe_ms'),
          assumed: true,
          note: `up to ${vSafe.map((r) => `${r.max_deg}°`).join(' · ')} slope`,
        },
        { label: 'Walking-model estimate', value: a.variant, source: `scenarios/index.json (${a.id}); parameters config/variants.yaml` },
      ],
    },
    {
      title: 'O₂ and EVA limits',
      rows: [
        {
          label: 'Primary O₂',
          value: `${fmt(B.o2CapacityL, 1)} L`,
          source: `derived: ${key('o2_budget.formula')}`,
          assumed: true,
          note: `${num('o2_budget.primary_design_eva_h')} h at ${fmt(num('o2_budget.primary_design_rate_btu_h'))} BTU/h`,
        },
        { label: 'Secondary O₂', value: `${fmt(num('o2_budget.secondary_L'))} L`, source: key('o2_budget.secondary_L'), assumed: true, note: 'emergency only' },
        {
          label: 'O₂ reserve',
          value: `${fmt(B.reserveL, 1)} L`,
          source: `derived: ${key('o2_margin.reserve_min_at_effort_cap')} × O₂ at max effort`,
          note: `${num('o2_margin.reserve_min_at_effort_cap')} min at the effort cap`,
        },
        { label: 'EVA duration limit', value: `${fmt(num('eva_h'), 1)} h`, source: key('eva_h') },
        { label: 'Walk-home budgets', value: budgets.map((b) => `${b} min`).join(' · '), source: key('walkback_budgets_min') },
      ],
    },
  ]
}
