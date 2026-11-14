// D19 (user 2026-11-14 14:19, SPEC §2.4): navigation (F21/F22, /nav) and visual odometry (X8/X9)
// are an optional add-on. They stay reachable and labelled; the default console never loads them.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NAV_ITEMS } from '../router'
import { ADDON_LABEL, SLOTS } from './slot'

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

describe('D19 optional add-on', () => {
  it('label text', () => expect(ADDON_LABEL).toBe('Optional add-on (not part of the core plan)'))
  it('/nav slot is marked optional; /hud and /hud3d are not', () => {
    expect(SLOTS.nav.optional).toBe(true)
    expect(SLOTS.hud.optional).toBe(false)
    expect(SLOTS.hud3d.optional).toBe(false)
  })
  it('top navigation says the navigation view is optional', () => {
    const nav = NAV_ITEMS.find((i) => i.route.name === 'nav')!
    expect(nav.label.toLowerCase()).toContain('optional')
  })
  it('the default console (view, map, data helpers it imports) reads no navigation or VO file', () => {
    for (const f of ['views/console.tsx', 'map/consoleMap.ts', 'data/access.ts', 'data/partner.ts', 'map/pad.ts', 'views/route.ts']) {
      const s = src(f)
      expect(s, f).not.toMatch(/\.(fixes|localisation|voDrift|fixIntervalSummary)\(/)
      expect(s, f).not.toMatch(/['"`](nav|vo|localisation)\//)
      expect(s, f).not.toMatch(/from '\.\.\/nav\//)
    }
  })
})
