// L7c (D111): the activity store's rules (state/activity.ts) and the mission clock as the replay
// player (state/activityClock.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activity, beginJob, canStart, confirmInputChange, controlState, end, endJob, lastStop, noteEdit, PLAYERS, resetActivity, setConfirm, start, stop, type Player } from './activity'
import { installActivityClock, toggleReplay } from './activityClock'
import { missionClock } from './mission'
import { PlaybackClock } from './clock'
import { t } from '../ui/copy'
import { ui } from './ui'

beforeEach(() => {
  missionClock.pause()
  missionClock.seek(0)
  ui.mode.value = 'plan'
  resetActivity()
})
afterEach(() => {
  missionClock.pause()
  resetActivity()
})

/** A fake player: start registers it, its stop records the call. */
function player(kind: Player) {
  const p = { kind, stopped: 0, stop: () => void p.stopped++ }
  return p
}

describe('one player at a time', () => {
  for (const a of PLAYERS)
    for (const b of PLAYERS) {
      if (a === b || b === 'intro') continue
      it(`${a} then ${b}: ${a} stopped once, ${b} runs`, () => {
        const A = player(a)
        const B = player(b)
        expect(start(a, A.stop).ok).toBe(true)
        expect(activity.current.peek()).toBe(a)
        expect(start(b, B.stop).ok).toBe(true)
        expect(A.stopped).toBe(1)
        expect(B.stopped).toBe(0)
        expect(activity.current.peek()).toBe(b)
        expect(lastStop.peek()).toEqual({ kind: a, by: b })
        // A's late end report does not end B
        end(a, A.stop)
        expect(activity.current.peek()).toBe(b)
      })
    }

  it('the intro never takes over a player the viewer started', () => {
    const R = player('replay')
    start('replay', R.stop)
    const v = canStart('intro')
    expect(v).toEqual({ ok: false, reason: 'activity.reason.busy' })
    expect(start('intro', () => undefined).ok).toBe(false)
    expect(R.stopped).toBe(0)
    expect(activity.current.peek()).toBe('replay')
  })

  it('stopping the old player happens before the new one is current (synchronous)', () => {
    const seen: (Player | null)[] = []
    start('flythrough', () => seen.push(activity.current.peek()))
    start('replay', () => undefined)
    expect(seen).toEqual([null])
  })

  it('end() ends only the running player; stop() stops it', () => {
    const F = player('flythrough')
    start('flythrough', F.stop)
    end('replay')
    expect(activity.current.peek()).toBe('flythrough')
    stop()
    expect(F.stopped).toBe(1)
    expect(activity.current.peek()).toBe(null)
  })

  it('mirrors the state on <html data-activity> and data-job', () => {
    const dataset: Record<string, string> = {}
    vi.stubGlobal('document', { documentElement: { dataset } })
    try {
      start('flythrough', () => undefined)
      expect(dataset.activity).toBe('flythrough')
      stop()
      expect(dataset.activity).toBe('none')
      beginJob('j')
      expect(dataset.job).toBe('j')
      endJob('j')
      expect(dataset.job).toBe('none')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('editing and mode switch stop players', () => {
  it('an edit stops the running player', () => {
    const F = player('flythrough')
    start('flythrough', F.stop)
    noteEdit()
    expect(F.stopped).toBe(1)
    expect(activity.current.peek()).toBe(null)
    expect(lastStop.peek()?.by).toBe('edit')
  })

  it('a mode switch stops the running player; the first mode set and same mode do not', () => {
    const R = player('replay')
    start('replay', R.stop)
    ui.mode.value = 'plan'
    expect(R.stopped).toBe(0)
    ui.mode.value = 'fly'
    expect(R.stopped).toBe(1)
    expect(lastStop.peek()?.by).toBe('mode')
    expect(activity.current.peek()).toBe(null)
  })
})

describe('compute job', () => {
  it('no player starts while a job runs (its partial result is not replayable)', () => {
    expect(beginJob('job-1').ok).toBe(true)
    for (const k of PLAYERS) {
      expect(canStart(k)).toEqual({ ok: false, reason: 'activity.reason.jobRunning' })
      expect(start(k, () => undefined).ok).toBe(false)
      const st = controlState(k)
      expect(st.enabled).toBe(false)
      expect(st.title).toBe(t('activity.reason.jobRunning'))
    }
    expect(activity.current.peek()).toBe(null)
    endJob('job-1')
    for (const k of PLAYERS) expect(canStart(k).ok).toBe(true)
  })

  it('a job beginning stops the running player', () => {
    const R = player('replay')
    start('replay', R.stop)
    beginJob('job-1')
    expect(R.stopped).toBe(1)
    expect(lastStop.peek()?.by).toBe('job')
  })

  it('one job per viewer: a second job is refused; the same id again is fine', () => {
    expect(beginJob('a').ok).toBe(true)
    expect(beginJob('b')).toEqual({ ok: false, reason: 'activity.reason.jobBusy' })
    expect(beginJob('a').ok).toBe(true)
    expect(activity.job.peek()).toBe('a')
    endJob('b') // not the running job: no-op
    expect(activity.jobActive.peek()).toBe(true)
    endJob('a')
    expect(activity.jobActive.peek()).toBe(false)
    expect(beginJob('b').ok).toBe(true)
  })

  it('changing inputs mid-job asks first: no keeps the job, yes cancels it', () => {
    expect(confirmInputChange()).toBe(true) // no job: no question
    const cancel = vi.fn()
    beginJob('a', { cancel })
    const ask = vi.fn(() => false)
    setConfirm(ask)
    expect(confirmInputChange()).toBe(false)
    expect(ask).toHaveBeenCalledWith(t('activity.confirm.inputChange'))
    expect(cancel).not.toHaveBeenCalled()
    expect(activity.jobActive.peek()).toBe(true)
    setConfirm(() => true)
    expect(confirmInputChange()).toBe(true)
    expect(cancel).toHaveBeenCalledOnce()
    expect(activity.jobActive.peek()).toBe(false)
  })
})

describe('the mission clock is the replay player', () => {
  beforeEach(() => installActivityClock())

  it('Play starts the replay; Play again stops it', () => {
    expect(toggleReplay().ok).toBe(true)
    expect(missionClock.playing).toBe(true)
    expect(activity.current.peek()).toBe('replay')
    toggleReplay()
    expect(missionClock.playing).toBe(false)
    expect(activity.current.peek()).toBe(null)
  })

  it('anyone playing the clock with no player running starts the replay', () => {
    missionClock.play()
    expect(activity.current.peek()).toBe('replay')
    missionClock.pause()
    expect(activity.current.peek()).toBe(null)
  })

  it('the clock reaching its end ends the replay', () => {
    toggleReplay()
    missionClock.tick(1e12)
    expect(missionClock.playing).toBe(false)
    expect(activity.current.peek()).toBe(null)
  })

  it('Play during the flythrough stops the flythrough first, then replays', () => {
    let flying = true
    const stopFly = () => {
      flying = false
      missionClock.pause() // fly.ts stop()
    }
    start('flythrough', stopFly)
    missionClock.play() // the flythrough drives the clock: not a replay
    expect(activity.current.peek()).toBe('flythrough')
    expect(controlState('replay').running).toBe(false)
    toggleReplay()
    expect(flying).toBe(false)
    expect(missionClock.playing).toBe(true)
    expect(activity.current.peek()).toBe('replay')
  })

  it('the flythrough starting stops the replay (clock paused, then the flight plays it)', () => {
    toggleReplay()
    const F = player('flythrough')
    start('flythrough', F.stop)
    expect(missionClock.playing).toBe(false)
    expect(lastStop.peek()).toEqual({ kind: 'replay', by: 'flythrough' })
  })

  it('a job refuses Play, and a clock started behind the store is paused again', () => {
    beginJob('a')
    expect(toggleReplay()).toEqual({ ok: false, reason: 'activity.reason.jobRunning' })
    expect(missionClock.playing).toBe(false)
    missionClock.play() // e.g. a shortcut that bypassed the store
    expect(missionClock.playing).toBe(false)
    expect(activity.current.peek()).toBe(null)
  })

  it('an edit and a mode switch pause the replay', () => {
    toggleReplay()
    noteEdit()
    expect(missionClock.playing).toBe(false)
    toggleReplay()
    ui.mode.value = 'report'
    expect(missionClock.playing).toBe(false)
    expect(activity.current.peek()).toBe(null)
  })

  it("a view's private clock is not the store's", () => {
    const c = new PlaybackClock(10, [1, 60], 60)
    expect(toggleReplay(c).ok).toBe(true)
    expect(c.playing).toBe(true)
    expect(activity.current.peek()).toBe(null)
  })
})
