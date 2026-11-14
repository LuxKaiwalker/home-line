// WS5 mount slot for /nav (web/src/views/slot.ts): export mount(el, ctx) -> cleanup.
// Also the integration points for WS7 (/hud) and WS8 (/hud3d): navReading / navLine (the HUD
// position line), the nav loader, ellipse geometry and the D_max field decoder.
import type { ViewContext } from '../views/slot'
import { mountNav } from './page'

export { mountNav, type NavContext } from './page'
export { createNavLoader, slotFetcher, SUMMARY_PATH, type NavLoader } from './load'
export { navReading, navLine, fmtEva, type NavReading } from './navstate'
export { ellipseRingENU, ellipseRingLonLat, insideEllipse, ellipseBBox, majorAxis, sphereMetric } from './geom'
export { rowAt, lastFix, nextFix, filterFixes, interpAlong, trackLine, lineWithTimes, ellipsesUpTo, routeKnots } from './series'
export { classLabels, classOf, classifyRGBA, decodeRGBA, valueAt, type DecodedField } from './fixclass'
export { NAV } from './config'
export type * from './types'

export async function mount(el: HTMLElement, ctx: ViewContext): Promise<() => void> {
  return mountNav(el, { dataUrl: ctx.dataUrl, dataMode: ctx.dataMode })
}
