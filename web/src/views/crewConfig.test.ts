import { describe, expect, it } from 'vitest'
import { BUDGET_CONSTANTS } from '../mission/budget'
import { crewGroups } from './crewConfig'

describe('crew configuration page (views/crewConfig.ts)', () => {
  const g = crewGroups({ id: 'nom_104', suitKg: 104, variant: 'nominal' })
  const row = (label: string) => g.flatMap((x) => x.rows).find((r) => r.label === label)!

  it('three groups: crew and masses, physiology, O2 and EVA limits', () => {
    expect(g.map((x) => x.title)).toEqual(['Crew and masses', 'Physiology', 'O₂ and EVA limits'])
  })

  it('masses from crew.yaml and the assigned suit; carried = suit + tools', () => {
    expect(row('Crew size').value).toBe('2 astronauts')
    expect(row('Body mass').value).toBe('75 kg')
    expect(row('Body mass').assumed).toBe(true)
    expect(row('Suit mass').value).toBe('104 kg')
    expect(row('Suit mass').note).toBe('also precomputed: 80 kg, 120 kg')
    expect(row('Tools').value).toBe('10 kg')
    expect(row('Carried mass').value).toBe('114 kg')
    expect(row('Total moving mass').value).toBe('189 kg')
  })

  it('derived O2 values are the planner constants (cannot disagree with the Mission Planer)', () => {
    expect(row('O₂ at max effort').value).toBe(`${BUDGET_CONSTANTS.effortRateLMin.toFixed(2)} L/min`)
    expect(row('O₂ at max effort').value).toBe('1.35 L/min')
    expect(row('Primary O₂').value).toBe('482.3 L')
    expect(row('O₂ reserve').value).toBe('40.5 L')
    expect(row('EVA duration limit').value).toBe('6.5 h')
    expect(row('Walk-home budgets').value).toBe('30 min · 60 min')
  })

  it('another suit changes only the suit-dependent rows', () => {
    const h = crewGroups({ id: 'con_120', suitKg: 120, variant: 'conservative' }).flatMap((x) => x.rows)
    expect(h.find((r) => r.label === 'Carried mass')!.value).toBe('130 kg')
    expect(h.find((r) => r.label === 'Walking-model estimate')!.value).toBe('conservative')
    expect(h.find((r) => r.label === 'Primary O₂')!.value).toBe('482.3 L')
  })
})
