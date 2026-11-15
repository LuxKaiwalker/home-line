// WS16 task 10 (M10): the live flythrough (DESIGN U6 "Flythrough"): 3D on, the mission clock plays
// (its speed is the control's), and the camera follows the route on every clock change, so the
// timeline scrubs it too. Any input on the map cancels it at once (DESIGN §3.4); hover does not.
// L10 (D111): a chase camera behind and above the crew (path.ts chasePose); the route (with the crew
// marker) and the stations are switched on for the flight and put back after it; reduced motion cuts
// to the crew every camera.flythrough.reduced_cut_s seconds instead of gliding.
// Loaded with import() on the first press of the Flythrough button.
import type { Map as MlMap } from 'maplibre-gl'
import { CONFIG } from '../../config'
import { effect, mission, missionClock, ui } from '../../state'
import { CHASE, ELEVATION_FACTOR } from '../../story/config'
import type { LayerGroup } from '../consoleMap'
import { exaggeration, setView } from '../terrain/state'
import { jumpToPose } from './camera'
import { loadFlightPath } from './route'

const INPUTS = ['pointerdown', 'wheel', 'touchstart', 'keydown'] as const

/** Layer-group access of the console map (the flight shows these and restores them). */
export interface FlyLayers {
  get(g: LayerGroup): boolean
  set(g: LayerGroup, on: boolean): void
}

/** Groups the flythrough draws: the route (legs, turn-back ticks, crew marker) and the stations. */
export const FLY_GROUPS: readonly LayerGroup[] = ['route', 'stations']

/**
 * Reduced-motion gate for the live follow: true when the camera should move now. Playing, it lets one
 * cut through every `cutMs` of wall time; a paused clock (a scrub) always moves. Pure, for the tests.
 */
export function cutGate(cutMs: number): (now: number, playing: boolean) => boolean {
  let last = -Infinity
  return (now, playing) => {
    if (playing && now - last < cutMs) return false
    last = now
    return true
  }
}

export async function startFlythrough(map: MlMap, onEnd: () => void, layers?: FlyLayers): Promise<{ stop(): void } | null> {
  const fp = await loadFlightPath().catch((e) => {
    console.warn('flythrough unavailable:', e)
    return null
  })
  if (!fp) {
    onEnd()
    return null
  }
  setView('3d')
  const savedLayers = layers ? FLY_GROUPS.map((g) => [g, layers.get(g)] as const) : []
  for (const [g, on] of savedLayers) if (!on) layers?.set(g, true)
  if (missionClock.t >= fp.plan.tEnd) missionClock.seek(0)
  missionClock.play()
  const el = map.getContainer()
  el.setAttribute('data-flythrough', 'on')
  let raf = 0
  let last = -1
  let stopped = false
  const gate = cutGate(CHASE.reducedCutS * 1000)
  const stopFollow = effect(() => {
    const tm = mission.clock.t.value
    const playing = mission.clock.playing.value
    if (ui.reducedMotion.value && !gate(performance.now(), playing)) return
    jumpToPose(map, fp.poseAt(tm), { factor: ELEVATION_FACTOR, exaggeration: exaggeration(), radiusM: CONFIG.marsRadiusM })
  })
  // the button itself lives in the map container: input on the controls does not cancel
  const onInput = (e: Event): void => {
    if ((e.target as Element | null)?.closest?.('.maplibregl-ctrl')) return
    stop()
  }
  const stop = (): void => {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(raf)
    stopFollow()
    for (const ev of INPUTS) el.removeEventListener(ev, onInput, true)
    missionClock.pause()
    for (const [g, on] of savedLayers) if (!on) layers?.set(g, false)
    el.removeAttribute('data-flythrough')
    onEnd()
  }
  // the planning map has no other clock ticker (A3: one ticker at a time)
  const frame = (now: number): void => {
    if (stopped) return
    if (last >= 0) missionClock.tick(now - last)
    last = now
    if (missionClock.t >= fp.plan.tEnd) return stop()
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  for (const ev of INPUTS) el.addEventListener(ev, onInput, { capture: true, passive: true })
  return { stop }
}
