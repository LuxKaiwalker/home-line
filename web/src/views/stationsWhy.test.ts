import { describe, expect, it } from 'vitest'
import { indexWords, SCORING, selectionFor, siteSummary } from './stationsWhy'

describe('why each station was chosen (stations.yaml F7 / D26 / D44)', () => {
  it('F7 weights are 0.4 / 0.4 / 0.2, sum to 1 and are labelled assumed (D32)', () => {
    expect(SCORING.weights).toEqual({ crism: 0.4, ridge_density: 0.4, manual: 0.2 })
    expect(SCORING.weights.crism + SCORING.weights.ridge_density + SCORING.weights.manual).toBeCloseTo(1, 12)
    expect(SCORING.weightsAssumed).toBe(true)
    expect(SCORING.minSpacingM).toBe(300)
    expect(SCORING.ridgeRadiusM).toBe(25)
  })

  it('named stations: own rule, manual priority, CRISM index and the SPEC objective', () => {
    const s1 = selectionFor('S1')
    expect(s1.kind).toBe('named')
    expect(s1.rule).toContain('clay index')
    expect(s1.manualPriority).toBe(0.5)
    expect(s1.crismIndex).toBe('D2300')
    expect(s1.objective).toMatch(/groundwater cementation/)
    const s4 = selectionFor('S4')
    expect(s4.manualPriority).toBe(1)
    expect(s4.crismIndex).toBe('SINDEX2')
    expect(s4.rule).toContain('sol 4200')
  })

  it('extras S6-S8: found by the score, manual priority 0, no invented objective', () => {
    for (const id of ['S6', 'S7', 'S8']) {
      const s = selectionFor(id)
      expect(s.kind).toBe('extra')
      expect(s.manualPriority).toBe(0)
      expect(s.crismIndex).toBe('max')
      expect(s.objective).toBeNull()
    }
  })

  it('S3 and S5 are listed as dropped (D44); an unknown id stays unknown', () => {
    expect(SCORING.dropped.map((d) => d.id)).toEqual(['S3', 'S5'])
    expect(selectionFor('S9').kind).toBe('unknown')
  })

  it('index words', () => {
    expect(indexWords('D2300')).toBe('clay')
    expect(indexWords('SINDEX2')).toBe('sulfate')
    expect(indexWords('max')).toBe('clay or sulfate, whichever is stronger')
    expect(indexWords(null)).toBeNull()
  })

  it('site summaries: plan names kept, extras get a short area name from their own description', () => {
    expect(siteSummary('S1', 'Boxwork ridge-hollow transect')).toEqual({
      title: 'Boxwork ridge-hollow transect',
      index: 'D2300',
      note: 'Ridge cement vs hollow floor: test groundwater cementation.',
    })
    expect(siteSummary('S6', 'dense ridge network + high SINDEX2 sulfate signal (south-west, nearer)')).toEqual({
      title: 'Sulfate ridges, south-west, nearer',
      index: 'SINDEX2',
      note: 'Dense boxwork ridges with a strong sulfate signal.',
    })
    const s8 = siteSummary('S8', 'dense ridge network + high D2300 clay signal')
    expect(s8.title).toBe('Clay ridges')
    expect(s8.index).toBe('D2300')
    // a description the pattern does not match falls back to the score's own index, no invented mineral
    expect(siteSummary('S7', 'some other spot (east)')).toEqual({ title: 'Some other spot, east', index: 'max', note: null })
  })
})
