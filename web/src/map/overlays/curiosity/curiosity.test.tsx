// L1b acceptance, fetch mocked: off by default and no request until the user turns it on; the toggle
// with "live NASA data" and the privacy note naming mars.nasa.gov; layers hidden until NASA answered;
// a click on a drive end opens the card (and wins over route editing); "unavailable" with retry;
// the card's Mastcam note, lazy thumbnails and alt text from the image metadata.
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installMapExtensions, mapControlsIn, registerEditHandlers, resetMapExtensions, type MapExtensionContext } from '../../extensions'
import { isOpen, resetLayout } from '../../../ui/layout'
import { all, byClass, byTag, installDom, type FakeNode } from '../../../ui/testing/dom'
import { color } from '../../../ui/tokens'
import { StopPhotos } from './Card'
import { ct } from './copy'
import ownCopy from './copy.L1b.json'
import { install } from './install'
import { CURIOSITY_LAYERS, CURIOSITY_SOURCES } from './layer'
import { MSL_TRAVERSE_URL, MSL_WAYPOINTS_URL, NASA_HOST, RAW_IMAGE_API, resetNasaCache, type Bounds, type DriveEnd } from './nasa'
import { CURIOSITY_CARD, curiosityOn, curiositySelected, curiosityStatus, resetCuriosity, setCuriosityBounds, setCuriosityEnabled, setCuriosityOn } from './store'

const B: Bounds = [137.3, -4.9, 137.45, -4.7]
const wp = (sol: number, site: number, drive: number, lon: number, lat: number) => ({ type: 'Feature', properties: { RMC: `${site}_${drive}`, sol, site, drive, lon, lat, dist_m: 12, dist_total_m: 34000 }, geometry: { type: 'Point', coordinates: [lon, lat] } })
const WAYPOINTS = { features: [wp(4190, 107, 2054, 137.41, -4.79), wp(4200, 107, 2484, 137.4, -4.78), wp(10, 3, 0, 137.44, -4.59)] }
const TRAVERSE = { features: [{ geometry: { type: 'LineString', coordinates: [[137.41, -4.79], [137.4, -4.78]] } }] }
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response

function fakeMap(container?: FakeNode) {
  const layers = new Map<string, { layout: Record<string, unknown>; paint: Record<string, unknown>; filter?: unknown; before?: string }>()
  const data = new Map<string, unknown>()
  const handlers = new Map<string, (e: unknown) => void>()
  const canvas = { style: { cursor: '' } }
  let rendered: { properties: Record<string, unknown> }[] = []
  const map = {
    on: (t: string, f: (e: unknown) => void) => handlers.set(t, f),
    off: (t: string) => handlers.delete(t),
    getCanvas: () => canvas,
    addSource: (id: string, s: { data: unknown }) => data.set(id, s.data),
    getSource: (id: string) => (data.has(id) ? { setData: (d: unknown) => data.set(id, d) } : undefined),
    removeSource: (id: string) => data.delete(id),
    addLayer: (l: { id: string; layout?: Record<string, unknown>; paint?: Record<string, unknown>; filter?: unknown }, before?: string) => layers.set(l.id, { layout: { ...l.layout }, paint: { ...l.paint }, filter: l.filter, before }),
    getLayer: (id: string) => layers.get(id),
    removeLayer: (id: string) => layers.delete(id),
    setLayoutProperty: (id: string, k: string, v: unknown) => (layers.get(id)!.layout[k] = v),
    setPaintProperty: (id: string, k: string, v: unknown) => (layers.get(id)!.paint[k] = v),
    setFilter: (id: string, f: unknown) => (layers.get(id)!.filter = f),
    ...(container ? { getContainer: () => container, project: () => ({ x: 5, y: 5 }) } : {}),
    queryRenderedFeatures: (_box: unknown, opts: { layers: string[] }) => (opts.layers.includes(CURIOSITY_LAYERS.stops) ? rendered : []),
  }
  const ctx = { map, beforeId: (slot: string) => (slot === 'overlay' ? 'iso-lines' : undefined), marker: () => ({}), inShell: true } as unknown as MapExtensionContext
  const fire = (t: string) => handlers.get(t)?.({ lngLat: { lng: 137.4, lat: -4.78 }, point: { x: 10, y: 10 }, originalEvent: { button: 0 } })
  const vis = (id: string) => layers.get(id)?.layout.visibility
  return { ctx, layers, data, fire, vis, canvas, setRendered: (r: typeof rendered) => (rendered = r) }
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => void (await Promise.resolve()))
}

let fetchMock: ReturnType<typeof vi.fn>
let root: FakeNode
beforeEach(() => {
  ;({ container: root } = installDom())
  resetNasaCache()
  resetCuriosity()
  resetLayout()
  setCuriosityBounds(async () => B)
  fetchMock = vi.fn(async (u: string) => (u === MSL_WAYPOINTS_URL ? ok(WAYPOINTS) : u === MSL_TRAVERSE_URL ? ok(TRAVERSE) : ok({ items: [], more: false })))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  render(null, root as unknown as Element)
  resetMapExtensions()
  resetCuriosity()
  vi.unstubAllGlobals()
})

const renderControl = () => {
  const c = mapControlsIn('layers-popover').find((x) => x.id === 'curiosity')!
  act(() => render(<>{c.render()}</>, root as unknown as Element))
}
const toggle = () => byClass(root, 'hl-toggle')[0]

describe('off by default: zero requests', () => {
  it('registers the overlay (defaultOn false) and the popover row; installing on the map fetches nothing', async () => {
    const off = install()
    expect(install()).toBe(off) // idempotent
    const m = fakeMap()
    const host = installMapExtensions(m.ctx)
    renderControl()
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(host.overlay('curiosity')).toBeDefined()
    expect(curiosityOn.peek()).toBe(false)
    // layers exist (empty, hidden) in the overlay slot
    for (const id of Object.values(CURIOSITY_LAYERS)) expect(m.vis(id)).toBe('none')
    expect(m.layers.get(CURIOSITY_LAYERS.line)!.before).toBe('iso-lines')
    expect(m.data.get(CURIOSITY_SOURCES.stops)).toEqual({ type: 'FeatureCollection', features: [] })
    // the toggle is off; "live NASA data" and the privacy note naming mars.nasa.gov sit next to it
    expect(toggle().getAttribute('aria-checked')).toBe('false')
    expect(root.textContent).toContain(ct('curiosity.live'))
    expect(ct('curiosity.live')).toBe('live NASA data')
    expect(byClass(root, 'hl-curiosity__privacy')[0].textContent).toContain(NASA_HOST)
    host.destroy()
    off()
  })

  it('the flag off: no layer, no row, and turning it on does nothing', async () => {
    const off = install()
    setCuriosityEnabled(false)
    const host = installMapExtensions(fakeMap().ctx)
    renderControl()
    setCuriosityOn(true)
    await flush()
    expect(host.overlay('curiosity')).toBeUndefined()
    expect(root.textContent).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
    host.destroy()
    off()
  })
})

describe('turned on', () => {
  it('loads the drive ends + traverse once, shows them in the live colour, counts them in the row', async () => {
    const off = install()
    const m = fakeMap()
    const host = installMapExtensions(m.ctx)
    renderControl()
    act(() => void toggle().dispatch('click', {}))
    expect(root.textContent).toContain(ct('curiosity.loading'))
    await flush()
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([MSL_TRAVERSE_URL, MSL_WAYPOINTS_URL].sort())
    expect(curiosityStatus.peek().kind).toBe('ready')
    for (const id of Object.values(CURIOSITY_LAYERS)) expect(m.vis(id)).toBe('visible')
    expect((m.data.get(CURIOSITY_SOURCES.stops) as { features: unknown[] }).features).toHaveLength(2) // sol 10 is outside
    expect(m.layers.get(CURIOSITY_LAYERS.stops)!.paint['circle-color']).toBe(color('live'))
    expect(root.textContent).toContain(ct('curiosity.stops', { n: 2, first: 4190, last: 4200 }))
    // off and on again: hidden, then shown from memory (no new request)
    act(() => void toggle().dispatch('click', {}))
    expect(m.vis(CURIOSITY_LAYERS.stops)).toBe('none')
    act(() => void toggle().dispatch('click', {}))
    await flush()
    expect(m.vis(CURIOSITY_LAYERS.stops)).toBe('visible')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // the host's overlay handle drives the same state
    host.overlay('curiosity')!.setVisible(false)
    expect(curiosityOn.peek()).toBe(false)
    host.destroy()
    expect(m.layers.size).toBe(0)
    off()
  })

  it('a click on a drive end opens its card and is consumed before route editing; elsewhere it is not', async () => {
    const off = install()
    const log: string[] = []
    registerEditHandlers({ id: 'route', click: () => (log.push('route'), true) })
    const m = fakeMap()
    const host = installMapExtensions(m.ctx)
    setCuriosityOn(true)
    await flush()
    m.setRendered([{ properties: { i: 1 } }])
    m.fire('mousemove')
    m.fire('click')
    expect(log).toEqual([])
    expect(curiositySelected.peek()).toBe(1)
    expect(isOpen(CURIOSITY_CARD)).toBe(true)
    expect(m.canvas.style.cursor).toBe('pointer')
    expect(m.layers.get(CURIOSITY_LAYERS.selected)!.filter).toEqual(['==', ['get', 'i'], 1])
    m.setRendered([])
    m.fire('click')
    expect(log).toEqual(['route'])
    // turning the layer off closes the card; a click then never hits a drive end
    setCuriosityOn(false)
    expect(isOpen(CURIOSITY_CARD)).toBe(false)
    m.setRendered([{ properties: { i: 0 } }])
    m.fire('click')
    expect(log).toEqual(['route', 'route'])
    host.destroy()
    off()
  })
})

describe('card in the map container', () => {
  it('a drive-end click renders the MarkerCard (title from the stop) inside the map; destroy removes it', async () => {
    const off = install()
    const mapEl = (globalThis as unknown as { document: { createElement(n: string): FakeNode } }).document.createElement('div')
    root.appendChild(mapEl)
    const m = fakeMap(mapEl)
    const host = installMapExtensions(m.ctx)
    setCuriosityOn(true)
    await flush()
    expect(byClass(mapEl, 'hl-curiosity-card')).toHaveLength(0)
    m.setRendered([{ properties: { i: 1 } }])
    act(() => m.fire('click'))
    await flush()
    const card = byClass(mapEl, 'hl-curiosity-card')
    expect(card).toHaveLength(1)
    expect(card[0].textContent).toContain(ct('curiosity.card.title', { rmc: '107_2484', sol: 4200 }))
    expect(card[0].getAttribute('role')).toBe('dialog')
    host.destroy()
    expect(byClass(mapEl, 'hl-curiosity-host')).toHaveLength(0)
    off()
  })
})

describe('unavailable', () => {
  it('NASA not answering: the row says so with a reason, the map stays as before, retry asks again', async () => {
    const off = install()
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch')
    })
    const m = fakeMap()
    const host = installMapExtensions(m.ctx)
    renderControl()
    act(() => void toggle().dispatch('click', {}))
    await flush()
    expect(curiosityStatus.peek()).toEqual({ kind: 'unavailable', reason: 'network' })
    expect(root.textContent).toContain(ct('curiosity.unavailable', { reason: ct('curiosity.reasons.network') }))
    for (const id of Object.values(CURIOSITY_LAYERS)) expect(m.vis(id)).toBe('none')
    const calls = fetchMock.mock.calls.length
    fetchMock.mockImplementation(async (u: string) => (u === MSL_WAYPOINTS_URL ? ok(WAYPOINTS) : ok(TRAVERSE)))
    act(() => void byClass(root, 'hl-curiosity__more')[0].dispatch('click', {}))
    await flush()
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls)
    expect(curiosityStatus.peek().kind).toBe('ready')
    expect(m.vis(CURIOSITY_LAYERS.stops)).toBe('visible')
    host.destroy()
    off()
  })

  it('a 5xx on the pictures: the card says unavailable', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 503, json: async () => ({}) }) as unknown as Response)
    const stop: DriveEnd = { rmc: '107_2484', sol: 4200, site: 107, drive: 2484, lon: 137.4, lat: -4.78, distM: 12, totalM: 34000 }
    act(() => render(<StopPhotos stop={stop} next={null} />, root as unknown as Element))
    await flush()
    expect(root.textContent).toContain(ct('curiosity.card.unavailable', { reason: ct('curiosity.reasons.server') }))
  })
})

describe('the drive-end card', () => {
  const stop: DriveEnd = { rmc: '107_2484', sol: 4200, site: 107, drive: 2484, lon: 137.4, lat: -4.78, distM: 12, totalM: 34000 }
  const next: DriveEnd = { ...stop, rmc: '107_2600', sol: 4202, drive: 2600 }
  const it_ = (o: Record<string, unknown>) => ({ imageid: o.id, instrument: o.inst, sol: o.sol, site: o.site ?? null, drive: o.drive ?? null, https_url: `https://mars.nasa.gov/${o.id}.jpg`, date_taken: '2024-05-30T12:34:56.000Z', extended: { sample_type: 'full' } })

  it('Mastcam by sol with the "may predate the drive" note, Navcam by site/drive, lazy thumbnails, alt from metadata', async () => {
    fetchMock.mockImplementation(async (u: string) => {
      const sol = Number(/condition_2=(\d+)/.exec(u)![1])
      const items = sol === 4200 ? [it_({ id: 'm1', inst: 'MAST_LEFT', sol }), it_({ id: 'n1', inst: 'NAV_LEFT_B', sol, site: 107, drive: 2484 })] : sol === 4202 ? [it_({ id: 'm9', inst: 'MAST_LEFT', sol })] : []
      return ok({ items, more: false })
    })
    act(() => render(<StopPhotos stop={stop} next={next} />, root as unknown as Element))
    expect(root.textContent).toContain(ct('curiosity.card.loading'))
    await flush()
    expect(fetchMock.mock.calls.every((c) => String(c[0]).startsWith(RAW_IMAGE_API))).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3) // parked 4200, 4201 + next drive sol 4202
    const sections = byClass(root, 'hl-curiosity__cam')
    const mast = sections.find((s) => s.getAttribute('data-camera') === 'mastcam')!
    const nav = sections.find((s) => s.getAttribute('data-camera') === 'navcam')!
    expect(mast.textContent).toContain('may predate the drive')
    expect(mast.textContent).toContain(ct('curiosity.card.mastcamRule', { sols: ct('curiosity.card.sols', { first: 4200, last: 4201 }), sol: 4200 }))
    const imgs = byTag(root, 'img')
    expect(imgs).toHaveLength(2) // m9 is on the next drive's sol: not this stop's Mastcam
    for (const img of imgs) expect(img.getAttribute('loading')).toBe('lazy')
    const mImg = byTag(mast, 'img')[0]
    expect(mImg.getAttribute('alt')).toBe(ct('curiosity.card.imageAlt', { camera: ct('curiosity.card.mastcam'), instrument: 'MAST_LEFT', sol: 4200, taken: '2024-05-30 12:34:56 UTC' }))
    expect(byTag(nav, 'img')[0].getAttribute('alt')).toContain('Navcam')
    expect(root.textContent).toContain(ct('curiosity.live'))
    // links open NASA's full image in a new tab without a referrer leak
    const a = all(root, (n) => n.localName === 'a' && n.getAttribute('target') === '_blank')
    expect(a.every((n) => (n.getAttribute('rel') ?? '').includes('noopener'))).toBe(true)
  })
})

describe('copy.L1b.json follows the copy.json rules', () => {
  const PH = /\{[a-z][a-z0-9_]*\}/g
  const strings: [string, string][] = []
  const walk = (n: unknown, p: string) => (typeof n === 'string' ? strings.push([p, n]) : Object.entries(n as object).forEach(([k, v]) => walk(v, p ? `${p}.${k}` : k)))
  walk(ownCopy, '')
  it('no digits outside placeholders, no emoji, no "waypoint", non-empty and trimmed', () => {
    for (const [p, s] of strings) {
      expect(/\p{Nd}/u.test(s.replace(PH, '')), p).toBe(false)
      expect(/\p{Extended_Pictographic}/u.test(s), p).toBe(false)
      expect(/waypoint/i.test(s), p).toBe(false)
      expect(s.trim(), p).toBe(s)
      expect(s.length, p).toBeGreaterThan(0)
    }
  })
  it('keeps the seed title (route.layers.curiosity.title) and the honesty label', () => {
    expect(ct('curiosity.title')).toBe('Curiosity route and photos')
    expect(ct('curiosity.privacy')).toContain('mars.nasa.gov')
  })
})
