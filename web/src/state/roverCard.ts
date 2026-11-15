// Rover card seam (L2d, D111; L0 row 14). The rover drag's delta strip ("What this change costs",
// Keep / Discard) used to sit in the right sidebar. When a map view hosts it (Plan: views/planStation.tsx
// shows it in a small MarkerCard anchored to the rover), edit/roverMap.ts publishes the strip here
// instead of opening the sidebar. Nothing hosts it → the old sidebar path (unchanged).
// L3 later owns the rover MarkerCard (pad tool); it can take this signal over as one of its parts.
import type { ComponentChildren } from 'preact'
import { signal, type ReadSignal } from './signal'

export interface RoverStrip {
  /** the delta strip (same component as in the sidebar) */
  render: () => ComponentChildren
  /** where the rover rests now (the card anchor) */
  lngLat: [number, number]
  /** the user closed the card without Keep: the same as Discard (Escape did that in the sidebar) */
  dismiss: () => void
}

const strip = signal<RoverStrip | null>(null)
const hosts = signal(0)

/** The released draft's strip, or null. */
export const roverStrip: ReadSignal<RoverStrip | null> = strip
export const roverCardHosted = (): boolean => hosts.peek() > 0

/** A view shows the strip itself (the sidebar stays out of it) while hosted; returns off. */
export function hostRoverCard(): () => void {
  hosts.value = hosts.peek() + 1
  let on = true
  return () => {
    if (!on) return
    on = false
    hosts.value = Math.max(0, hosts.peek() - 1)
  }
}

export function setRoverStrip(s: RoverStrip | null): void {
  strip.value = s
}
