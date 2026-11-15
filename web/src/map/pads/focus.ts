// PORT F9: focus a pad from outside the map (the Route panel's "Start pad" picker): fly the installed map
// (padLayer.map, set by the pad layer's extension install) to the pad and open its pop-up card, the same
// card a click on the pad marker opens. The pad markers have no zoom of their own, so PAD_FOCUS_ZOOM is
// the pad's close-up (the pad and a few hundred metres around it; never zooms out a closer view).
// The camera centres the pad in the map area left free by the open drawers (layoutInsets, as an offset:
// a flyTo padding would stay on the map); reduced motion jumps (easeTo with duration 0 keeps the offset).
import { layoutInsets, type LayoutInsets } from '../../ui/layout'
import { motionMs } from '../../ui/tokens'
import { ui } from '../../state/ui'
import type { PadId } from '../../pads/types'
import { openPadCard, padLayer } from './padLayer'

/** Close-up zoom of a pad (about 900 m across a 1000 px map at Gale). */
export const PAD_FOCUS_ZOOM = 16.5

type CameraTarget = { center: [number, number]; zoom: number; offset: [number, number]; duration: number }
export interface PadFocusMap {
  getZoom(): number
  getMaxZoom?(): number
  flyTo(o: CameraTarget & { essential?: boolean }): unknown
  easeTo(o: CameraTarget): unknown
}

/** The camera target for a pad: its close-up zoom, centred in the uncovered map area. */
export function padCamera(p: { lon: number; lat: number }, zoom: number, insets: LayoutInsets, maxZoom = Infinity, duration = 0): CameraTarget {
  return {
    center: [p.lon, p.lat],
    zoom: Math.min(Math.max(zoom, PAD_FOCUS_ZOOM), maxZoom),
    offset: [-(insets.right || 0) / 2, -(insets.bottom || 0) / 2],
    duration,
  }
}

/** Fly the map to the pad (jump under reduced motion). False when no map is installed. */
export function flyToPad(p: { lon: number; lat: number }, map = padLayer.map.peek() as unknown as PadFocusMap | null, reduced = ui.reducedMotion.peek()): boolean {
  if (!map?.flyTo) return false
  const cam = padCamera(p, map.getZoom(), layoutInsets.peek(), map.getMaxZoom?.() ?? Infinity, reduced ? 0 : motionMs('cameraMs', 'max', false))
  if (reduced) map.easeTo(cam)
  else map.flyTo({ ...cam, essential: true })
  return true
}

/** Fly to the pad and open its pop-up card (opener: focus goes back there when the card closes). */
export function focusPad(p: { id: PadId; lon: number; lat: number }, opener: HTMLElement | null = null): void {
  if (!flyToPad(p)) return // no map (tests, story): nothing to frame and no card anchor
  openPadCard(p.id, opener)
}
