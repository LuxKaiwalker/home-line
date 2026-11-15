// L7c (D111): the mission clock as the "replay" player of the activity store (activity.ts).
// Whoever sets the mission clock playing while no player runs starts the replay (timeline Play,
// HUD Play, Space, ?field=play): the store stops it by pausing the clock. A refused start (a compute
// job runs) pauses the clock again at once. While the intro or the flythrough runs, the clock is theirs.
// toggleReplay() is what every Play control calls: it stops the flythrough / intro first, then plays.
import { canStart, end, start, activity, type Verdict } from './activity'
import type { ClockDriver } from './clock'
import { mission, missionClock } from './mission'

const pauseReplay = (): void => missionClock.pause()

let installed = false
/** Idempotent: the clock observer (called by every module that plays the mission clock). */
export function installActivityClock(): void {
  if (installed) return
  installed = true
  mission.clock.playing.subscribe((playing) => {
    const cur = activity.current.peek()
    if (playing) {
      if (cur !== null) return // the intro / flythrough / replay drives the clock
      if (!start('replay', pauseReplay).ok) missionClock.pause()
    } else if (cur === 'replay') end('replay', pauseReplay)
  })
}

/** Play / pause of the replay on the mission clock (or a view's private clock: no store). */
export function toggleReplay(clock: ClockDriver = missionClock): Verdict {
  if (clock !== missionClock) {
    clock.toggle()
    return { ok: true }
  }
  installActivityClock()
  const cur = activity.current.peek()
  if (cur === 'replay' || (cur === null && missionClock.playing)) {
    missionClock.pause()
    return { ok: true }
  }
  const v = canStart('replay')
  if (!v.ok) return v
  start('replay', pauseReplay)
  missionClock.play()
  return v
}
