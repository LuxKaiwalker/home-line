// I2b (D128, instant browser path): the browser route data per pad. loadBrowserRouteData / loadRouteGrid
// cache by (pad, scenario) and read the picker pads' own fields (I2: fields/index.json
// `pads/{pad}/{scenario}/{t_home,o2_home,pointer}`); the official pad keeps `{scenario}/...`. Runs the
// REAL loaders on the REAL published data (web/public/data): only the PNG decode (createImageBitmap, not
// in node) and the data loader's fetch are replaced by file reads. Skips when web/public/data is absent.
/// <reference types="node" />
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { REPO } from '../../../hud/testutil'
import type { RouteStop } from '../model'
import { browserCore, padFields } from '../instant/adapter'
import { buildBrowserMission, computeBrowserRoute } from './compute'
import { fieldKeys, loadBrowserRouteData, type BrowserRouteData } from './data'

const PUB = resolve(REPO, 'web/public/data')
const SCHEMA = resolve(REPO, 'contracts/bundle/mission.schema.json')
const PY = resolve(REPO, '.venv/bin/python')
const requested = vi.hoisted(() => [] as string[])

vi.mock('../../../hud/fields', async (orig) => {
  const m = await orig<typeof import('../../../hud/fields')>()
  const { readPngRGBA } = await import('../../../hud/testutil')
  const { resolve: res } = await import('node:path')
  return {
    ...m,
    loadField: async (fi: import('../../../hud/types').FieldsIndex, key: string) => {
      requested.push(key)
      const meta = fi.fields[key]
      if (!meta) throw new Error(`fields/index.json has no field ${key}`)
      const { rgba, width, height } = readPngRGBA(res(PUB, meta.file))
      return new m.FieldGrid(m.fieldGrid(fi, key), m.decodeRGBA(rgba, width, height, meta.scale), meta.units)
    },
  }
})
vi.mock('../../../hud/wayhome', async (orig) => {
  const m = await orig<typeof import('../../../hud/wayhome')>()
  const f = await import('../../../hud/fields')
  const { readPngRGBA } = await import('../../../hud/testutil')
  const { resolve: res } = await import('node:path')
  return {
    ...m,
    loadPointer: async (fi: import('../../../hud/types').FieldsIndex, key: string) => {
      requested.push(key)
      const meta = fi.fields[key]
      const { rgba, width, height } = readPngRGBA(res(PUB, meta.file))
      return new m.PointerField(new f.FieldGrid(f.fieldGrid(fi, key), f.decodeRGBA(rgba, width, height, meta.scale), meta.units), meta.stencil!)
    },
  }
})
vi.mock('../../../data/loader', async () => {
  const { readFileSync: read } = await import('node:fs')
  const { resolve: res } = await import('node:path')
  const J = (p: string) => Promise.resolve(JSON.parse(read(res(PUB, p), 'utf8')))
  const L = {
    json: J,
    fieldsIndex: () => J('fields/index.json'),
    stations: () => J('stations.json'),
    pad: () => J('pad.json'),
    rad: () => J('conditions/rad.json'),
    clock: () => J('conditions/clock.json'),
    optional: <T>(fn: () => Promise<T>) => fn().catch(() => null),
  }
  return { data: () => L, DataError: class DataError extends Error {} }
})

const st = (...ids: string[]): RouteStop[] => ids.map((station) => ({ station }))
const padsIndex = () => JSON.parse(readFileSync(resolve(PUB, 'scenarios/pads/index.json'), 'utf8')) as { official: string; pads: { id: string; lon: number; lat: number }[] }

function validateWithPython(doc: unknown): { ok: boolean; out: string } {
  const code = [
    'import json, sys',
    'from jsonschema import Draft202012Validator',
    `schema = json.load(open(${JSON.stringify(SCHEMA)}))`,
    'doc = json.load(sys.stdin)',
    'errs = sorted(Draft202012Validator(schema).iter_errors(doc), key=lambda e: list(e.path))',
    "print('\\n'.join(f'{list(e.path)}: {e.message}' for e in errs[:20]) or 'OK')",
    'sys.exit(1 if errs else 0)',
  ].join('\n')
  const r = spawnSync(PY, ['-I', '-c', code], { input: JSON.stringify(doc), encoding: 'utf8' })
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` }
}

describe('fieldKeys (I2b)', () => {
  it('official pad: the scenario keys; a picker pad: pads/{pad}/{scenario}/...', () => {
    expect(fieldKeys(null, 'nom_104')).toEqual({ tHome: 'nom_104/t_home', o2Home: 'nom_104/o2_home', pointer: 'nom_104/pointer' })
    expect(fieldKeys('rank3', 'nom_104')).toEqual({ tHome: 'pads/rank3/nom_104/t_home', o2Home: 'pads/rank3/nom_104/o2_home', pointer: 'pads/rank3/nom_104/pointer' })
  })
})

describe.skipIf(!existsSync(PUB))('browser route data per pad (real data, nom_104)', () => {
  const sc = 'nom_104'
  let fetched: string[] = []
  beforeAll(() => {
    // the 8 m heights (map/grid.ts loadHeights) from the files
    vi.stubGlobal('fetch', async (url: string) => {
      const rel = String(url).slice(String(url).indexOf('fp3d/'))
      fetched.push(rel)
      const b = readFileSync(resolve(PUB, rel))
      return new Response(b)
    })
  })

  it('rank3 requests the pads/ keys (and only those), its own pad as the fields pad', async () => {
    requested.length = 0
    const d = await loadBrowserRouteData(sc, 'rank3')
    expect([...requested].sort()).toEqual(['pads/rank3/nom_104/o2_home', 'pads/rank3/nom_104/pointer', 'pads/rank3/nom_104/t_home'])
    const row = padsIndex().pads.find((p) => p.id === 'rank3')!
    expect(d.fieldsPad).toMatchObject({ id: 'rank3', lon: row.lon, lat: row.lat, kind: 'picker' })
    expect(d.files).toMatchObject({ tHome: 'fields/pads/rank3/nom_104/t_home.png', o2Home: 'fields/pads/rank3/nom_104/o2_home.png', pointer: 'fields/pads/rank3/nom_104/pointer.png' })
    // cached per (pad, scenario)
    expect(await loadBrowserRouteData(sc, 'rank3')).toBe(d)
  }, 120_000)

  it('rank2: S4, S1, S6, S7 is feasible with NO fields_pad_mismatch; mission.json carries the P2 pad and validates (schema 1.1.0)', async () => {
    const row = padsIndex().pads.find((p) => p.id === 'rank2')!
    expect(row).toMatchObject({ lon: 137.393301, lat: -4.776468 })
    const d = (await browserCore.load(padFields('rank2', padsIndex().official)!)) as BrowserRouteData
    const r = computeBrowserRoute(d, { lon: row.lon, lat: row.lat }, st('S4', 'S1', 'S6', 'S7'))
    expect(r.issues).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.feasibility).toEqual({ feasible: true })
    process.stdout.write(`\n[I2b] rank2 S4,S1,S6,S7: walk ${r.totals.walkMin?.toFixed(1)} min, EVA ${r.totals.evaMin?.toFixed(1)} min, tightest ${r.tightest?.marginMin.toFixed(1)} min (${r.tightest?.binding})\n`)
    const doc = (await buildBrowserMission(r, { data: d })) as { schema_version: string; frame: { pad: Record<string, unknown> } }
    expect(doc.schema_version).toBe('1.1.0')
    expect(doc.frame.pad).toMatchObject({ kind: 'picker', id: 'rank2', lon: 137.393301, lat: -4.776468 })
    if (existsSync(PY)) {
      const v = validateWithPython(doc)
      expect(v.out.trim()).toBe('OK')
    }
  }, 120_000)

  it('the official pad keeps its own keys and data; a different pad is a different data object (no mismatch on either)', async () => {
    requested.length = 0
    const off = await loadBrowserRouteData(sc)
    expect(requested.filter((k) => k.startsWith('pads/'))).toEqual([])
    const p2 = await loadBrowserRouteData(sc, 'rank2')
    expect(p2).not.toBe(off)
    expect(computeBrowserRoute(off, off.fieldsPad, st('S7')).warnings).toEqual([])
    expect(computeBrowserRoute(p2, off.fieldsPad, st('S7')).warnings).toEqual(['fields_pad_mismatch'])
  }, 120_000)

  it('timing: switch pad -> estimate shown, cold (fields decoded) and warm (cached)', async () => {
    const order = st('S4', 'S1', 'S6', 'S7')
    const official = padsIndex().official
    const times: Record<string, number> = {}
    for (const [id, tag] of [
      ['rank4', 'cold rank4'],
      [official, 'warm official'],
      ['rank4', 'warm rank4'],
    ] as const) {
      const row = padsIndex().pads.find((p) => p.id === id)!
      const t0 = performance.now()
      const d = await browserCore.load(padFields(id, official)!)
      browserCore.compute(d, { lon: row.lon, lat: row.lat }, order)
      times[tag] = performance.now() - t0
    }
    process.stdout.write(`\n[I2b] switch pad -> estimate: ${Object.entries(times).map(([k, v]) => `${k} ${v.toFixed(0)} ms`).join(', ')} (cold = node PNG decode of 3 fields + grid + first legs; heights shared)\n`)
    expect(times['warm rank4']).toBeLessThan(times['cold rank4'])
  }, 120_000)
})
