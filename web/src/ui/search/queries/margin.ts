// Margin below N (search.md §2.2 #6, §4.2): `margin below 10 min`, `margin under 10`, `margin < 5` → the
// timeline rows of the current plan (TimelineModel.curve: flown rows with a margin value) whose margin is
// ≤ N, in time order. Each number is the timeline file's margin_min itself, as a manifest RowValue with the
// key the dock and the cuff use (`timeline.{scenario}.{i}.margin_min`, Timeline.tsx / cuff.tsx); it is
// compared with N, never changed. Choosing seeks the mission clock to that row (FLY when off the map).
// No map highlight: there is no threshold-highlight API (Q7), so the group ends with a one-line note.
import { t, type CopyKey } from '../../copy'
import { fmtEva, type Row } from '../../timeline/model'
import { seekTo } from './time'
import type { QueryPattern, QueryRow } from './types'

const MARGIN = /^margin\s*(?:below|under|<)\s*(\d{1,3})\s*(?:min)?$/

const EVENT: Readonly<Record<string, CopyKey>> = {
  depart: 'search.events.depart',
  arrive: 'search.events.arrive',
  return: 'search.events.return',
  leave: 'search.margin.events.leave',
  o2_checkpoint: 'search.margin.events.o2Checkpoint',
}

export function parseMarginBelow(q: string): number | null {
  const m = MARGIN.exec(q)
  return m ? Number(m[1]) : null
}

export const marginPattern: QueryPattern = {
  id: 'marginBelow',
  hint: 'search.margin.hint',
  examples: ['margin below 10 min', 'margin < 5'],
  prefixes: ['margin below '],
  parse(q, ctx) {
    const n = parseMarginBelow(q)
    if (n === null) return null
    const note: QueryRow = { id: `margin:${n}:note`, pattern: 'marginBelow', icon: 'info', title: 'search.margin.mapLater', disabledReason: 'search.reason.mapLater', run: () => {} }
    const m = ctx.timeline
    if (!m) return [{ id: `margin:${n}:none`, pattern: 'marginBelow', icon: 'gauge', title: 'search.margin.none', vars: { n: String(n) }, disabledReason: 'search.reason.noTimeline', run: () => {} }, note]
    const hits = m.curve.filter((r): r is Row & { margin: number } => r.margin !== null && r.margin <= n)
    if (!hits.length) return [{ id: `margin:${n}:none`, pattern: 'marginBelow', icon: 'gauge', title: 'search.margin.none', vars: { n: String(n) }, disabledReason: 'search.reason.nothingToOpen', run: () => {} }, note]
    const rows = hits.map(
      (r): QueryRow => ({
        id: `margin:${n}:${r.i}`,
        pattern: 'marginBelow',
        icon: 'gauge',
        title: 'search.margin.row',
        // the dock's EVA clock text for the row (fmtEva, like the timeline axis), the event and its station
        vars: { time: fmtEva(r.t), event: [EVENT[r.event] ? t(EVENT[r.event]) : r.event, r.station].filter(Boolean).join(' ') },
        values: [{ kind: 'manifest', key: `timeline.${m.scenario}.${r.i}.margin_min`, v: r.margin, file: m.file, units: 'min', chip: 'modelled' }],
        run: (env) => seekTo(r.t, env.navigate),
      }),
    )
    return [...rows, note]
  },
}
