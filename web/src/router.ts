// Hash router (SPEC F17). Hash routes survive GitHub Pages (no SPA fallback) and work logged out.
// Pages: / (planning console), /station/:id, /trade, /conditions, /scorecard, /cuff, /about.
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
  if (rest.length === 0 && (SIMPLE as readonly string[]).includes(head)) {
    return { name: head as (typeof SIMPLE)[number] }
  }
  return { name: 'notfound', path }
}

/** Unlinked dev page (WS16 M1 field-shader spike): never in NAV_ITEMS; main.ts lazy-loads it. */
export const isSpikeHash = (hash: string): boolean => /^#?\/spike\/?(\?|$)/.test(hash)

/** Unlinked dev page (WS15 A2 style guide, DESIGN U0): never in NAV_ITEMS; main.ts lazy-loads it. */
export const isStyleguideHash = (hash: string): boolean => /^#?\/styleguide\/?(\?|$)/.test(hash)

export function href(route: Route): string {
  switch (route.name) {
    case 'console':
      return '#/'
    case 'station':
      return `#/station/${encodeURIComponent(route.id)}`
    case 'scorecard':
      return route.key ? `#/scorecard?key=${encodeURIComponent(route.key)}` : '#/scorecard'
    case 'notfound':
      return `#${route.path}`
    default:
      return `#/${route.name}`
  }
}

/** Top navigation, in display order. Slots (hud/hud3d/nav) are listed but owned by WS7/8/9. */
export const NAV_ITEMS: { route: Route; label: string }[] = [
  { route: { name: 'console' }, label: 'Plan' },
  { route: { name: 'trade' }, label: 'Trade' },
  { route: { name: 'conditions' }, label: 'Conditions' },
  { route: { name: 'cuff' }, label: 'Cuff card' },
  { route: { name: 'hud' }, label: 'HUD' },
  { route: { name: 'hud3d' }, label: '3D' },
  { route: { name: 'nav' }, label: 'Navigation (optional)' }, // D19: optional add-on
  { route: { name: 'scorecard' }, label: 'Scorecard' },
  { route: { name: 'about' }, label: 'About' },
]
