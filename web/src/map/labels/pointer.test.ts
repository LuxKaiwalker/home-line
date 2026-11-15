// PORT F10: ground pointers (pointer.ts): the station-label leader mechanism for the port's markers.
import { describe, expect, it } from 'vitest'
import { LABELS, LEADER_LIFT_PX } from './config'
import { groundPointers, pointerOwners, TILTED_CLASS } from './pointer'

// vitest runs in 'node': a minimal element (class list + custom properties) is all pointer.ts touches
function el(): HTMLElement {
  const cls = new Set<string>()
  const props = new Map<string, string>()
  return {
    classList: { add: (c: string) => void cls.add(c), remove: (c: string) => void cls.delete(c), contains: (c: string) => cls.has(c), toggle: (c: string, on: boolean) => (on ? cls.add(c) : cls.delete(c), on) },
    style: { setProperty: (k: string, v: string) => void props.set(k, v), removeProperty: (k: string) => props.delete(k), getPropertyValue: (k: string) => props.get(k) ?? '' },
  } as unknown as HTMLElement
}

function fakeMap(pitch: number) {
  const c = el()
  const ls = new Map<string, Set<() => void>>()
  const map = {
    pitch,
    getPitch: () => map.pitch,
    getContainer: () => c,
    on: (ev: string, fn: () => void) => void (ls.get(ev) ?? ls.set(ev, new Set()).get(ev)!).add(fn),
    off: (ev: string, fn: () => void) => void ls.get(ev)?.delete(fn),
    fire: (ev: string) => ls.get(ev)?.forEach((f) => f()),
    listeners: () => [...ls.values()].reduce((n, s) => n + s.size, 0),
  }
  return { map, c }
}

describe('F10: ground pointers', () => {
  it('2D: no lift, no pointer; tilted past the leader pitch: the station lift (LEADER_LIFT_PX)', () => {
    const { map, c } = fakeMap(0)
    const dispose = groundPointers(map)
    expect(c.classList.contains(TILTED_CLASS)).toBe(false)
    expect(c.style.getPropertyValue('--hl-leader')).toBe('0px')
    map.pitch = LABELS.leaderLineMinPitchDeg + 10
    map.fire('pitch')
    expect(c.classList.contains(TILTED_CLASS)).toBe(true)
    expect(c.style.getPropertyValue('--hl-leader')).toBe(`${LEADER_LIFT_PX}px`)
    map.pitch = 0
    map.fire('pitchend')
    expect(c.classList.contains(TILTED_CLASS)).toBe(false)
    dispose()
  })

  it('one tracker per map, gone with its last owner', () => {
    const { map, c } = fakeMap(60)
    const a = groundPointers(map)
    const n = map.listeners()
    const b = groundPointers(map)
    expect(map.listeners()).toBe(n)
    a()
    a()
    expect(c.classList.contains(TILTED_CLASS)).toBe(true)
    b()
    expect(map.listeners()).toBe(0)
    expect(c.classList.contains(TILTED_CLASS)).toBe(false)
  })

  it('a stand-in map without pitch or container (unit tests elsewhere) is fine', () => {
    expect(() => groundPointers({})()).not.toThrow()
  })
  it('PORT F19: a panel remount keeps one tracker; resize re-syncs a wiped container (no stale cache)', () => {
    const { map, c } = fakeMap(60)
    let dispose = groundPointers(map)
    const n = map.listeners()
    for (let i = 0; i < 3; i++) {
      // unmount + remount (Route panel closed and reopened)
      dispose()
      expect(pointerOwners(map)).toBe(0)
      expect(map.listeners()).toBe(0)
      dispose = groundPointers(map)
      expect(pointerOwners(map)).toBe(1)
      expect(map.listeners()).toBe(n)
    }
    // a host re-render rewrote the container's class/style while the pitch did not change
    c.classList.remove(TILTED_CLASS)
    c.style.removeProperty('--hl-leader')
    map.fire('resize')
    expect(c.classList.contains(TILTED_CLASS)).toBe(true)
    expect(c.style.getPropertyValue('--hl-leader')).toBe(`${LEADER_LIFT_PX}px`)
    // 3D -> 2D seen at idle after a layout change
    map.pitch = 0
    map.fire('idle')
    expect(c.classList.contains(TILTED_CLASS)).toBe(false)
    dispose()
    expect(map.listeners()).toBe(0)
  })
})
