// Expanded "Find" index (search block S1; interfaces §3, spec rule 5): map layers and highlight areas,
// route legs, timeline events, scenarios, report and evidence sections, glossary terms. Pure builders
// over files the app already loads (overlay catalogue, route_{scenario}.geojson, the dock's timeline
// model, scenarios/index.json, the copy deck). Building an item changes nothing: the store call sits
// in `run` (or `ref`) and only happens when the row is chosen (palette runItem).
// No number is shown: rows carry names, codes (station, leg, scenario id) and kinds only; the clock
// minute of an event lives in the closure, never in the row text.
import { OVERLAYS, type OverlayDef, type OverlayId } from '../../../map/overlays/catalog'
import { setOverlay } from '../../../map/overlays/state'
import { MODE_PATHS } from '../../../router'
import { choosePlanScenario, mission, missionClock, type PlanScenario } from '../../../state/mission'
import { ui, type Mode } from '../../../state/ui'
import type { TimelineModel } from '../../timeline/model'
import raw from '../../copy.json'
import type { CopyKey } from '../../copy'
import { isMapMode, modeHash } from '../../shell/store'
import { GROUP_LABEL, type RunEnv, type SearchGroup, type SearchItem } from '../search'

export type Translate = (k: CopyKey, vars?: Record<string, string | number>) => string

/** The store calls a chosen row makes. One object, so tests can spy on each (nothing calls them while
 *  the index is built, typed or arrowed). */
export const actions = {
  setOverlay: (id: OverlayId, on: boolean): void => setOverlay(id, on),
  seekClock: (tMin: number): void => missionClock.seek(tMin),
  chooseScenario: (s: PlanScenario): void => choosePlanScenario(s),
  setStorm: (on: boolean): void => void (mission.conditions.storm.value = on),
  /** Scroll a section into view once the route has rendered it (no-op when the view has no anchor). */
  scrollTo: (win: Window | undefined, id: string): void => {
    const go = () => win?.document?.getElementById?.(id)?.scrollIntoView?.({ block: 'start' })
    if (win && typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(() => go())
    else go()
  },
}

/** Map-bound results (layers, clock) open PLAN first when the map is hidden, like object results. */
function toMap(env: RunEnv): void {
  if (!isMapMode(ui.mode.peek() ?? 'plan')) env.navigate(modeHash('plan'))
}

const kindWords = (g: SearchGroup, tr: Translate): string => tr(GROUP_LABEL[g])

// ---- Areas: the overlay catalogue (terrain, science and evidence layers, incl. the ridge, mineral-hint
// and blocked-area highlights). Choosing turns the layer on through the layer store.
export function areaItems(tr: Translate, defs: readonly OverlayDef[] = OVERLAYS): SearchItem[] {
  const kw = kindWords('areas', tr)
  return defs.map((o): SearchItem => ({
    id: `area:${o.id}`,
    group: 'areas',
    code: '',
    name: tr(o.name),
    icon: 'layers',
    chip: o.chip,
    priority: 12,
    keywords: `${kw} ${tr(`layers.groups.${o.group}`)}`,
    run: (env) => {
      toMap(env)
      actions.setOverlay(o.id, true)
    },
  }))
}

// ---- Legs of the official plan's route (route_{scenario}.geojson features {leg, from, to}). Read-only:
// choosing selects the leg (same ref as a map click), so the sidebar shows the leg card.
export interface LegLike {
  leg: number
  from: string
  to: string
}
export function legsFromRoute(fc: { features?: readonly { properties?: Record<string, unknown> | null }[] } | null): LegLike[] {
  const out: LegLike[] = []
  for (const f of fc?.features ?? []) {
    const p = f.properties ?? {}
    if (typeof p.leg === 'number' && typeof p.from === 'string' && typeof p.to === 'string') out.push({ leg: p.leg, from: p.from, to: p.to })
  }
  return out.sort((a, b) => a.leg - b.leg)
}
export function legItems(legs: readonly LegLike[], tr: Translate): SearchItem[] {
  const stop = (s: string) => (s === 'pad' ? tr('cards.pad.title') : s)
  const kw = `${kindWords('legs', tr)} ${tr('cards.route.title')}`
  return legs.map((l): SearchItem => ({
    id: `leg:official:${l.leg}`,
    group: 'legs',
    code: `${l.leg}`, // the leg card's own code (cards.tsx LegCard)
    name: tr('cards.route.titleFromTo', { from: stop(l.from), to: stop(l.to) }),
    icon: 'map',
    chip: 'simulated',
    priority: 13,
    keywords: kw,
    ref: { kind: 'leg', leg: l.leg },
  }))
}

// ---- Timeline events (the dock's model): departure, arrivals, turn-backs, return, tripwire, storm
// window, daylight end. Choosing seeks the mission clock to the event minute (shown nowhere here).
export function eventItems(m: TimelineModel, tr: Translate): SearchItem[] {
  const kw = kindWords('events', tr)
  const out: SearchItem[] = []
  const add = (id: string, name: CopyKey, code: string, icon: SearchItem['icon'], t: number | null | undefined) => {
    if (typeof t !== 'number' || !Number.isFinite(t)) return
    out.push({
      id: `evt:${id}`,
      group: 'events',
      code,
      name: tr(name),
      label: name,
      icon,
      priority: 14,
      keywords: kw,
      run: (env) => {
        toMap(env)
        actions.seekClock(t)
      },
    })
  }
  for (const r of m.rows) {
    if (r.event === 'depart') add(`depart:${r.i}`, 'search.events.depart', '', 'rover', r.t)
    if (r.event === 'return') add(`return:${r.i}`, 'search.events.return', '', 'rover', r.t)
  }
  for (const d of m.dwells) add(`arrive:${d.i0}`, 'search.events.arrive', d.station, 'station', d.t0)
  for (const b of m.turnBacks) add(`turnBack:${b.i}`, 'timeline.turnBack', b.station ?? '', 'turn-back', b.t)
  if (m.storm) {
    add('tripwire', 'timeline.tripwire', '', 'tripwire', m.storm.tripwire)
    add('stormWindow', 'timeline.stormWindow', '', 'radiation', m.storm.onset)
  }
  add('daylightEnd', 'timeline.daylightEnd', '', 'sun', m.daylightEnd)
  return out
}

// ---- Scenarios (scenarios/index.json): choosing uses the plan's scenario chooser. Plus the storm
// replay, which the map's storm control toggles (mission.conditions.storm).
const VARIANT_KEY: Readonly<Record<string, CopyKey>> = { optimistic: 'variants.optimistic', nominal: 'variants.nominal', conservative: 'variants.conservative' }
export function scenarioItems(scenarios: readonly PlanScenario[], tr: Translate): SearchItem[] {
  const kw = kindWords('scenarios', tr)
  const out: SearchItem[] = scenarios.map((s): SearchItem => ({
    id: `scn:${s.id}`,
    group: 'scenarios',
    code: '', // the id carries the suit mass, a number without provenance (spec rule 2): searchable, not shown
    name: VARIANT_KEY[s.variant] ? tr(VARIANT_KEY[s.variant]) : s.variant,
    icon: 'gauge',
    priority: 15,
    keywords: `${kw} ${s.id}`,
    run: (env) => {
      toMap(env)
      actions.chooseScenario({ id: s.id, variant: s.variant, suit_kg: s.suit_kg })
    },
  }))
  out.push({
    id: 'scn:storm',
    group: 'scenarios',
    code: '',
    name: tr('storm.title'),
    label: 'storm.title',
    icon: 'radiation',
    priority: 15,
    keywords: kw,
    run: (env) => {
      toMap(env)
      actions.setStorm(true)
    },
  })
  return out
}

// ---- Report sections and evidence sections: navigate to the mode route, then to the section anchor
// (`report-{key}` / `evidence-{key}`) when the view renders one.
const REPORT_SECTIONS = ['verdict', 'map', 'timeline', 'oxygen', 'legs', 'stations', 'partner', 'assumptions', 'runRecord', 'permalink'] as const
const EVIDENCE_SECTIONS: readonly (readonly [keyof typeof raw.evidence, 'scorecard' | 'about'])[] = [
  ['scorecard', 'scorecard'],
  ['validation', 'scorecard'],
  ['footing', 'scorecard'],
  ['view', 'scorecard'],
  ['radChecks', 'scorecard'],
  ['trustSplit', 'scorecard'],
  ['assumptions', 'scorecard'],
  ['provenance', 'scorecard'],
  ['addOns', 'scorecard'],
  ['data', 'about'],
  ['licences', 'about'],
  ['about', 'about'],
  ['privacy', 'about'],
]
export function reportItems(tr: Translate): SearchItem[] {
  const kw = kindWords('report', tr)
  const nav = (hash: string, anchor: string) => (env: RunEnv) => {
    env.navigate(hash)
    actions.scrollTo(env.win, anchor)
  }
  const reportHash = (): string => modeHash('report' satisfies Mode) ?? '#/report'
  return [
    ...REPORT_SECTIONS.map(
      (k): SearchItem => ({
        id: `report:${k}`,
        group: 'report',
        code: '',
        name: tr(`report.sections.${k}`),
        label: `report.sections.${k}`,
        icon: 'file-text',
        priority: 16,
        keywords: `${kw} ${tr('modes.report.label')}`,
        run: (env) => nav(reportHash(), `report-${k}`)(env),
      }),
    ),
    ...EVIDENCE_SECTIONS.map(
      ([k, view]): SearchItem => ({
        id: `evidence:${k}`,
        group: 'report',
        code: '',
        name: tr(`evidence.${k}` as CopyKey),
        label: `evidence.${k}` as CopyKey,
        icon: 'shield-check',
        priority: 16,
        keywords: `${kw} ${tr('modes.evidence.label')}`,
        run: nav(`#${MODE_PATHS[view]}`, `evidence-${k}`),
      }),
    ),
  ]
}

// ---- Glossary (copy.json glossary): term + its one-line definition as secondary text. No glossary
// view or tooltip target exists yet, so choosing only closes the palette (nothing destructive).
export function glossaryItems(tr: Translate, glossary: Readonly<Record<string, string>> = raw.glossary): SearchItem[] {
  const kw = kindWords('glossary', tr)
  const out: SearchItem[] = []
  for (const [k, v] of Object.entries(glossary)) {
    if (k.endsWith('Hint')) continue
    const hint = glossary[`${k}Hint`]
    out.push({
      id: `glossary:${k}`,
      group: 'glossary',
      code: '',
      name: v,
      label: `glossary.${k}` as CopyKey,
      // a definition with a {placeholder} needs a number: shown without it
      hint: hint && !hint.includes('{') ? (`glossary.${k}Hint` as CopyKey) : undefined,
      icon: 'info',
      priority: 18,
      keywords: kw,
      run: () => undefined,
    })
  }
  return out
}
