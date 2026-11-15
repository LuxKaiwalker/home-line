// PORT F10: ground pointers for the port's map labels (pad markers, R4 route label and stop badges,
// R3 free-point handles). Same mechanism and style as the U13 station labels (layer.ts / labels.css):
// past labels.leader_line_min_pitch_deg the label floats LEADER_LIFT_PX (leaderLift) above its point
// and a thin yellow leader line runs down to a small ground dot. The point is the MapLibre marker's
// own anchor, which MapLibre places on the terrain (elevation-aware projection), so the pointer
// ends on the ground at the label's lng/lat. In 2D (no tilt) the lift is 0: no pointer, the labels
// keep their flat placement.
import { leaderLift } from './model'
import './labels.css'

/** The bits of the MapLibre map the tracker needs (tests pass a stand-in). */
export interface PointerMap {
  getPitch?(): number
  getContainer?(): HTMLElement
  on?(ev: string, fn: () => void): unknown
  off?(ev: string, fn: () => void): unknown
}

/** Map container class while the view is tilted past the leader-line pitch. */
export const TILTED_CLASS = 'hl-tilted'
/** Attribute of a marker element that gets a ground pointer (an attribute: owners rewrite their classes). */
export const GROUND_ATTR = 'data-hl-ground'

const tracked = new WeakMap<object, { users: number; stop: () => void }>()

/** PORT F19: the map's tilt-tracker owners (0 = none); one shared tracker per map, as F10 intended. */
export function pointerOwners(map: PointerMap): number {
  return tracked.get(map)?.users ?? 0
}

// PORT F19: everything that can change the lift or wipe the container state. 'resize' and 'idle'
// cover layout changes (panels opened/closed, drawers, 2D/3D) and a remounted panel; nothing is cached
// across them: each sync reads the pitch and the container's actual state.
const EVENTS = ['pitch', 'pitchend', 'terrain', 'resize', 'idle'] as const

/** Keep the map container's tilt state (class + --hl-leader) in step with the pitch; ref-counted per map. */
function track(map: PointerMap): () => void {
  const c = map.getContainer?.()
  if (!c || !map.getPitch) return () => {}
  let t = tracked.get(map)
  if (!t) {
    const sync = () => {
      // read the live pitch and the live DOM (an owner re-render can rewrite the container's class
      // or style): no stale last-lift cache
      const lift = leaderLift(map.getPitch!())
      const on = lift > 0
      if (c.classList.contains(TILTED_CLASS) !== on) c.classList.toggle(TILTED_CLASS, on)
      const v = `${lift}px`
      if (c.style.getPropertyValue('--hl-leader') !== v) c.style.setProperty('--hl-leader', v)
    }
    sync()
    for (const ev of EVENTS) map.on?.(ev, sync)
    const entry = {
      users: 0,
      stop: () => {
        for (const ev of EVENTS) map.off?.(ev, sync)
        c.classList.remove(TILTED_CLASS)
        c.style.removeProperty('--hl-leader')
      },
    }
    tracked.set(map, entry)
    t = entry
  }
  t.users++
  const entry = t
  let done = false
  return () => {
    if (done) return
    done = true
    if (--entry.users > 0) return
    entry.stop()
    if (tracked.get(map) === entry) tracked.delete(map)
  }
}

/**
 * Ground pointers on a map: marker elements (anchor center, the MapLibre default) that carry
 * GROUND_ATTR get the pointer while the view is tilted. Call once per owner (an extension's
 * install); the returned dispose stops the map's tilt tracking once its last owner is gone. A marker
 * with a vertical offset sets --hl-ground-offset to it in CSS, so the pointer still ends on the point.
 */
export function groundPointers(map: PointerMap): () => void {
  return track(map)
}
