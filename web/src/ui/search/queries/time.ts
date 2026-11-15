// "Go to time" (search.md §2.2 #2, §4.2): `t 45`, `t45`, `t 1:20`, `at 01:20` → one row that seeks the
// mission clock. The minute is the user's own input (formatted hh:mm in the title), not a validated number.
import { missionClock } from '../../../state/mission'
import { HIDDEN_MODES, ui } from '../../../state/ui'
import { isMapMode, modeHash } from '../../shell/store'
import type { QueryPattern, QueryRow } from './types'

const TIME = /^(?:t\s*\+?\s*|at\s+)(?:(\d{1,2}):([0-5]\d)|(\d{1,3}))\s*(?:min)?$/

/** "01:20" for 80 min (the timeline's EVA clock format). */
export function clockText(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

/** Minutes for a time query, or null when `q` is not one. */
export function parseTime(q: string): number | null {
  const m = TIME.exec(q)
  if (!m) return null
  return m[3] !== undefined ? Number(m[3]) : Number(m[1]) * 60 + Number(m[2])
}

/** Choose: FLY (PLAN while FLY is hidden, D145) when not in a map mode, then seek the one mission clock. */
export function seekTo(min: number, navigate: (hash: string) => void): void {
  if (!isMapMode(ui.mode.peek() ?? 'plan')) navigate(modeHash(HIDDEN_MODES.has('fly') ? 'plan' : 'fly'))
  missionClock.seek(min)
}

export const timePattern: QueryPattern = {
  id: 'time',
  hint: 'search.time.hint',
  examples: ['t 45', 't45', 't 1:20', 'at 01:20'],
  prefixes: ['t ', 'at '],
  parse(q, ctx) {
    const min = parseTime(q)
    if (min === null) return null
    const row: QueryRow = {
      id: `time:${min}`,
      pattern: 'time',
      icon: 'clock',
      title: 'search.time.row',
      vars: { time: clockText(min) },
      disabledReason: min > ctx.tMaxMin ? 'search.reason.timeRange' : null,
      run: (env) => seekTo(min, env.navigate),
    }
    return [row]
  },
}
