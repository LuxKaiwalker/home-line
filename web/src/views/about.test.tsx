// D86: the sentence after the scorecard link on /about. Static builds keep "Nothing is fetched live."
// exactly as before; live builds (VITE_LIVE=1) say what goes to the live server and point to the
// privacy note. Runs in node (no DOM): preactView is replaced by the identity and the tree is turned
// into its visible text by a small renderer of hook-free function components.
import { Fragment, type VNode } from 'preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./page', async (orig) => ({ ...(await orig<typeof import('./page')>()), preactView: (make: unknown) => make }))
// The live build's guarded import of src/live mounts the privacy note into `document`; stubbed here.
const live = vi.hoisted(() => ({ mounted: 0 }))
vi.mock('../live', () => ({ mountPrivacy: () => (live.mounted++, () => {}) }))

function text(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  const v = node as VNode<{ children?: unknown }>
  if (v.type === Fragment) return text(v.props.children)
  if (typeof v.type === 'function') return text((v.type as (p: unknown) => unknown)(v.props))
  return text(v.props.children)
}

const render = async () => {
  vi.resetModules()
  const { view } = await import('./about')
  return text((view as unknown as (r: unknown) => unknown)({ name: 'about' })).replace(/\s+/g, ' ')
}

const INTRO =
  'A static site: every number was computed offline during NASA Space Apps 2026 from public data and is listed with its file, script and commit on the scorecard. '

describe('/about: what is fetched live (D86)', () => {
  afterEach(() => {
    live.mounted = 0
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('static build: the original sentence, unchanged', async () => {
    vi.stubEnv('VITE_LIVE', '')
    const t = await render()
    expect(t).toContain(INTRO + 'Nothing is fetched live.')
    expect(t).not.toContain('live server')
    await new Promise((r) => setTimeout(r, 20))
    expect(live.mounted).toBe(0)
  })

  it('static build (J1, D132): the privacy section names mars.nasa.gov, the Curiosity layer that is off by default', async () => {
    vi.stubEnv('VITE_LIVE', '')
    const t = await render()
    expect(t).toContain('Stored in this browser')
    expect(t).toContain("The Mission Planer's Curiosity layer is off by default; turning it on loads the rover's drives and pictures from mars.nasa.gov")
    // and it is off by default in the code (PORT I3: the Mission Planer's Layers control is gone; its Curiosity
    // layer is L1b's map/overlays/curiosity): registered off, its state starts off, and only the toggle loads it
    const { readFileSync } = await import('node:fs')
    const read = (f: string) => readFileSync(new URL(`../map/overlays/curiosity/${f}`, import.meta.url), 'utf8')
    expect(read('install.tsx')).toMatch(/registerOverlay\(\{ id: CURIOSITY_ID,[^}]*defaultOn: false/)
    const store = read('store.ts')
    expect(store).toContain('const onSig = signal(false)')
    expect(store.match(/loadCuriosity\(/g)).toHaveLength(1) // the toggle's load(), nowhere on mount
    expect(store).toMatch(/if \(on\) \{\n[^}]*void load\(\)/) // load() only when the toggle turns it on (and on retry)
  })

  it('live build (VITE_LIVE=1): the live sentence replaces it and points to the privacy note', async () => {
    vi.stubEnv('VITE_LIVE', '1')
    vi.stubGlobal('document', {})
    const { LIVE_SENTENCE } = await import('./about')
    const t = await render()
    expect(t).toContain(INTRO + LIVE_SENTENCE)
    expect(t).not.toContain('Nothing is fetched live')
    // the privacy note the sentence points to is still mounted (the guarded line in about.tsx)
    await vi.waitFor(() => expect(live.mounted).toBe(1))
    expect(LIVE_SENTENCE).toBe(
      'In this live build the map data and the scorecard are still precomputed; the live tools send your planning requests to the live server, which the app also checks every few seconds (see Privacy below).',
    )
  })
})
