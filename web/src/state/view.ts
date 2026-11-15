// L13 (team lead Sun 12:54, D111): which view (2D / 3D) Plan mode opens with.
//
//   1. the URL: ?view=2d or ?view=3d forces that view (CI screenshot tests use ?view=2d). A forced view
//      is not remembered (a test or a shared link never overwrites the viewer's own choice), and
//      ?view=3d also keeps the low-frame-rate fallback off (forced means forced; map/terrain).
//   2. this page session fell back to 2D for a low frame rate (D38) and the viewer has not asked for 3D
//      since: 2D, so every remount does not run 3 slow seconds again.
//   3. the viewer's last choice (2D/3D buttons or T), remembered through the layout store (package L1,
//      ui/layout/store.ts: the sanctioned per-viewer memory; it reaches browser storage once that store
//      is bound to it, until then it lasts for the page session).
//   4. config/design.yaml plan_view.default: 3d.
// No map and no DOM here: map/terrain applies the view and the open pose (plan_view.pitch_deg,
// bearing_deg); the tests call these in node.
import designRaw from '../../../config/design.yaml'
import { cfg } from '../config'
import { layout, registerContainer, setActiveTab } from '../ui/layout/store'

export type View = '2d' | '3d'

const isView = (v: unknown): v is View => v === '2d' || v === '3d'

/** config/design.yaml plan_view: the view Plan mode opens with, and its 3D camera. */
export const PLAN_VIEW = {
  default: cfg<View>(designRaw, 'plan_view.default'),
  pitch: cfg<number>(designRaw, 'plan_view.pitch_deg'),
  bearing: cfg<number>(designRaw, 'plan_view.bearing_deg'),
} as const
if (!isView(PLAN_VIEW.default)) throw new Error(`plan_view.default must be 2d or 3d, not ${String(PLAN_VIEW.default)}`)

/**
 * P4a: the camera pose the app opens with in `view`: in 3D the default tilt (plan_view.pitch_deg) and
 * bearing; in 2D pitch 0, north up (2D never tilts, RR1).
 */
export function openPose(view: View = '3d'): { pitch: number; bearing: number } {
  return view === '3d' ? { pitch: PLAN_VIEW.pitch, bearing: PLAN_VIEW.bearing } : { pitch: 0, bearing: 0 }
}

/** The layout-store entry that remembers the choice (a remembered "section" whose tab is the view). */
export const VIEW_PREF_ID = 'plan.view'

function loc(): { search: string; hash: string } {
  try {
    return typeof location === 'undefined' ? { search: '', hash: '' } : { search: location.search, hash: location.hash }
  } catch {
    return { search: '', hash: '' }
  }
}

/** ?view=2d|3d in the query string or in the hash route's query (#/?view=2d); null = none or another value. */
export function viewOverride(search = loc().search, hash = loc().hash): View | null {
  const q = hash.includes('?') ? hash.slice(hash.indexOf('?')) : ''
  for (const s of [search, q]) {
    const v = new URLSearchParams(s).get('view')
    if (isView(v)) return v
  }
  return null
}

function pref(): void {
  registerContainer({ id: VIEW_PREF_ID, kind: 'section', persist: true })
}

/** The viewer's remembered choice, or null when they never chose. */
export function rememberedView(): View | null {
  pref()
  const v = layout.tabs.peek()[VIEW_PREF_ID]
  return isView(v) ? v : null
}

let fellBack = false

/** The view Plan mode opens with (see the header for the order). */
export function planView(search?: string, hash?: string): View {
  return viewOverride(search, hash) ?? (fellBack ? '2d' : null) ?? rememberedView() ?? PLAN_VIEW.default
}

/** The viewer chose a view (2D/3D buttons, T): remember it, unless the URL forces one. */
export function rememberView(v: View): void {
  fellBack = false
  if (viewOverride()) return
  pref()
  setActiveTab(VIEW_PREF_ID, v)
}

/** The low-frame-rate fallback fired (D38): later mounts in this page session open in 2D. */
export function noteFallback(): void {
  fellBack = true
}

/** Tests only. */
export function resetPlanView(): void {
  fellBack = false
}
