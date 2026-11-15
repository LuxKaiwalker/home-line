// Palette query patterns (search block S3a/S3b; docs/design/search.md §2 grammar, §4.2 store map, §5 API).
// A pattern turns the normalised query into answer rows. parse() is pure and sync: it never touches a
// store, the map or the clock (spec rule 3, "nothing changes until a row is chosen"); only row.run does.
// Numbers reach a row only as RowValue (spec rule 2): a manifest-backed value rendered by <Num> with its
// trust chip, or a field lookup labelled "estimate" (S3b). Titles carry names, codes and the user's own
// input (vars), never a validated number.
import type { FieldSample } from '../../../map/field/decode'
import type { SelectionRef } from '../../../state/selection'
import type { ChipKind, IconName } from '../../components'
import type { CopyKey } from '../../copy'
import type { TimelineModel } from '../../timeline/model'

/** A station as the queries read it (data/types Station subset). */
export interface QueryStation {
  id: string
  name: string
  lon: number
  lat: number
  t_home_min: Record<string, number | null>
}

export interface QueryContext {
  stations: readonly QueryStation[]
  /** Scenario id (mission.plan.scenario ?? scenarios/index.json default): part of the manifest key. */
  scenario: string
  pad: { id: string; lon: number; lat: number }
  /** Mission clock length (min), missionClock.tMax. */
  tMaxMin: number
  /** Live planning reachable (liveStatus.reachable once S2 is merged; default false). */
  live: boolean
  /** CONFIG.marsRadiusM (planner metres, S3b). */
  marsRadiusM: number
  fieldAt?: (lon: number, lat: number) => FieldSample | null
  timeline?: TimelineModel | null
  here?: { lon: number; lat: number; ref: SelectionRef } | null
  /** S3a: route editing is part of this build (VITE_LIVE and not VITE_ROUTE_EDIT=0). Default false. */
  routeEdit?: boolean
  /** S3a: whether edit/route/store exports setRouteDraft (WP12); 'unknown' until probed. */
  routeDraft?: 'unknown' | 'ready' | 'missing'
}

export type RowValue =
  | { kind: 'manifest'; key: string; v: number | null; file: string; units?: string; chip?: ChipKind }
  | { kind: 'estimate'; value: number; unit: 'min' | 'm'; source: 'fieldAt' }

export interface QueryRunEnv {
  navigate: (hash: string) => void
  win?: Window
}

export interface QueryRow {
  /** Unique per query, e.g. 'time:80'. */
  id: string
  pattern: QueryPattern['id']
  icon: IconName
  title: CopyKey
  vars?: Record<string, string>
  /** The only way a number appears in a row. */
  values?: readonly RowValue[]
  /** Live-only row (spec rule 4). */
  live?: boolean
  /** Set: the row is shown disabled with this reason and choosing it does nothing. */
  disabledReason?: CopyKey | null
  /** Called only when the row is chosen (Enter / click). */
  run: (env: QueryRunEnv) => void
}

export interface QueryPattern {
  id: 'time' | 'route' | 'within' | 'timeHome' | 'marginBelow' | 'coords'
  hint: CopyKey
  examples: readonly string[]
  /** Tab completion prefixes (§2.3). */
  prefixes: readonly string[]
  /** Pure, sync, no side effects. null = not this pattern (falls through to fuzzy search). */
  parse: (q: string, ctx: QueryContext) => QueryRow[] | null
}
