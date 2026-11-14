import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONFIG } from '../config'
import type { PadFile } from '../data/types'
import { padMarker } from './pad'

const pad = JSON.parse(readFileSync(resolve(__dirname, '../../public/data-dummy/pad.json'), 'utf8')) as PadFile

describe('pad marker', () => {
  it('uses pad.json when present', () => {
    const m = padMarker(pad, CONFIG.padDefault)
    expect([m.lon, m.lat]).toEqual([pad.pad.lon, pad.pad.lat])
    expect(m.file).toBe('pad.json')
    expect(m.sourceLabel).toContain('rule passed')
  })
  it('falls back to config/site.yaml pad_default, labelled', () => {
    const m = padMarker(null, CONFIG.padDefault)
    expect([m.lon, m.lat]).toEqual([CONFIG.padDefault.lon, CONFIG.padDefault.lat])
    expect(m.file).toBeNull()
    expect(m.sourceLabel).toContain('pad_default')
  })
})
