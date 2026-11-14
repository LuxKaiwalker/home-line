import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import type { Manifest } from '../data/types'
import { manifestEntries, preH0 } from './scorecard'

const m = JSON.parse(readFileSync(resolve(__dirname, '../../public/data-dummy/manifest.json'), 'utf8')) as Manifest
const e = (utc: string) => ({ value: 1, units: null, file: 'f', script: 's', commit: 'c', utc })

describe('scorecard manifest checks (SPEC F16)', () => {
  it('lists every entry except the dummy flag, sorted', () => {
    const all = manifestEntries(m)
    expect(all.length).toBe(Object.keys(m).length - 1)
    expect(all.map(([k]) => k)).toEqual([...all.map(([k]) => k)].sort((a, b) => a.localeCompare(b)))
  })
  it('flags entries before H0 (config/event.yaml h0_utc), passes those after', () => {
    expect(CONFIG.h0Utc).toBe('2026-11-14T08:00:00Z')
    expect(preH0([['a', e('2026-11-14T07:59:59Z')], ['b', e('2026-11-14T08:00:00Z')], ['c', e('garbage')]], CONFIG.h0Utc)).toEqual(['a', 'c'])
    expect(preH0(manifestEntries(m), CONFIG.h0Utc)).toEqual([])
  })
})
