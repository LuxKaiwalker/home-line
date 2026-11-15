// Time home (search.md §2.2 #5, §4.2): `time home here` (the current selection) and `time home <coords>`
// (DMS, planner metres or decimal). A station: its stations.json value as a manifest RowValue (the key the
// station card and "within" use). Any other point: the field lookup (map/field fieldAt, the plan's variant)
// as a RowValue labelled "estimate", never a validated number. No value is never invented: hatched /
// outside the data → "unknown"; known terrain without a value → "no route home"; no field loaded → "unknown".
// Choosing selects that place (the selection itself for `here`, else the cell) and opens the sidebar.
import type { SelectionRef } from '../../../state/selection'
import { select } from '../../../state/selection'
import { ui } from '../../../state/ui'
import type { CopyKey } from '../../copy'
import { isMapMode, modeHash, openSidebar } from '../../shell/store'
import { lonLatText, openCell, parsePoint, type LonLatPoint } from './coords'
import { STATIONS_FILE } from './within'
import type { QueryContext, QueryHere, QueryPattern, QueryRow, QueryRunEnv, RowValue } from './types'

const TIME_HOME = /^time\s+home(?:\s+(.+))?$/

type Answer = { title: CopyKey; values?: RowValue[] }

/** The value for a point from the field: estimate, or a title that says why there is none. */
export function fieldAnswer(p: LonLatPoint, ctx: QueryContext): Answer {
  const s = ctx.fieldAt?.(p.lon, p.lat) ?? null
  if (!s || !s.inside || s.unknown) return { title: 'search.timeHome.unknown' }
  const v = s.tHome[s.variant]
  if (v === null || !Number.isFinite(v)) return { title: s.noRouteHome[s.variant] ? 'search.timeHome.noRoute' : 'search.timeHome.unknown' }
  return { title: 'search.timeHome.row', values: [{ kind: 'estimate', value: v, unit: 'min', source: 'fieldAt' }] }
}

/** The current selection as a place (ctx.here in tests, else ctx.hereNow() reads the selection). */
export function currentHere(ctx: QueryContext): QueryHere | null {
  return ctx.here !== undefined ? ctx.here : (ctx.hereNow?.() ?? null)
}

/** Re-select the selection's own ref (no change when it is already shown) and open the sidebar. */
function openRef(ref: SelectionRef, env: QueryRunEnv): void {
  if (!isMapMode(ui.mode.peek() ?? 'plan')) env.navigate(modeHash('plan'))
  select(ref, 'search')
  openSidebar()
}

export const timeHomePattern: QueryPattern = {
  id: 'timeHome',
  hint: 'search.timeHome.hint',
  examples: ['time home here', 'time home 137.39, -4.77', 'time home x 120 y -40'],
  prefixes: ['time home '],
  parse(q, ctx) {
    const m = TIME_HOME.exec(q)
    if (!m) return null
    const tail = m[1]
    if (tail === undefined) return null // bare `time home`: fuzzy (glossary term)
    if (tail === 'here') {
      const h = currentHere(ctx)
      if (!h) return [{ id: 'timeHome:here:none', pattern: 'timeHome', icon: 'thread-home', title: 'search.timeHome.here', disabledReason: 'search.reason.nothingSelected', run: () => {} }]
      const st = h.ref.kind === 'station' ? ctx.stations.find((s) => s.id === (h.ref as { id: string }).id) : undefined
      let a: Answer
      if (st) {
        const v = st.t_home_min[ctx.scenario] ?? null
        a = v === null ? { title: 'search.timeHome.unknown' } : { title: 'search.timeHome.row', values: [{ kind: 'manifest', key: `t_home_min.${st.id}.${ctx.scenario}`, v, file: STATIONS_FILE, units: 'min', chip: 'modelled' }] }
      } else a = fieldAnswer(h, ctx)
      const place = st ? `${st.id} ${st.name}` : lonLatText(h)
      return [{ id: `timeHome:here:${place}`, pattern: 'timeHome', icon: 'thread-home', title: a.title, vars: { place }, values: a.values, run: (env) => openRef(h.ref, env) }]
    }
    const p = parsePoint(tail, ctx)
    if (!p) return null // `time home ridge`: not a place, fuzzy search
    const a = fieldAnswer(p, ctx)
    const row: QueryRow = {
      id: `timeHome:${lonLatText(p)}`,
      pattern: 'timeHome',
      icon: 'thread-home',
      title: a.title,
      vars: { place: p.form === 'decimal' ? lonLatText(p) : `${tail} (${lonLatText(p)})` },
      values: a.values,
      disabledReason: p.outOfRange ? 'search.reason.planningRadius' : null,
      run: (env) => openCell(p, env),
    }
    return [row]
  },
}
