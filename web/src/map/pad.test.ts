import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import type { PadFile } from '../data/types'
import { padMarker, padProposal } from './pad'

const dummy = JSON.parse(readFileSync(resolve(__dirname, '../../public/data-dummy/pad.json'), 'utf8')) as PadFile

// C 14:58: pad.json describes the pad in use (pad_default, user 11:24). The F8 siting result is a
// proposal carried separately: siting.png + siting_png.json, plus an optional pad.json `proposal`.
const IN_USE: PadFile = {
  dummy: false,
  pad: { lon: CONFIG.padDefault.lon, lat: CONFIG.padDefault.lat, elev_m: null, score: null, checks: { assessed_pct_30min: 100, max_slope_deg: 2.1, rule_passed: true } },
  alternatives: [],
  hop_options: [],
  site_rule_version: 'pad_default',
}
const WITH_PROPOSAL: PadFile = {
  ...IN_USE,
  proposal: {
    lon: 137.402443,
    lat: -4.769028,
    score: 0.475,
    checks: { assessed_pct_30min: null, max_slope_deg: 3.95, rule_passed: null },
    alternatives: [
      { rank: 1, lon: 137.402443, lat: -4.769028, score: 0.475 },
      { rank: 2, lon: 137.405846, lat: -4.764625, score: 0.475 },
    ],
    rule: 'site.yaml siting',
  },
}

describe('pad marker: the pad in use', () => {
  it('pad.json pad when present', () => {
    const m = padMarker(IN_USE, CONFIG.padDefault)
    expect([m.lon, m.lat]).toEqual([IN_USE.pad.lon, IN_USE.pad.lat])
    expect(m.file).toBe('pad.json')
  })
  it('a pad.json proposal never moves the pad', () => {
    const m = padMarker(WITH_PROPOSAL, CONFIG.padDefault)
    expect([m.lon, m.lat]).toEqual([CONFIG.padDefault.lon, CONFIG.padDefault.lat])
  })
  it('falls back to config/site.yaml pad_default, labelled (pad.json not published)', () => {
    const m = padMarker(null, CONFIG.padDefault)
    expect([m.lon, m.lat]).toEqual([CONFIG.padDefault.lon, CONFIG.padDefault.lat])
    expect(m.file).toBeNull()
    expect(m.sourceLabel).toContain('pad_default')
  })
  it('dummy pad.json still reads', () => expect(padMarker(dummy, CONFIG.padDefault).file).toBe('pad.json'))
})

describe('F8 siting proposal (optional pad.json `proposal` block)', () => {
  it('none without pad.json or without the block', () => {
    expect(padProposal(null)).toBeNull()
    expect(padProposal(IN_USE)).toBeNull()
  })
  it('reads the block; null checks say "not evaluated"; tie flagged; rank-1 duplicate dropped', () => {
    const p = padProposal(WITH_PROPOSAL)!
    expect([p.lon, p.lat, p.score]).toEqual([137.402443, -4.769028, 0.475])
    expect(p.assessedPct).toBeNull()
    expect(p.ruleLabel).toBe('not evaluated')
    expect(p.tied).toBe(true)
    expect(p.alternatives.map((a) => a.rank)).toEqual([2])
  })
})
