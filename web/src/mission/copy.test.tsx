// J1c (D135): the Mission Planer tab's visible text comes from the copy deck (web/src/ui/copy.json,
// mission.*). Checks: the tx() helper; every mission.* key is used by the tab; no visible text is left
// hard-coded in the tab's files; the EVA start card renders the deck's words. Runs in node (no DOM):
// StartTime is hook-free, so its tree is turned into text by a small renderer (as in views/about.test.tsx).
import { Fragment, h, type VNode } from 'preact'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import raw from '../ui/copy.json'
import { t } from '../ui/copy'
import { evaClock } from './marstime'
import { tx } from './richCopy'
import { DEFAULT_START_MS, StartTime } from './StartTime'

const HERE = dirname(fileURLToPath(import.meta.url))
const FILES = [join(HERE, '..', 'views', 'mission.tsx'), join(HERE, 'LayersControl.tsx'), join(HERE, 'MapsControl.tsx'), join(HERE, 'StartTime.tsx')]
const SOURCES = FILES.map((f) => ({ f, src: readFileSync(f, 'utf8') }))

function text(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  const v = node as VNode<{ children?: unknown }>
  if (v.type === Fragment) return text(v.props.children)
  if (typeof v.type === 'function') return text((v.type as (p: unknown) => unknown)(v.props))
  return text(v.props.children)
}

function keys(node: unknown, path: string): string[] {
  if (typeof node === 'string') return [path]
  return Object.entries(node as object).flatMap(([k, v]) => keys(v, `${path}.${k}`))
}

describe('tx(): copy with elements in its placeholders', () => {
  it('keeps strings and numbers as text and places nodes where their placeholder was', () => {
    const code = h('code', null, 'iso.json')
    const out = tx('mission.boundary.caption', { file: code, scenario: 'S1' })
    expect(out[1]).toBe(code)
    expect(text(out)).toBe(t('mission.boundary.caption', { file: 'iso.json', scenario: 'S1' }))
  })
  it('throws on a missing value like t()', () => {
    expect(() => tx('mission.boundary.caption', { file: h('code', null, 'x') })).toThrow(/scenario/)
  })
})

describe('Mission Planer copy (mission.*)', () => {
  it('every mission.* key is used by the tab', () => {
    const all = SOURCES.map((s) => s.src).join('\n')
    const unused = keys((raw as Record<string, unknown>).mission, 'mission').filter((k) => !all.includes(`'${k}'`))
    expect(unused).toEqual([])
  })

  it('every mission.* key the tab uses exists', () => {
    const have = new Set(keys((raw as Record<string, unknown>).mission, 'mission'))
    const used = SOURCES.flatMap((s) => [...s.src.matchAll(/'(mission\.[A-Za-z.]+)'/g)].map((m) => m[1]))
    expect(used.length).toBeGreaterThan(100)
    expect(used.filter((k) => !have.has(k))).toEqual([])
  })

  it('no visible text is left hard-coded in the tab (JSX text, title/aria-label/placeholder/alt literals)', () => {
    const bad: string[] = []
    for (const { f, src } of SOURCES) {
      const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
      // JSX text after an opening or closing tag, with a word in it. Skipped: <code>…</code> (file names
      // and config keys, not prose), TypeScript (generics, arrows: = ; & in the run) and object-literal
      // keys between two placeholder elements (", site: ").
      for (const m of code.matchAll(/(<[a-z][\w-]*(?:\s[^<>]*)?>|<\/[a-z][\w-]*>|<>|<\/>)([^<>{}]*[A-Za-z]{2,}[^<>{}]*)</g)) {
        const run = m[2]
        const skip = m[1] === '<code>' || /[=;&]/.test(run) || /\b(return|if)\b/.test(run) || /^\s*[),]/.test(run) || /^\s*[a-z_0-9]+:/m.test(run)
        if (skip) continue
        bad.push(`${f}: text "${run.trim()}"`)
      }
      for (const m of code.matchAll(/\b(title|aria-label|placeholder|alt)="([^"]*[A-Za-z][^"]*)"/g)) bad.push(`${f}: ${m[1]}="${m[2]}"`)
    }
    expect(bad).toEqual([])
  })
})

describe('EVA start card', () => {
  const clock = evaClock(DEFAULT_START_MS, { lat: -4.7, lon: 137.4 })
  const card = (startMs: number) => text(StartTime({ startMs, clock, onChange: () => {}, sunSiteLabel: t('mission.start.sunSite', { lat: '-4.70000', lon: '137.40000' }) }))

  it('labels its rows with the copy deck', () => {
    const s = card(DEFAULT_START_MS)
    for (const k of ['mission.start.earth', 'mission.start.sol', 'mission.start.localTime', 'mission.start.season', 'mission.start.sun', 'mission.start.sunset', 'mission.start.daylight'] as const) {
      expect(s).toContain(t(k))
    }
    expect(s).toContain(t('mission.start.localTimeValue', { sol: clock.mslSol, lmst: clock.lmst }))
    expect(s).toContain('Default: ')
    expect(s).not.toContain(t('mission.start.reset'))
  })

  it('a moved start says so and offers Reset', () => {
    const s = card(DEFAULT_START_MS + 3600_000)
    expect(s).toContain('Changed from the default')
    expect(s).toContain(t('mission.start.reset'))
  })
})
