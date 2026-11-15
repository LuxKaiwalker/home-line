// I1b (D128, instant browser path) known answers: every route edit recomputes the whole route in the
// browser once per animation frame with the user's order; an infeasible estimate names its first
// failing leg, the term and the minutes short; Send to simulator downloads a Blob whose JSON is the
// mission.json (schema 1.1.0, the estimate label, the stops in order); no stop = disabled.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCatalog } from '../../options'
import { createRouteController, type RouteJobs } from '../controller'
import type { RouteStop, StationGeo } from '../model'
import { createRouteStore } from '../store'
import { all, byClass, installDom, type FakeNode } from '../../../ui/testing/dom'
import { padFields } from './adapter'
import { createRouteEstimate, hash8 } from './estimate'
import { ESTIMATE_LABEL, type EstimateCore, type EstimateResult } from './types'
import { EstimateView, INSTANT_TEXT } from './view'

const PUB = resolve(__dirname, '../../../../public/data')
const json = (p: string) => JSON.parse(readFileSync(resolve(PUB, p), 'utf8'))
const catalog = buildCatalog(json('scenarios/index.json'), json('scenarios/pads/index.json'), json('stations.json'))
const stations: StationGeo[] = (json('stations.json') as StationGeo[]).map(({ id, name, lon, lat }) => ({ id, name, lon, lat }))
const ID = { engine_tree: '0123456789abcdef0123456789abcdef01234567', config_hash: 'sha256:1fef9c5747acbd487e0a3090f6e9617eba1c8627e25095db683e18ab7589099d', terrain_hash: `sha256:${'0'.repeat(64)}` }
const PAD = { lon: 137.401783, lat: -4.77748 }
const nameOf = (s: RouteStop, i: number, all: readonly RouteStop[]) => ('station' in s ? s.station : `W${all.slice(0, i + 1).filter((x) => !('station' in x)).length}`)

/** A stub core: one leg per stop + home; infeasible when `failAt` names a leg. */
function stubCore(failAt: { leg: number; term: string; short: number } | null = null) {
  const calls: { stops: string[]; pad: { lon: number; lat: number } }[] = []
  const core: EstimateCore = {
    load: vi.fn(async () => ({ grid: 'official' })),
    compute(_d, pad, stops) {
      calls.push({ stops: stops.map(nameOf), pad })
      const names = ['pad', ...stops.map(nameOf), 'pad']
      const legs = names.slice(1).map((to, i) => ({ leg: i, from: names[i], to, walkMin: 10 + i, o2UsedL: 50, marginMin: 60 - i, binding: 'O2' }))
      const r: EstimateResult = {
        legs,
        totals: { walkMin: 100, evaMin: 180, o2UsedL: 400.25, o2LeftL: 1100.5 },
        tightest: { marginMin: 42, binding: 'daylight', leg: 1 },
        feasibility: failAt ? { feasible: false, leg: failAt.leg, from: names[failAt.leg], to: names[failAt.leg + 1], term: failAt.term, shortMin: failAt.short } : { feasible: true },
      }
      return r
    },
    mission: async (r, ctx) => ({
      schema_version: '1.1.0',
      mission_id: 'm-0123456789ab',
      origin: 'estimate',
      origin_label: ESTIMATE_LABEL,
      feasibility: r.feasibility,
      waypoints: ctx.stops.map((s, i) => ({ id: nameOf(s, i, ctx.stops) })),
    }),
  }
  return { core, calls }
}

function manualRaf() {
  const q: (() => void)[] = []
  return {
    raf: (fn: () => void) => void q.push(fn),
    frames: () => q.length,
    frame() {
      const fns = q.splice(0)
      for (const f of fns) f()
    },
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const jobs: RouteJobs = { run: () => ({ promise: new Promise(() => {}), cancel() {} }) }

function setup(failAt: Parameters<typeof stubCore>[0] = null, save?: (t: string, n: string) => void) {
  const store = createRouteStore({ catalog, identity: ID })
  const ctl = createRouteController({ store, jobs, stations, pad: () => PAD })
  const { core, calls } = stubCore(failAt)
  const f = manualRaf()
  const est = createRouteEstimate({ store, pad: () => PAD, core, raf: f.raf, ...(save ? { save } : {}) })
  return { store, ctl, est, calls, core, f }
}

async function ready(s: ReturnType<typeof setup>) {
  s.f.frame()
  await act(async () => void (await flush()))
  s.f.frame()
}

describe('instant browser estimate (I1b)', () => {
  it('padFields: the official pad has the published fields, any other pad none yet (I2 seam)', () => {
    expect(padFields(catalog.officialPadId, catalog.officialPadId)).toBe('fields/index.json')
    expect(padFields('rank2', catalog.officialPadId)).toBeNull()
    expect(padFields(null, catalog.officialPadId)).toBeNull()
  })

  it('every edit recomputes once per animation frame, in the user order (never reordered), no server call', async () => {
    const s = setup()
    expect(s.est.state.peek().kind).toBe('off')
    // three ticks in one frame -> one compute
    s.ctl.toggle('S4', true)
    s.ctl.toggle('S1', true)
    s.ctl.toggle('S6', true)
    expect(s.f.frames()).toBe(1)
    await ready(s)
    expect(s.calls.map((c) => c.stops)).toEqual([['S4', 'S1', 'S6']])
    expect(s.calls[0].pad).toEqual(PAD)
    expect(s.core.load).toHaveBeenCalledTimes(1)
    expect(s.core.load).toHaveBeenCalledWith('fields/index.json')
    const st = s.est.state.peek()
    expect(st.kind).toBe('ready')
    // the next edit: one more compute with the new order
    s.ctl.toggle('S7', true)
    s.ctl.move(3, 0)
    expect(s.f.frames()).toBe(1)
    s.f.frame()
    expect(s.calls.map((c) => c.stops)).toEqual([
      ['S4', 'S1', 'S6'],
      ['S7', 'S4', 'S1', 'S6'],
    ])
    // free points keep their place too
    s.ctl.edit({ mode: 'ordered', stops: [{ station: 'S7' }, { lon: 137.4, lat: -4.776 }, { station: 'S4' }, { lon: 137.401, lat: -4.775 }] })
    s.f.frame()
    expect(s.calls.at(-1)!.stops).toEqual(['S7', 'W1', 'S4', 'W2'])
    expect(s.est.runs.peek()).toBe(3)
    expect(s.core.load).toHaveBeenCalledTimes(1)
    // undo is an edit too
    s.ctl.undo()
    s.f.frame()
    expect(s.calls.at(-1)!.stops).toEqual(['S7', 'S4', 'S1', 'S6'])
    s.est.dispose()
  })

  it('auto mode and an empty route compute nothing', async () => {
    const s = setup()
    s.f.frame()
    expect(s.est.state.peek()).toEqual({ kind: 'off', why: 'auto' })
    s.ctl.setMode('ordered')
    s.f.frame()
    expect(s.est.state.peek()).toEqual({ kind: 'off', why: 'empty' })
    s.ctl.toggle('S1', true)
    s.ctl.setMode('auto')
    s.f.frame()
    expect(s.est.state.peek()).toEqual({ kind: 'off', why: 'auto' })
    expect(s.calls).toHaveLength(0)
  })

  describe('view', () => {
    let root: FakeNode
    beforeEach(() => {
      ;({ container: root } = installDom())
    })
    afterEach(() => act(() => render(null, root as unknown as Element)))
    const text = (n: FakeNode) => n.textContent.replace(/\s+/g, ' ').trim()

    it('feasible: totals, tightest margin with its binding term, per-leg list, the exact estimate label', async () => {
      const s = setup()
      for (const id of ['S4', 'S1', 'S6', 'S7']) s.ctl.toggle(id, true)
      await ready(s)
      act(() => render(<EstimateView est={s.est} state={s.est.state.peek()} route={s.store.route.peek()} />, root as unknown as Element))
      expect(text(byClass(root, 'hl-tag--estimate')[0])).toBe('Estimate · browser, 5 m grid · not part of the validated scorecard')
      const t = text(byClass(root, 'hl-route__est-totals')[0])
      expect(t).toContain('Walk 100 min')
      expect(t).toContain('EVA 180 min')
      expect(t).toContain('O₂ used 400.3 L · left 1100.5 L')
      expect(text(byClass(root, 'hl-route__est-margin')[0])).toBe('Tightest margin 42 min (daylight)')
      expect(byClass(root, 'hl-route__est-leg').map((l) => l.getAttribute('data-leg'))).toEqual(['0', '1', '2', '3', '4'])
      expect(byClass(root, 'hl-route__infeasible')).toHaveLength(0)
    })

    it('infeasible: the FIRST failing leg is highlighted and the term and minutes short are named', async () => {
      const s = setup({ leg: 3, term: 'O2', short: 25.34 })
      for (const id of ['S4', 'S1', 'S2']) s.ctl.toggle(id, true)
      await ready(s)
      act(() => render(<EstimateView est={s.est} state={s.est.state.peek()} route={s.store.route.peek()} />, root as unknown as Element))
      const box = byClass(root, 'hl-route__infeasible')[0]
      expect(box.getAttribute('data-leg')).toBe('3')
      expect(box.getAttribute('data-limit')).toBe('O2')
      expect(text(box)).toContain('Leg 4 (S2 → Pad) fails first: O2, short by 25 min')
      expect(byClass(root, 'hl-route__est-leg').map((l) => l.getAttribute('data-state'))).toEqual(['planned', 'planned', 'planned', 'failing'])
    })

    it('Send to simulator: a Blob download whose JSON has schema 1.1.0, the estimate label and the stops in order; infeasible routes export too', async () => {
      const blobs: Blob[] = []
      const created = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
        blobs.push(b as Blob)
        return 'blob:test'
      })
      const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      const doc = (globalThis as unknown as { document: { createElement(t: string): Record<string, unknown> } }).document
      const clicks: string[] = []
      const ce = doc.createElement.bind(doc)
      const spyCe = vi.spyOn(doc, 'createElement').mockImplementation((t: string) => {
        const el = ce(t)
        if (t === 'a') Object.assign(el, { click: () => clicks.push(String(el.download)), remove: () => {} })
        return el
      })
      try {
        const s = setup({ leg: 3, term: 'O2', short: 25.34 })
        for (const id of ['S4', 'S1', 'S2']) s.ctl.toggle(id, true)
        await ready(s)
        act(() => render(<EstimateView est={s.est} state={s.est.state.peek()} route={s.store.route.peek()} />, root as unknown as Element))
        const btn = byClass(root, 'hl-route__send')[0]
        expect(btn.hasAttribute('disabled')).toBe(false)
        await act(async () => {
          btn.dispatch('click')
          await flush()
        })
        expect(created).toHaveBeenCalledTimes(1)
        const got = JSON.parse(await blobs[0].text())
        expect(got.schema_version).toBe('1.1.0')
        expect(got.origin_label).toBe(ESTIMATE_LABEL)
        expect(got.waypoints.map((w: { id: string }) => w.id)).toEqual(['S4', 'S1', 'S2'])
        expect(got.feasibility).toEqual({ feasible: false, leg: 3, from: 'S2', to: 'pad', term: 'O2', shortMin: 25.34 })
        expect(blobs[0].type).toBe('application/json')
        expect(clicks).toEqual(['homeline-mission-01234567.json'])
        expect(text(all(root, (n) => n.getAttribute('data-sim-status') !== null)[0])).toBe(`Saved homeline-mission-01234567.json`)
      } finally {
        created.mockRestore()
        revoked.mockRestore()
        spyCe.mockRestore()
      }
    })

    it('Send to simulator is disabled (with the reason) only while there is no stop', async () => {
      const s = setup()
      await ready(s)
      act(() => render(<EstimateView est={s.est} state={s.est.state.peek()} route={s.store.route.peek()} />, root as unknown as Element))
      const btn = byClass(root, 'hl-route__send')[0]
      expect(btn.hasAttribute('disabled')).toBe(true)
      expect(btn.getAttribute('title')).toBe(INSTANT_TEXT.sendWhy)
      expect(await s.est.exportMission()).toBeNull()
    })
  })

  it('file name falls back to a stable 8-hex hash of the route', () => {
    expect(hash8('abc')).toMatch(/^[0-9a-f]{8}$/)
    expect(hash8('abc')).toBe(hash8('abc'))
    expect(hash8('abc')).not.toBe(hash8('abd'))
  })
})
