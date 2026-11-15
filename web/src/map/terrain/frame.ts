// L13 (team lead 12:54, D111): Plan mode's open pose in 3D (config/design.yaml plan_view.pitch_deg,
// bearing_deg) with a box (the AOI focus, the pad and the route's stations: ConsoleMap.fitTo) in view.
// MapLibre's cameraForBounds fits the box as seen from straight above; tilted, the near half of the
// box grows on screen, so the zoom steps out until every corner and edge midpoint projects inside the
// padded canvas. Pure apart from the map calls (a fake map in the tests).

export interface FrameMap {
  cameraForBounds(b: [[number, number], [number, number]], o: { padding: number; bearing: number }): { center?: unknown; zoom?: number } | undefined
  jumpTo(o: { center?: [number, number]; zoom?: number; pitch?: number; bearing?: number }): unknown
  easeTo(o: { center: [number, number]; zoom: number; pitch: number; bearing: number; duration: number }): unknown
  project(p: [number, number]): { x: number; y: number }
  getCanvas(): { clientWidth: number; clientHeight: number }
  getCenter(): { lng: number; lat: number }
  getZoom(): number
  getPitch(): number
  getBearing(): number
}

export interface Pose {
  pitch: number
  bearing: number
}

/** Zoom step (levels) and the most steps taken (3 zoom levels out at most). */
export const FRAME_STEP = 0.25
export const FRAME_MAX_STEPS = 12

/** [w, s, e, n] -> the corners and edge midpoints that must be on screen. */
export function framePoints([w, s, e, n]: [number, number, number, number]): [number, number][] {
  const mx = (w + e) / 2
  const my = (s + n) / 2
  return [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [mx, s],
    [mx, n],
    [w, my],
    [e, my],
  ]
}

function centerOf(c: unknown): [number, number] | null {
  if (!c) return null
  const v = c as [number, number] | { lng?: number; lon?: number; lat: number }
  const xy: [number, number] = Array.isArray(v) ? [v[0], v[1]] : [v.lng ?? v.lon ?? NaN, v.lat]
  return xy.every(Number.isFinite) ? xy : null
}

/**
 * The camera for `box` at `pose`, every frame point inside the canvas less `padding`. Probes with
 * jumpTo and puts the camera back; null when MapLibre cannot fit the box.
 */
export function pitchedCamera(map: FrameMap, box: [number, number, number, number], pose: Pose, padding: number): { center: [number, number]; zoom: number; pitch: number; bearing: number } | null {
  const cam = map.cameraForBounds(
    [
      [box[0], box[1]],
      [box[2], box[3]],
    ],
    { padding, bearing: pose.bearing },
  )
  const center = centerOf(cam?.center)
  if (!cam || cam.zoom === undefined || !center) return null
  const was = { center: [map.getCenter().lng, map.getCenter().lat] as [number, number], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }
  const pts = framePoints(box)
  const { clientWidth: w, clientHeight: h } = map.getCanvas()
  const inside = (): boolean =>
    pts.every((p) => {
      const q = map.project(p)
      return Number.isFinite(q.x) && Number.isFinite(q.y) && q.x >= padding - 0.5 && q.x <= w - padding + 0.5 && q.y >= padding - 0.5 && q.y <= h - padding + 0.5
    })
  let zoom = cam.zoom
  for (let i = 0; i < FRAME_MAX_STEPS; i++) {
    map.jumpTo({ center, zoom, ...pose })
    if (inside()) break
    zoom -= FRAME_STEP
  }
  map.jumpTo(was)
  return { center, zoom, ...pose }
}

/** Move to the pitched camera for `box` (eased when `animate`); false when the box cannot be fitted. */
export function framePitched(map: FrameMap, box: [number, number, number, number], pose: Pose, padding: number, animate: boolean, durationMs: number): boolean {
  const to = pitchedCamera(map, box, pose, padding)
  if (!to) return false
  if (animate) map.easeTo({ ...to, duration: durationMs })
  else map.jumpTo(to)
  return true
}
