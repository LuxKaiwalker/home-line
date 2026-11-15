// Hash router (SPEC F17). Hash routes survive GitHub Pages (no SPA fallback) and work logged out.
// Pages: / (planning console), /mission (Mission Planer), /station/:id, /trade, /conditions, /scorecard, /cuff, /about.
// Mount slots for other workstreams: /hud (WS7), /hud3d (WS8), /nav (WS9).

export type Route =
  | { name: 'console' }
  | { name: 'station'; id: string }
  | { name: 'trade' }
  | { name: 'conditions' }
  | { name: 'scorecard'; key?: string }
  | { name: 'cuff' }
  | { name: 'about' }
  | { name: 'hud' }
  | { name: 'hud3d' }
  | { name: 'nav' }
  /** plan: a shared plan string (mission/share.ts); add: a station id to append as a waypoint */
  | { name: 'mission'; plan?: string; add?: string }
  | { name: 'notfound'; path: string }

const SIMPLE = ['trade', 'conditions', 'cuff', 'about', 'hud', 'hud3d', 'nav'] as const

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#/, '')
  const [pathPart, query = ''] = raw.split('?', 2)
  const path = '/' + pathPart.split('/').filter(Boolean).join('/')
  const segs = path.split('/').filter(Boolean)
  const params = new URLSearchParams(query)

  if (segs.length === 0) return { name: 'console' }
  const [head, ...rest] = segs
  if (head === 'station' && rest.length === 1) return { name: 'station', id: decodeURIComponent(rest[0]) }
  if (head === 'scorecard' && rest.length === 0) {
    const key = params.get('key')
    return key ? { name: 'scorecard', key } : { name: 'scorecard' }
  }
  if (head === 'mission' && rest.length === 0) {
    const r: Route = { name: 'mission' }
    const plan = params.get('plan')
    const add = params.get('add')
    if (plan) r.plan = plan
    if (add) r.add = add
    return r
  }
  if (rest.length === 0 && (SIMPLE as readonly string[]).includes(head)) {
    return { name: head as (typeof SIMPLE)[number] }
  }
  return { name: 'notfound', path }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'console':
      return '#/'
    case 'station':
      return `#/station/${encodeURIComponent(route.id)}`
    case 'scorecard':
      return route.key ? `#/scorecard?key=${encodeURIComponent(route.key)}` : '#/scorecard'
    case 'mission': {
      const q = new URLSearchParams()
      if (route.plan) q.set('plan', route.plan)
      if (route.add) q.set('add', route.add)
      const qs = q.toString()
      return qs ? `#/mission?${qs}` : '#/mission'
    }
    case 'notfound':
      return `#${route.path}`
    default:
      return `#/${route.name}`
  }
}

/** Top navigation, in display order. Slots (hud/hud3d/nav) are listed but owned by WS7/8/9. */
export const NAV_ITEMS: { route: Route; label: string }[] = [
  { route: { name: 'console' }, label: 'Plan' },
  { route: { name: 'mission' }, label: 'Mission Planer' },
  { route: { name: 'trade' }, label: 'Trade' },
  { route: { name: 'conditions' }, label: 'Conditions' },
  { route: { name: 'cuff' }, label: 'Cuff card' },
  { route: { name: 'hud' }, label: 'HUD' },
  { route: { name: 'hud3d' }, label: '3D' },
  { route: { name: 'nav' }, label: 'Navigation (optional)' }, // D19: optional add-on
  { route: { name: 'scorecard' }, label: 'Scorecard' },
  { route: { name: 'about' }, label: 'About' },
]
