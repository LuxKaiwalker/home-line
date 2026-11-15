// Stations within N min (search.md §2.2 #4, §4.2): `stations within 30 min`, `within 45` → one row per
// station whose time home in the current scenario is ≤ N, ascending, then the stations whose time is
// unknown (shown as unknown, never dropped). Each row's number is the stations.json value itself, as a
// manifest RowValue with the key the station card uses (`t_home_min.{id}.{scenario}`, cards.tsx); it is
// compared with N, never changed or combined. Choosing selects the station, like an object row.
import { select } from '../../../state/selection'
import { ui } from '../../../state/ui'
import { isMapMode, modeHash, openSidebar, shell } from '../../shell/store'
import type { QueryPattern, QueryRow, QueryRunEnv } from './types'

const WITHIN = /^(?:stations?\s+)?within\s+(\d+)\s*(?:min(?:utes?)?)?$/
/** search.md §2.2: `within` above 999 gives a disabled row. */
export const WITHIN_MAX = 999
export const STATIONS_FILE = 'stations.json'

export function parseWithin(q: string): number | null {
  const m = WITHIN.exec(q)
  return m ? Number(m[1]) : null
}

/** Choose a station: the same path as an object row (palette runItem): PLAN if off the map, select, sidebar
 *  (kept shut when the Plan map hosts station cards itself, L2d). */
export function openStation(id: string, env: QueryRunEnv): void {
  if (!isMapMode(ui.mode.peek() ?? 'plan')) env.navigate(modeHash('plan'))
  select({ kind: 'station', id }, 'search')
  if (!shell.hosted.peek().includes('station')) openSidebar()
}

export const withinPattern: QueryPattern = {
  id: 'within',
  hint: 'search.within.hint',
  examples: ['stations within 30 min', 'within 45'],
  prefixes: ['stations within ', 'within '],
  parse(q, ctx) {
    const n = parseWithin(q)
    if (n === null) return null
    const none = (reason: 'search.reason.withinRange' | 'search.reason.nothingToOpen'): QueryRow[] => [
      { id: `within:${n}:none`, pattern: 'within', icon: 'thread-home', title: 'search.within.none', vars: { n: String(n) }, disabledReason: reason, run: () => {} },
    ]
    if (n > WITHIN_MAX) return none('search.reason.withinRange')
    const known: [QueryRow, number][] = []
    const unknown: QueryRow[] = []
    for (const s of ctx.stations) {
      const v = s.t_home_min[ctx.scenario] ?? null
      if (v !== null && v > n) continue
      const row: QueryRow = {
        id: `within:${n}:${s.id}`,
        pattern: 'within',
        icon: 'thread-home',
        title: 'search.within.row',
        vars: { code: s.id, name: s.name },
        values: [{ kind: 'manifest', key: `t_home_min.${s.id}.${ctx.scenario}`, v, file: STATIONS_FILE, units: 'min', chip: 'modelled' }],
        run: (env) => openStation(s.id, env),
      }
      if (v === null) unknown.push(row)
      else known.push([row, v])
    }
    known.sort((a, b) => a[1] - b[1])
    const rows = [...known.map(([r]) => r), ...unknown]
    return rows.length ? rows : none('search.reason.nothingToOpen')
  },
}
