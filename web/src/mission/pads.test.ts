// J1d (team lead 2026-11-15 16:57): the tab's pad choice = Official pad + P2–P4 (the app's picker labels),
// each with its own fields (I2: pads/{pad}/nom_104/...), frame.pad kind 'picker' for P2–P4 (I2b).
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fieldKeys, FIELD_PADS, padChoices, padLabel, PADS_INDEX, pickerLayerFiles, pickerPad, type PadIndexRow } from './pads'

const DATA = resolve(__dirname, '../../public/data')
const fields = JSON.parse(readFileSync(resolve(DATA, 'fields/index.json'), 'utf8')).fields as Record<string, unknown>
const pads = JSON.parse(readFileSync(resolve(DATA, PADS_INDEX), 'utf8')).pads as (PadIndexRow & { picker?: boolean })[]

describe('the tab\'s pads', () => {
  it('labels as the app\'s picker: Official pad, P2, P3, P4', () => {
    expect([null, ...FIELD_PADS].map(padLabel)).toEqual(['Official pad', 'P2', 'P3', 'P4'])
  })

  it('field keys: official = the scenario\'s own, P2–P4 = I2\'s pads/ keys', () => {
    expect(fieldKeys(null, 'nom_104')).toEqual({ tHome: 'nom_104/t_home', o2Home: 'nom_104/o2_home', pointer: 'nom_104/pointer' })
    expect(fieldKeys('rank3', 'nom_104')).toEqual({ tHome: 'pads/rank3/nom_104/t_home', o2Home: 'pads/rank3/nom_104/o2_home', pointer: 'pads/rank3/nom_104/pointer' })
    for (const p of [null, ...FIELD_PADS]) for (const k of Object.values(fieldKeys(p, 'nom_104'))) expect(fields, k).toHaveProperty([k])
  })

  it('on the published data all four are available for nom_104; P2–P4 only for nom_104', () => {
    expect(padChoices(fields, 'nom_104')).toEqual([
      { pad: null, label: 'Official pad', available: true },
      { pad: 'rank2', label: 'P2', available: true },
      { pad: 'rank3', label: 'P3', available: true },
      { pad: 'rank4', label: 'P4', available: true },
    ])
    const other = Object.keys(fields).find((k) => /^[a-z]+_\d+\/t_home$/.test(k) && !k.startsWith('nom_104/'))
    if (other) {
      const sid = other.split('/')[0]
      expect(padChoices(fields, sid).map((c) => c.available)).toEqual([true, false, false, false])
    }
  })

  it('P2 is the pads index rank2 row: kind picker, its id, lon/lat and elevation; its own layers', () => {
    const row = pads.find((p) => p.id === 'rank2')!
    const p = pickerPad(row)
    expect(p).toMatchObject({ id: 'rank2', kind: 'picker', elevM: row.elev_m })
    expect(p.marker).toMatchObject({ lon: 137.393301, lat: -4.776468, file: PADS_INDEX, sourceLabel: 'scenarios/pads/index.json rank2 (D21 rank 2)' })
    expect(p.marker.title).toContain('P2')
    const files = pickerLayerFiles('rank2', 104)
    for (const f of Object.values(files)) expect(() => readFileSync(resolve(DATA, f))).not.toThrow()
  })
})
