// PORT U1: copy.U1.json follows the copy.json rules (ui/copy.test.ts) until I4 merges it into route.*:
// no empty strings, no digits outside {placeholders}, no DESIGN §3.8 "Do not use" term, HOMELINE only.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import own from './copy.U1.json'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

function leaves(o: unknown, path: string, out: { path: string; text: string }[] = []) {
  if (typeof o === 'string') out.push({ path, text: o })
  else if (o && typeof o === 'object') {
    expect(Object.keys(o).length, `${path} is empty`).toBeGreaterThan(0)
    for (const [k, v] of Object.entries(o)) leaves(v, path ? `${path}.${k}` : k, out)
  }
  return out
}
const ALL = leaves(own, '')

function forbidden(): string[] {
  const md = readFileSync(join(REPO, 'docs', 'design.md'), 'utf8')
  const start = md.indexOf('## 3.8 Wording')
  const rows = md.slice(start, md.indexOf('\n## ', start + 1)).split('\n').filter((l) => l.trim().startsWith('|'))
  const col = rows[0].split('|').map((c) => c.trim()).indexOf('Do not use')
  return rows.slice(2).flatMap((r) => (r.split('|').map((c) => c.trim())[col] ?? '').replace(/\([^)]*\)/g, '').split(',').map((s) => s.trim()).filter(Boolean))
}

describe('copy.U1.json', () => {
  it('has text everywhere and no digits outside placeholders', () => {
    for (const l of ALL) {
      expect(l.text.trim(), l.path).not.toBe('')
      expect(l.text.replace(/\{[a-z][a-z0-9_]*\}/g, ''), l.path).not.toMatch(/[0-9{}]/)
    }
  })

  it('uses no DESIGN §3.8 "Do not use" term, and no MARVIS as the app name', () => {
    const terms = forbidden()
    expect(terms.length).toBeGreaterThan(5)
    for (const term of terms) {
      const re = new RegExp(`\\b${term.toLowerCase().split(/[\s-]+/).join('[\\s-]*')}(?:s|es)?\\b`, 'i')
      for (const l of ALL) expect(re.test(l.text), `${l.path}: "${term}"`).toBe(false)
    }
    for (const l of ALL) expect(l.text, l.path).not.toMatch(/MARVIS/)
  })
})
