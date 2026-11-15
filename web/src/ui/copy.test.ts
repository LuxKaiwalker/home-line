// R4 copy deck (package D6, provisional per D73): checks on web/src/ui/copy.json and the t() accessor.
// The forbidden-term list is parsed from the DESIGN §3.8 wording table, so the glossary stays the
// single source; labels that already exist in config/ must match it word for word.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { COPY_META_KEYS, placeholders, t } from './copy'

const UI = dirname(fileURLToPath(import.meta.url))
const REPO = join(UI, '..', '..', '..')
const rawText = readFileSync(join(UI, 'copy.json'), 'utf8')
const raw = JSON.parse(rawText) as Record<string, unknown>

type Leaf = { path: string; text: string }

function leaves(node: unknown, path: string, out: Leaf[]): Leaf[] {
  if (typeof node === 'string') {
    out.push({ path, text: node })
  } else if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const [k, v] of Object.entries(node)) leaves(v, path ? `${path}.${k}` : k, out)
  } else {
    throw new Error(`${path}: ${JSON.stringify(node)} is neither a string nor a nested object`)
  }
  return out
}

const body: Record<string, unknown> = Object.fromEntries(Object.entries(raw).filter(([k]) => !COPY_META_KEYS.includes(k)))
const ALL = leaves(body, '', [])

/** "Do not use" column of DESIGN §3.8, one term per comma-separated entry, parentheticals dropped. */
function forbiddenTerms(): string[] {
  const md = readFileSync(join(REPO, 'docs', 'design.md'), 'utf8')
  const start = md.indexOf('## 3.8 Wording')
  if (start < 0) throw new Error('docs/design.md has no "## 3.8 Wording" section')
  const section = md.slice(start, md.indexOf('\n## ', start + 1))
  const rows = section.split('\n').filter((l) => l.trim().startsWith('|'))
  const header = rows[0].split('|').map((c) => c.trim())
  const col = header.indexOf('Do not use')
  if (col < 0) throw new Error('§3.8 table has no "Do not use" column')
  const terms: string[] = []
  for (const row of rows.slice(2)) {
    const cell = row.split('|').map((c) => c.trim())[col] ?? ''
    for (const part of cell.replace(/\([^)]*\)/g, '').split(',')) {
      const term = part.trim()
      if (term) terms.push(term)
    }
  }
  return terms
}

function termRegex(term: string): RegExp {
  // Word boundaries, case-insensitive, hyphen and space interchangeable, plural allowed.
  const words = term.toLowerCase().split(/[\s-]+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`\\b${words.join('[\\s-]*')}(?:s|es)?\\b`, 'i')
}

/**
 * §3.8 forbids "Waypoint (except user points)"; the parenthetical is dropped by forbiddenTerms(). The
 * Mission Planer's waypoints (#/mission, copy under mission.*) are the user's own points, so the word
 * is allowed there and nowhere else (J1c, D135).
 */
const USER_POINT_PREFIX = 'mission.'
function userPointException(term: string, path: string): boolean {
  return term.toLowerCase() === 'waypoint' && path.startsWith(USER_POINT_PREFIX)
}

const PLACEHOLDER = /\{[a-z][a-z0-9_]*\}/g
/** Proper names that legitimately contain digits. Codes (S7, IST-2, D76 …) never belong in copy. */
const DIGIT_ALLOW = ['2D', '3D']

describe('copy.json: shape', () => {
  it('is valid JSON with the draft metadata (D73)', () => {
    expect(() => JSON.parse(rawText)).not.toThrow()
    expect(raw.status).toBe('draft')
    expect(typeof raw.provisional).toBe('string')
    expect(raw.provisional as string).toMatch(/D73/)
    expect(raw.version).toBe(1)
  })

  it('holds only non-empty strings and non-empty nested objects', () => {
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'string') {
        expect(node.trim(), path).not.toBe('')
        expect(node, `${path}: no leading/trailing space`).toBe(node.trim())
        return
      }
      expect(node && typeof node === 'object' && !Array.isArray(node), `${path} must be a string or object`).toBe(true)
      const entries = Object.entries(node as object)
      expect(entries.length, `${path} is empty`).toBeGreaterThan(0)
      for (const [k, v] of entries) {
        expect(k, `${path}.${k}: keys are camelCase`).toMatch(/^[a-z][A-Za-z0-9]*$/)
        walk(v, path ? `${path}.${k}` : k)
      }
    }
    walk(body, '')
    expect(ALL.length).toBeGreaterThan(100)
  })

  it('has every namespace the R4 brief asks for', () => {
    const need = [
      'modes.plan.label', 'modes.fly.label', 'modes.report.label', 'modes.evidence.label',
      'nav.wordmark', 'buttons.play',
      'cards.pad.title', 'cards.station.title', 'cards.route.title', 'cards.scoredSite.title', 'cards.landmark.title',
      'chips.real.label', 'chips.real.explanation', 'chips.modelled.label', 'chips.modelled.explanation',
      'chips.simulated.label', 'chips.simulated.explanation', 'chips.live.label', 'chips.live.explanation',
      'chips.visual.label', 'chips.visual.explanation',
      'tags.assumed.label', 'tags.assumed.explanation', 'tags.precomputed.label', 'tags.precomputed.explanation',
      'tags.hypotheticalTiming.label', 'tags.hypotheticalTiming.explanation',
      'tooltips.thread',
      'states.empty.noSelection', 'states.loading.generic', 'states.error.generic', 'states.offline.banner',
      'alarms.turnBack', 'alarms.tripwire', 'margin.comfortable', 'margin.caution', 'margin.limit',
      'intro.gale', 'intro.walkback', 'intro.notFlat',
      'simulator.label', 'simulator.sendSlot',
      'report.sections.verdict',
      // D6b: keys design agents had to inline (notes A2, A4, A5, M4, M5, M6, M8, H1, Q1; D79, D81)
      'nav.mainContent', 'nav.sidebar.label', 'nav.dock.label', 'timeline.title', 'tags.dummy.banner',
      'states.stale.label', 'states.stale.note', 'states.offline.warming',
      'tooltips.threadNoMargin', 'tooltips.compassSunNone', 'tooltips.elevationNone', 'tooltips.fieldLookup',
      'terrain.notPublished', 'terrain.trustNote', 'states.error.slow3d', 'states.error.webgl',
      'collapse.toggleToFlat', 'collapse.toggleToReal', 'collapse.reachableInData', 'collapse.reachableAssessed',
      'mapLabels.status.official', 'mapLabels.expanded',
      'cards.homelineEdge.moveIt.physiology', 'cards.homelineEdge.moveIt.slope', 'cards.homelineEdge.moveIt.data',
      'edit.reasons.customPad', 'edit.reasons.dwell', 'edit.previewEstimates', 'tags.estimate.label',
      'a11y.mapSummary',
    ]
    const have = new Set(ALL.map((l) => l.path))
    for (const p of need) expect(have.has(p), p).toBe(true)
  })
})

describe('copy.json: wording (DESIGN §3.8)', () => {
  const terms = forbiddenTerms()

  it('parses the §3.8 "Do not use" column', () => {
    expect(terms.length).toBeGreaterThanOrEqual(10)
    expect(terms.map((s) => s.toLowerCase())).toEqual(expect.arrayContaining(['abort', 'buffer', 'real-time', 'eta home']))
  })

  it('uses no "Do not use" term anywhere', () => {
    const hits: string[] = []
    for (const term of terms) {
      const re = termRegex(term)
      for (const l of ALL) if (re.test(l.text) && !userPointException(term, l.path)) hits.push(`${l.path}: "${term}" in "${l.text}"`)
    }
    expect(hits).toEqual([])
  })

  it('allows "waypoint" only for user points, i.e. the Mission Planer (§3.8 "Waypoint (except user points)", D135)', () => {
    expect(terms.map((s) => s.toLowerCase())).toContain('waypoint')
    expect(userPointException('Waypoint', 'mission.waypoints.title')).toBe(true)
    expect(userPointException('Waypoint', 'cards.station.title')).toBe(false)
    expect(userPointException('Waypoint', 'missionary.x')).toBe(false)
    expect(userPointException('Buffer', 'mission.estimates.timeMargin')).toBe(false)
  })

  it('the matcher catches the forbidden terms (self-check)', () => {
    expect(termRegex('Real-time').test('Real time results')).toBe(true)
    expect(termRegex('Rule').test('Walkback rules')).toBe(true)
    expect(termRegex('Base').test('Basemap and database')).toBe(false)
  })

  it('claims no NASA endorsement', () => {
    const re = /endors|approved by nasa|nasa[\s-]*(approved|certified|official|validated|standard)|official nasa|on behalf of nasa/i
    expect(ALL.filter((l) => re.test(l.text)).map((l) => l.path)).toEqual([])
  })

  it('uses no emoji (DESIGN §3.5)', () => {
    expect(ALL.filter((l) => /\p{Extended_Pictographic}/u.test(l.text)).map((l) => l.path)).toEqual([])
  })
})

describe('copy.json: placeholders and numbers', () => {
  it('placeholders are well-formed {snake_case} with no stray braces', () => {
    for (const l of ALL) {
      const rest = l.text.replace(PLACEHOLDER, '')
      expect(/[{}]/.test(rest), `${l.path}: malformed placeholder in "${l.text}"`).toBe(false)
    }
  })

  it('holds no digits outside placeholders and allow-listed names (no numbers, no codes)', () => {
    const bad: string[] = []
    for (const l of ALL) {
      let rest = l.text.replace(PLACEHOLDER, '')
      for (const name of DIGIT_ALLOW) rest = rest.replace(new RegExp(`\\b${name}\\b`, 'g'), '')
      if (/\p{Nd}/u.test(rest)) bad.push(`${l.path}: "${l.text}"`)
    }
    expect(bad).toEqual([])
  })
})

describe('copy.json: consistent with labels already on screen', () => {
  const yaml = (f: string) => parseYaml(readFileSync(join(REPO, 'config', f), 'utf8'))
  it('thread tooltip equals config/design.yaml thread.tooltip', () => {
    expect(t('tooltips.thread', { t_home: 'a', margin: 'b', binding: 'c' })).toBe(
      String(yaml('design.yaml').thread.tooltip).replace('{t_home}', 'a').replace('{margin}', 'b').replace('{binding}', 'c'),
    )
  })
  it('simulator label equals config/hud.yaml labels.simulated (D76)', () => {
    expect(t('simulator.label')).toBe(yaml('hud.yaml').labels.simulated)
    expect(t('simulator.label')).toBe('Simulated EVA · real terrain and data')
  })
  it('live, precomputed and offline texts equal config/backend.yaml labels (WS13 banner)', () => {
    const b = yaml('backend.yaml').labels
    expect(t('states.offline.banner')).toBe(b.offline)
    expect(t('tags.live.label')).toBe(b.live)
    expect(t('tags.precomputed.label')).toBe(b.precomputed)
  })
})

describe('copy.ts accessor', () => {
  it('returns plain strings', () => {
    expect(t('modes.plan.label')).toBe('Plan')
  })
  it('interpolates every placeholder', () => {
    const s = t('tooltips.thread', { t_home: 18, margin: 41, binding: 'dose' })
    expect(s).not.toMatch(/[{}]/)
    expect(s).toContain('18')
    expect(s).toContain('dose')
  })
  it('throws on a missing placeholder value instead of showing a half-filled string', () => {
    expect(() => t('tooltips.thread', { t_home: 18 })).toThrow(/margin/)
  })
  it('throws on a key that is not a string', () => {
    expect(() => t('modes' as never)).toThrow()
    expect(() => t('nope.nothing' as never)).toThrow()
  })
  it('lists placeholders of a key', () => {
    expect(placeholders('tooltips.thread').sort()).toEqual(['binding', 'margin', 't_home'])
  })
})

describe('copy.json: the Plan port strings (route.*, PORT I4)', () => {
  // Every route.* key is read somewhere in the app: as a literal 'route.…' key, or under the static prefix of
  // a template key (`route.panel.sections.${name}`). PENDING = seed keys whose package has not merged yet.
  const PENDING: string[] = [
    'route.pads.planFromHere', // P2
    'route.strip.official', 'route.strip.pad', 'route.panel.open', // P3
    'route.list.empty', // U2
  ]
  const SRC = join(UI, '..')
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
    )
  const src = files(SRC).map((f) => readFileSync(f, 'utf8')).join('\n')
  const literal = new Set([...src.matchAll(/['"](route\.[A-Za-z.]+)['"]/g)].map((m) => m[1]))
  const prefixes = [...src.matchAll(/`(route\.[A-Za-z.]+\.)\$\{/g)].map((m) => m[1])
  const keys = ALL.filter((l) => l.path.startsWith('route.')).map((l) => l.path)

  it('has no unused route.* key', () => {
    const unused = keys.filter((k) => !literal.has(k) && !prefixes.some((p) => k.startsWith(p)) && !PENDING.includes(k))
    expect(unused).toEqual([])
  })
  it('PENDING lists only keys that are still unused', () => {
    expect(PENDING.filter((k) => literal.has(k))).toEqual([])
  })
  it('carries the team lead labels word for word', () => {
    expect(t('route.panel.estimates.estimate')).toBe('Estimate')
    expect(t('route.panel.fast')).toBe('Fast route · may not be the fastest')
    expect(t('route.layers.curiosity.live')).toBe('live NASA data')
    expect(t('route.map.official')).toBe('Official route for this pad')
    expect(t('route.map.mine')).toBe('Your route')
    expect(t('route.export.marvis')).toBe('Send to MARVIS')
    expect(t('route.export.download')).toBe('Download mission.json')
    expect(t('route.settings.storm', { date: '20 May 2024' })).toBe('Include solar storm replay (20 May 2024) in the margin')
    expect(t('modes.science.label')).toBe('Science')
    expect(t('nav.views.stations')).toBe('Science stations')
  })
})
