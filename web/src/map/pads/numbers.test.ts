// PORT P2 known answers for the pad card numbers (real published files, web/public/data):
//  - every number is the stored value of its file (no rounding, no recomputation);
//  - the manifest keys are the ones the headline strip / console headline render (value snapshot keys
//    unchanged when the numbers move into the card) and exist in manifest.json;
//  - official pad: scenarios/index.json + pads index score (official summary.json does not exist).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { padKey, parsePadsIndex, parsePadSummary } from '../../data/pads'
import type { ScenariosIndex } from '../../data/types'
import { cardBudgets, officialCardNumbers, padCardNumbers, type CardNumbers } from './numbers'

const DATA = resolve(__dirname, '../../../public/data')
const json = (p: string) => JSON.parse(readFileSync(resolve(DATA, p), 'utf8'))
const manifest = json('manifest.json')
const manifestKeys = new Set<string>(Array.isArray(manifest.entries) ? manifest.entries.map((e: { key: string }) => e.key) : Object.keys(manifest.entries ?? manifest))
const refs = (n: CardNumbers) => [...n.reach.flatMap((r) => [r.value, ...(r.range ?? [])]), ...(n.feasible ? [n.feasible] : [])]

describe('pad card numbers', () => {
  it('picker pads: summary.json values under the strip keys pads.{id}.headline.{budget}.*', () => {
    const [b30, b60] = cardBudgets()
    for (const id of ['rank2', 'rank3', 'rank4']) {
      const file = `scenarios/pads/${id}/summary.json`
      const raw = json(file)
      const n = padCardNumbers(id, parsePadSummary(raw, id), file)
      expect(n.reach.map((r) => r.budget)).toEqual([b30, b60])
      const r30 = n.reach[0]
      expect(r30.value.k).toBe(padKey(id, 'headline', b30, 'reachable_pct'))
      expect(r30.value.v).toBe(raw.headline[String(b30)].reachable_pct)
      expect(r30.range?.map((r) => r.v)).toEqual(raw.headline[String(b30)].range_pct)
      expect(n.reach[1].value.v).toBe(raw.headline[String(b60)].reachable_pct)
      expect(n.feasible).toEqual({ v: raw.score, k: `pads.${id}.score`, file })
      for (const r of refs(n)) {
        expect(r.file).toBe(file)
        expect(manifestKeys.has(r.k), r.k).toBe(true)
      }
    }
  })

  it('official pad: the official plan numbers (scenarios/index.json, pads index score)', () => {
    const idx = json('scenarios/index.json') as ScenariosIndex
    const entry = idx.scenarios.find((s) => s.id === idx.default)!
    const pads = parsePadsIndex(json('scenarios/pads/index.json'))
    const n = officialCardNumbers(entry, pads.official)
    const sid = entry.id
    expect(n.reach[0].value).toEqual({ v: entry.headline.reachable_pct, k: `reachable_pct.${sid}.${entry.headline.budget_min}`, file: 'scenarios/index.json' })
    expect(n.reach[0].range?.map((r) => r.k)).toEqual([`reachable_pct_range.${sid}.${entry.headline.budget_min}.low`, `reachable_pct_range.${sid}.${entry.headline.budget_min}.high`])
    expect(n.reach[1].value.k).toBe(`reachable_pct.${sid}.${entry.headline_60!.budget_min}`)
    expect(n.reach[1].value.v).toBe(entry.headline_60!.reachable_pct)
    expect(n.feasible).toEqual({ v: pads.official.score, k: padKey(pads.official.id, 'score'), file: 'scenarios/pads/index.json' })
    for (const r of refs(n)) expect(manifestKeys.has(r.k), r.k).toBe(true)
  })
})
