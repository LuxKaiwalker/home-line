// D19 (user 2026-11-14 14:19, SPEC §2.4) made navigation (F21/F22) and visual odometry (X8/X9) an
// optional add-on; D98 removed the /nav view and D99 the first-person 3D view (/hud3d, F20).
// The default console never loads navigation files, and no slot or top-nav entry names the removed views.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NAV_ITEMS } from '../router'
import { ADDON_LABEL, SLOTS } from './slot'
import { VIEWS } from '.'

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

describe('D98 / D99 removed views', () => {
  it('only the /hud slot remains; no view, slot or top-nav entry for /nav or /hud3d', () => {
    expect(Object.keys(SLOTS)).toEqual(['hud'])
    expect(Object.keys(VIEWS)).not.toContain('nav')
    expect(Object.keys(VIEWS)).not.toContain('hud3d')
    expect(NAV_ITEMS.map((i) => i.route.name)).not.toContain('nav')
    expect(NAV_ITEMS.map((i) => i.route.name)).not.toContain('hud3d')
  })
})

describe('D19 optional add-on', () => {
  it('label text (scorecard navigation findings)', () => expect(ADDON_LABEL).toBe('Optional add-on (not part of the core plan)'))
  it('the default console (view, map, data helpers it imports) reads no navigation or VO file', () => {
    for (const f of ['views/console.tsx', 'map/consoleMap.ts', 'data/access.ts', 'data/partner.ts', 'map/pad.ts', 'views/route.ts']) {
      const s = src(f)
      expect(s, f).not.toMatch(/\.(fixes|localisation|voDrift|fixIntervalSummary)\(/)
      expect(s, f).not.toMatch(/['"`](nav|vo|localisation)\//)
      expect(s, f).not.toMatch(/from '\.\.\/nav\//)
    }
  })
})
