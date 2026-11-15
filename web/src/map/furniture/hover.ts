// L7a (D111, team lead test Sun 12:39): pointer hover never changes state.
//
// Before: every mouse move on the planning map started the thread home at the pointer (WS7's
// follower path to the pad, with its time home) and, during the replay, that pointer thread replaced
// the crew's: the replay's thread and tooltip were gone as soon as the pointer touched the map.
//
// Now:
//   hover                 a passive tooltip at the pointer: fieldAt's T_home there (nearest pixel,
//                         a lookup, labelled as an estimate); no path is followed, no store is written
//   hover + Alt held      the thread home from the pointer (the explicit mode), outside the replay only
//   replay (clock plays)  the thread stays the crew's whatever the pointer does; only an explicit click
//                         or key (Play / pause, Space, the flythrough's own cancel) stops the replay
//
// The I1 mouse mapping (map/input) is unchanged: Alt is no button and no I1 modifier (Ctrl / Shift).
import type { LonLat } from '../../hud/types'
import { t } from '../../ui/copy'
import type { FieldSample } from '../field'
import { fmt1 } from './text'

/** KeyboardEvent.key of the held key that turns the hover into the thread home from the pointer. */
export const WAY_HOME_KEY = 'Alt'

/** True when `e` holds the way-home key (MouseEvent / KeyboardEvent modifier state). */
export const wayHomeHeld = (e: { altKey?: boolean } | null | undefined): boolean => !!e?.altKey

export type ThreadFrom = 'crew' | 'pointer' | 'none'

export interface ThreadInputs {
  /** pointer over the map (lon, lat); null = not over the map */
  cursor: LonLat | null
  /** the way-home key is held */
  wayHome: boolean
  /** the mission clock plays (the replay runs) */
  playing: boolean
  /** the crew's planned position at the clock minute; null = no replay position (no plan, t = 0 paused) */
  crew: LonLat | null
}

/**
 * Where the thread home starts. The crew during the replay, always; the pointer only in the explicit
 * mode (way-home key held) while the replay does not run; else the crew's paused position, or none.
 */
export function threadFrom(i: ThreadInputs): { kind: ThreadFrom; at: LonLat | null } {
  if (i.cursor && i.wayHome && !i.playing) return { kind: 'pointer', at: i.cursor }
  if (i.crew) return { kind: 'crew', at: i.crew }
  return { kind: 'none', at: null }
}

/** The passive hover tooltip text: fieldAt's T_home at the pointer, labelled as an estimate; null = outside the field. */
export function hoverTipText(s: FieldSample | null): string | null {
  if (!s || !s.inside) return null
  const tHome = s.unknown ? null : s.tHome[s.variant]
  return tHome === null ? t('tooltips.hoverNoValue') : t('tooltips.hoverEstimate', { t_home: fmt1(tHome) })
}
