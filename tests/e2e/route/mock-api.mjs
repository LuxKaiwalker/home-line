// WP8a (D97): tiny local mock of the live API for the route end-to-end harness (drive-route.mjs --mock).
// Answers only what the route flow reads, in the shapes of contracts/backend (v1.2.0):
//   GET  /api/v1/health                      {ok, engine_warm, queue_length, heavy_jobs}
//   GET  /api/v1/engine/version              placeholder identity (contracts example zeros)
//   GET  /api/v1/defaults                    config/backend.yaml ranges + crew.yaml defaults (openapi Defaults)
//   POST /api/v1/jobs                        a staged job (scripted clock), or a 422 naming the stop (Error.stop)
//   GET  /api/v1/jobs/{id}                   job state from the job's clock
//   GET  /api/v1/results/{hash}/provenance   run record (route_mode, feasibility) once done
//   GET  /api/v1/results/{hash}/{path}       the result tree, stage by stage (see TREE below)
//   POST /api/v1/plans/import                {hash, inputs, computed}
//   GET  /__mock/info                        {officialHash, jobs}: harness bookkeeping, not an API path
//   GET  /__mock/sim/official/mission.json   the official mission (precomputed), for serve-web.mjs (WP8c)
// Every other API path answers 404 {error: "not_in_mock"}. CORS: the request Origin is echoed (the
// web runs on a Vite port 4200-4299, the mock on 8150-8199, so the browser keeps web security on).
//
// TREE: a route job's files are the official static tree (web/public/data, same names and contracts)
// gated by stage, except route_nom_104.geojson, which is synthesized from the submitted stops IN THE
// GIVEN ORDER (straight legs between station access points), so the harness can check that nothing is
// reordered. Numbers are placeholders, not results.
//   nominal  manifest.json, scenarios/index.json (default scenario only, range [null, null]),
//            scenarios/bands_104.geojson, scenarios/nom_104/{isochrones,edges}.geojson, route_nom_104.geojson
//   bands    the full scenarios/index.json and every scenario's bands/isochrones/edges
//   partner  scenarios/*/partner.geojson
// The official plan (hash of contracts/backend/examples/plan_inputs.official.json) is served as
// "precomputed" with the whole static tree, for the official-permalink check.
//
// SIMULATOR EXPORT (WP8c, D110; interfaces "Simulator export"): a live tree's manifest.json gets one
// entry of kind "sim_plan" (key sim.mission, file mission.json) and, once the job is done, mission.json
// = a contracts/bundle mission (origin computed_live, label config labels.live) built from the
// example's fixed blocks and the mock's legs, waypoints in the submitted order, summary.feasible =
// the run record's feasibility. The official tree serves mission.json with origin "precomputed"
// (route S7, S6, S1, S4 from the static route file; manifest untouched, as WP9c) and the same document
// at /__mock/sim/official/mission.json. `missionDoc` explains the placeholder numbers.
//
// FEASIBILITY (the infeasible variant): a placeholder time model, not the engine. Walk = straight
// distance x DETOUR at SPEED_M_MIN, dwell = stations.json dwell_min (30) per stop; budget =
// eva.duration_h x 60 - reserve_min (390 - 30 = 360 min). Leg i fails when its arrival time plus the
// straight walk home exceeds the budget (the home leg: its arrival). limit "EVA duration", shortfall =
// the overrun in minutes, legs_planned = i. With the official pad: S4, S1, S2 is feasible and
// S4, S1, S2, S7, S8 fails (printed by `node mock-api.mjs --explain S4,S1,S2,S7,S8`).
//
// usage: node mock-api.mjs [--port 8170] [--stage-ms 1500] [--repo <checkout with web/public/data>]
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, normalize, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const STAGES = ['nominal', 'bands', 'partner', 'route', 'summary']
const DETOUR = 1.25
const SPEED_M_MIN = 40
const MARS_R = 3389500

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

/** Canonical JSON (sorted keys) as the hash input. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  return JSON.stringify(v)
}

/** Mock result hash: inputs without title; auto route removed; ordered route in order, labels dropped (D57 rule). */
export function mockHash(inputs) {
  const { title: _t, contract_version: _c, ...rest } = inputs ?? {}
  const r = rest.route
  if (!r || r.mode !== 'ordered') delete rest.route
  else rest.route = { mode: 'ordered', stops: r.stops.map((s) => ('station' in s ? { station: s.station } : { lon: s.lon, lat: s.lat })) }
  return createHash('sha256').update(canonical(rest)).digest('hex').slice(0, 16)
}

function distM(a, b) {
  const rad = Math.PI / 180
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad)
  const y = (b.lat - a.lat) * rad
  return Math.hypot(x, y) * MARS_R
}

export function loadWorld(repo) {
  const data = join(repo, 'web/public/data')
  const ex = join(repo, 'contracts/backend/examples')
  const stations = readJson(join(data, 'stations.json'))
  const pad = readJson(join(data, 'pad.json')).pad
  const missionExample = readJson(join(repo, 'contracts/bundle/examples/mission.mission_planer.json'))
  return { repo, data, ex, stations, pad, missionExample, index: readJson(join(data, 'scenarios/index.json')), official: readJson(join(ex, 'plan_inputs.official.json')) }
}

/** Stops with names (station id or W1, W2, ...) and positions; null position = unknown station. */
function namedStops(world, stops) {
  let w = 0
  return stops.map((s) => {
    if ('station' in s) {
      const st = world.stations.find((x) => x.id === s.station)
      return { name: s.station, at: st ? { lon: st.access_lon ?? st.lon, lat: st.access_lat ?? st.lat } : null, dwell: st?.dwell_min ?? 30 }
    }
    return { name: `W${++w}`, at: { lon: s.lon, lat: s.lat }, dwell: 30 }
  })
}

/** 422 body for a refused route (first problem, naming the stop), else null. Rules of openapi Error.stop. */
export function refusal(world, route, limits) {
  const stops = route.stops ?? []
  if (route.mode === 'auto' && stops.length) return { error: 'route_mode_conflict', detail: 'route: an auto route has no stops', stop: null }
  if (route.mode !== 'ordered') return null
  if (!stops.length) return { error: 'invalid_input', detail: 'route.stops: at least one stop for mode ordered', stop: null }
  if (stops.length > limits.max_stops) return { error: 'route_too_many_stops', detail: `route: at most ${limits.max_stops} stops`, stop: limits.max_stops }
  const free = stops.map((s, i) => ('station' in s ? -1 : i)).filter((i) => i >= 0)
  if (free.length > limits.max_free_points) return { error: 'route_too_many_free_points', detail: `route: at most ${limits.max_free_points} free points`, stop: free[limits.max_free_points] }
  const seen = new Set()
  const named = namedStops(world, stops)
  for (const [i, s] of stops.entries()) {
    if ('station' in s) {
      if (!named[i].at) return { error: 'route_station_unknown', detail: `stops[${i}]: ${s.station} is not in stations.json`, stop: i }
      if (seen.has(s.station)) return { error: 'route_station_duplicate', detail: `stops[${i}]: ${s.station} is already in the route`, stop: i }
      seen.add(s.station)
    } else if (s.label !== undefined && [...String(s.label)].length > 80) return { error: 'route_label_too_long', detail: `stops[${i}].label: too long`, stop: i }
  }
  return null
}

/** Placeholder legs and feasibility (see FEASIBILITY in the header). */
export function mockPlan(world, inputs) {
  const pad = { lon: inputs.pad.lon, lat: inputs.pad.lat }
  const stops = namedStops(world, inputs.route?.stops ?? [])
  const budget = (inputs.eva?.duration_h ?? 6.5) * 60 - (inputs.eva?.reserve_min ?? 30)
  const pts = [{ name: 'pad', at: pad, dwell: 0 }, ...stops, { name: 'pad', at: pad, dwell: 0 }]
  const legs = []
  let t = 0
  let feasibility = { feasible: true }
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1]
    const len = distM(a.at, b.at) * DETOUR
    const walk = len / SPEED_M_MIN
    const t0 = t
    const t1 = t + walk
    const home = i + 1 === pts.length - 1 ? 0 : (distM(b.at, pad) * DETOUR) / SPEED_M_MIN
    const need = t1 + (i + 1 === pts.length - 1 ? 0 : b.dwell) + home
    if (need > budget) {
      feasibility = { feasible: false, leg: i, from: a.name, to: b.name, limit: 'EVA duration', shortfall_min: +(need - budget).toFixed(1), legs_planned: i }
      break
    }
    legs.push({ leg: i + 1, from: a.name, to: b.name, a: a.at, b: b.at, t0, t1, len })
    t = t1 + b.dwell
  }
  return { legs, feasibility, budget }
}

function routeGeojson(plan) {
  return {
    type: 'FeatureCollection',
    features: plan.legs.map((l) => {
      const mid = { lon: (l.a.lon + l.b.lon) / 2, lat: (l.a.lat + l.b.lat) / 2 }
      const r = (x) => +x.toFixed(2)
      return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[l.a.lon, l.a.lat], [mid.lon, mid.lat], [l.b.lon, l.b.lat]] },
        properties: { leg: l.leg, from: l.from, to: l.to, t_min: r(l.t1 - l.t0), o2_L: r((l.t1 - l.t0) * 1.35), length_m: +l.len.toFixed(1), t_start_min: r(l.t0), t_end_min: r(l.t1), times_min: [r(l.t0), r((l.t0 + l.t1) / 2), r(l.t1)] },
      }
    }),
  }
}

// ---- WP8c (D110): mission.json, the simulator plan (contracts/bundle/mission.schema.json) ----
// A placeholder mission built like contracts/bundle/examples/mission.mission_planer.json (its fixed
// blocks, constants and conditions are copied) from the mock's legs: one waypoint per stop IN THE
// GIVEN ORDER (lonlat = the station's access point; `station` is an extra key, objects are open), one
// 'out' leg per planned leg and the 'home' leg, two path rows per leg (start, end). Legs past an
// infeasible one are routed = false with null numbers, and the timeline is then null (schema rule).
// mission_id follows the README rule ('m-' + 12 hex of sha256(JSON.stringify(doc, id and time = ''))).
// The numbers are placeholders, not results.
const PROJ_R = 3396190
const r2 = (x) => (x === null || x === undefined ? null : +x.toFixed(2))

/** README id rule over the compact JSON (key order as built). */
export function missionId(doc) {
  const text = JSON.stringify({ ...doc, mission_id: '', created_utc: '' })
  return `m-${createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12)}`
}

/**
 * stops: [{name, station?, label?, at:{lon,lat}, dwell}] in visit order; legs: [{from, to, a, b, t0, t1, len}]
 * as planned (legs[i] = chain leg i; shorter when infeasible); feasible: the run record's verdict.
 */
export function missionDoc(world, { pad, stops, legs, feasible, origin, originLabel, files, createdUtc }) {
  const ex = world.missionExample
  const rad = Math.PI / 180
  const kx = PROJ_R * rad * Math.cos(pad.lat * rad)
  const xy = (p) => [r2((p.lon - pad.lon) * kx), r2((p.lat - pad.lat) * PROJ_R * rad)]
  const rate = ex.constants.effort_rate_l_min
  const stRate = ex.constants.station_rate_l_min
  const home = (p) => (distM(p, pad) * DETOUR) / SPEED_M_MIN
  const chain = [{ name: 'pad', at: pad }, ...stops, { name: 'pad', at: pad }]
  const wpName = (i) => (i === 0 || i === chain.length - 1 ? 'pad' : `wp${i}`)
  const rows = []
  const outLegs = []
  let o2 = 0
  for (let i = 0; i + 1 < chain.length; i++) {
    const l = legs[i]
    const kind = i + 1 === chain.length - 1 ? 'home' : 'out'
    const base = { leg: i + 1, kind, from: wpName(i), to: wpName(i + 1) }
    if (!l) {
      outLegs.push({ ...base, routed: false, length_m: null, time_min: null, o2_l: null, t_start_min: null, t_end_min: null, first_row: null, n_rows: 0 })
      continue
    }
    const o2Leg = (l.t1 - l.t0) * rate
    const [ax, ay] = xy(l.a), [bx, by] = xy(l.b)
    outLegs.push({ ...base, routed: true, length_m: r2(l.len), time_min: r2(l.t1 - l.t0), o2_l: r2(o2Leg), t_start_min: r2(l.t0), t_end_min: r2(l.t1), first_row: rows.length, n_rows: 2 })
    const ha = home(l.a), hb = home(l.b)
    rows.push([i + 1, 0, ax, ay, null, r2(l.t0), r2(o2), r2(ha), r2(ha * rate)])
    o2 += o2Leg
    rows.push([i + 1, r2(l.len), bx, by, null, r2(l.t1), r2(o2), r2(hb), r2(hb * rate)])
    if (kind === 'out') o2 += (chain[i + 1].dwell ?? 0) * stRate
  }
  const waypoints = stops.map((s, i) => {
    const l = legs[i]
    const [x, y] = xy(s.at)
    const t = home(s.at)
    return {
      index: i + 1, id: i + 1, lonlat: [s.at.lon, s.at.lat], x_m: x, y_m: y, z_m: null, note: s.label ?? s.name, tags: s.station ? ['station'] : [], station: s.station ?? null,
      stop_min: s.dwell ?? 0, arrive_t_min: l ? r2(l.t1) : null, leave_t_min: l ? r2(l.t1 + (s.dwell ?? 0)) : null, o2_used_at_leave_l: null, t_home_min: r2(t), o2_home_l: r2(t * rate),
    }
  })
  const done = !!feasible && legs.length === chain.length - 1
  const evaMin = done ? legs.at(-1).t1 : null
  const limit = ex.constants.eva_limit_min
  const walk = legs.reduce((a, l) => a + (l.t1 - l.t0), 0)
  let timeline = null
  if (done) {
    const trows = [[0, 'depart', null, 0, 0, 0, 0, r2(limit), 'EVA duration']]
    for (const w of waypoints) {
      trows.push([w.arrive_t_min, 'arrive', w.index, 0, w.t_home_min, w.o2_home_l, 0, r2(limit - w.arrive_t_min - w.t_home_min), 'EVA duration'])
      trows.push([w.leave_t_min, 'leave', w.index, 0, w.t_home_min, w.o2_home_l, 0, r2(limit - w.leave_t_min - w.t_home_min), 'EVA duration'])
    }
    trows.push([r2(evaMin), 'return', null, r2(o2), 0, 0, 0, r2(limit - evaMin), 'EVA duration'])
    const low = trows.reduce((m, r) => (r[7] < m[7] ? r : m))
    timeline = { ...ex.timeline, terms: ['EVA duration'], rows: trows, lowest: { margin_min: low[7], binding: 'EVA duration', t_min: low[0] } }
  }
  const doc = {
    schema_version: ex.schema_version,
    kind: ex.kind,
    mission_id: '',
    title: `Mission · ${stops.length} waypoints · ${ex.scenario.id}`,
    created_utc: createdUtc,
    origin,
    origin_label: originLabel,
    planner: { app_commit: null, config_hash: null, routing_grid_res_m: 3, elevation_res_m: 1, files },
    frame: {
      ...ex.frame,
      projection: { proj: `+proj=eqc +lat_ts=${pad.lat} +lat_0=0 +lon_0=${pad.lon} +x_0=0 +y_0=0 +R=${PROJ_R} +units=m +no_defs`, pad_xy_m: [0, r2(pad.lat * rad * PROJ_R)] },
      pad: { kind: 'official', id: pad.id ?? 'rank1', lon: pad.lon, lat: pad.lat, elev_m: pad.elev_m ?? null, source: 'mock (tests/e2e/route/mock-api.mjs)' },
    },
    scenario: ex.scenario,
    world: ex.world,
    constants: ex.constants,
    conditions: ex.conditions,
    waypoints,
    legs: outLegs,
    path: { ...ex.path, rows },
    timeline,
    summary: {
      feasible: !!feasible, walk_min: r2(walk), stop_min: stops.reduce((a, s) => a + (s.dwell ?? 0), 0), t_home_min: done ? r2(legs.at(-1).t1 - legs.at(-1).t0) : null, eva_min: r2(evaMin),
      time_margin_min: done ? r2(limit - evaMin) : null, o2_used_l: done ? r2(o2) : null, o2_home_l: null, o2_need_l: null,
      o2_margin_l: done ? r2(ex.constants.o2_capacity_l - ex.constants.reserve_l - o2) : null, o2_margin_min: null,
    },
    label: ex.label,
    dummy: false,
  }
  doc.mission_id = missionId(doc)
  return doc
}

/** A live route job's mission (origin computed_live), from the mock's plan of the submitted stops. */
export function liveMission(world, r, createdUtc) {
  const stops = namedStops(world, r.inputs.route?.stops ?? []).map((s, i) => {
    const raw = r.inputs.route.stops[i]
    const st = 'station' in raw ? world.stations.find((x) => x.id === raw.station) : null
    return { ...s, station: st ? st.id : null, label: raw.label ?? st?.name ?? s.name }
  })
  const f = r.plan.feasibility
  return missionDoc(world, {
    pad: { ...world.pad, ...r.inputs.pad }, stops, legs: r.plan.legs, feasible: f.feasible, origin: 'computed_live', originLabel: world.labels.live,
    files: { route: `route_${world.index.default}.geojson`, run_record: 'provenance' }, createdUtc,
  })
}

/** The official plan's mission (origin precomputed): the static route_nom_104.geojson legs (S7, S6, S1, S4). */
export function officialMission(world) {
  const route = readJson(join(world.data, `route_${world.index.default}.geojson`))
  const pt = (c) => ({ lon: c[0], lat: c[1] })
  const legs = route.features.map((f) => ({ from: f.properties.from, to: f.properties.to, a: pt(f.geometry.coordinates[0]), b: pt(f.geometry.coordinates.at(-1)), t0: f.properties.t_start_min, t1: f.properties.t_end_min, len: f.properties.length_m }))
  const stops = legs.slice(0, -1).map((l) => {
    const st = world.stations.find((s) => s.id === l.to)
    return { name: l.to, station: l.to, label: st?.name ?? l.to, at: l.b, dwell: st?.dwell_min ?? 30 }
  })
  return missionDoc(world, { pad: { ...world.pad }, stops, legs, feasible: true, origin: 'precomputed', originLabel: world.labels.precomputed, files: { route: `route_${world.index.default}.geojson` }, createdUtc: '2026-11-15T00:00:00Z' })
}

function defaultsDoc(world) {
  const yaml = world.yaml
  const backend = yaml.parse(readFileSync(join(world.repo, 'config/backend.yaml'), 'utf8'))
  const crew = yaml.parse(readFileSync(join(world.repo, 'config/crew.yaml'), 'utf8'))
  const get = (o, path) => path.split('.').reduce((v, k) => v?.[k], o)
  const ranges = {}
  for (const [k, v] of Object.entries(backend.ranges ?? {})) {
    if (!v || typeof v !== 'object') { ranges[k] = v; continue }
    const { default_ref, ...r } = v
    let def = r.default
    if (default_ref) { const [file, ...p] = default_ref.split('.'); def = get(file === 'crew' ? crew : backend, p.join('.')) }
    ranges[k] = { ...r, ...(def !== undefined ? { default: def } : {}) }
  }
  const d = (k) => ranges[k]?.default
  const { title: _t, ...official } = world.official
  return {
    inputs: {
      ...official,
      contract_version: '1.2.0',
      crew: { body_mass_kg: d('body_mass_kg'), suit_kg: d('suit_kg'), tools_kg: d('tools_kg'), vo2max_ml_kg_min: d('vo2max_ml_kg_min'), effort_cap_frac: d('effort_cap_frac') },
      eva: { reserve_min: d('reserve_min'), walkback_budgets_min: d('walkback_budget_min') },
    },
    ranges,
    stations: world.stations,
    pads: [],
    limits: backend.route,
  }
}

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z')

export async function startMock({ port = 8170, host = '127.0.0.1', repo = resolve(HERE, '../../..'), stageMs = 1500, log = () => {} } = {}) {
  const world = loadWorld(repo)
  world.yaml = await import(pathToFileURL(join(repo, 'web/node_modules/yaml/dist/index.js')).href).catch(() => import('yaml'))
  const defaults = defaultsDoc(world)
  world.labels = world.yaml.parse(readFileSync(join(repo, 'config/backend.yaml'), 'utf8')).labels
  const limits = { max_stops: 8, max_free_points: 4, min_stop_spacing_m: 50, ...(defaults.limits ?? {}) }
  const runRecordExample = readJson(join(world.ex, 'run_record.route_infeasible.json'))
  const versionExample = runRecordExample.engine
  const officialHash = mockHash(world.official)
  /** hash -> {id, hash, inputs, t0, plan, cached} */
  const results = new Map()
  const jobs = new Map()
  results.set(officialHash, { id: null, hash: officialHash, inputs: { ...world.official, contract_version: '1.2.0' }, t0: Date.now() - 10 * stageMs * STAGES.length, plan: null, official: true })

  // WP8c (D110): the simulator plan file and its manifest entry (kind sim_plan, interfaces "Simulator export")
  const MISSION_FILE = 'mission.json'
  const SIM_ENTRY = { 'sim.mission': { value: null, units: null, file: MISSION_FILE, script: 'server/engine/mission.py (mock: tests/e2e/route/mock-api.mjs)', commit: '0'.repeat(40), utc: '2026-11-15T00:00:00Z', kind: 'sim_plan' } }
  let officialDoc = null
  const official = () => (officialDoc ??= officialMission(world))
  const stagesDone = (r) => (r.official ? STAGES : STAGES.filter((_, i) => Date.now() - r.t0 >= (i + 1) * stageMs))
  function jobOf(r) {
    const done = stagesDone(r)
    const finished = done.length === STAGES.length
    return {
      id: r.id, type: 'plan', hash: r.hash, status: finished ? 'done' : 'running', stage: finished ? null : STAGES[done.length],
      progress: +(done.length / STAGES.length).toFixed(2), stages_done: done, queue_position: null,
      result_url: `/api/v1/results/${r.hash}/`, attached: !!r.attached, error: null, retry_after_s: null,
    }
  }
  function runRecord(r) {
    const done = stagesDone(r)
    const route = r.inputs.route
    const ordered = route?.mode === 'ordered'
    const f = r.plan?.feasibility ?? null
    return {
      ...runRecordExample,
      contract_version: '1.2.0',
      hash: r.hash,
      origin: r.official ? 'precomputed' : 'computed_live',
      label: r.official ? 'Precomputed · official plan' : 'Computed live · not part of the validated scorecard',
      inputs: r.inputs,
      status: 'done',
      started_utc: iso(r.t0),
      finished_utc: iso(r.t0 + STAGES.length * stageMs),
      stages: done.map((name, i) => ({ name, started_utc: iso(r.t0 + i * stageMs), seconds: stageMs / 1000, files: [] })),
      files: [],
      range_flags: [],
      route_mode: ordered ? 'ordered' : 'auto',
      ...(ordered && f ? { feasibility: f, infeasible: f.feasible ? null : { leg: f.leg, from: f.from, to: f.to, margin_min: -f.shortfall_min, binding: f.limit } } : { feasibility: undefined, infeasible: null }),
      error: null,
      dummy: true,
    }
  }
  /** A result file at `path` once `done` stages finished; null = not written (404). */
  function resultFile(r, path) {
    const p = normalize(path)
    if (p.startsWith('..') || p.startsWith('/')) return null
    const done = stagesDone(r)
    const has = (s) => done.includes(s)
    const file = join(world.data, p)
    const staticDoc = () => (existsSync(file) ? readJson(file) : null)
    // WP8c: the official tree is the static one (manifest untouched, WP9c) plus mission.json (precomputed)
    if (r.official) return p === MISSION_FILE ? official() : p.endsWith('.json') || p.endsWith('.geojson') ? staticDoc() : null
    const def = world.index.default
    if (p === 'route_nom_104.geojson' || p === `route_${def}.geojson`) return has('nominal') ? routeGeojson(r.plan) : null
    // WP8c: a live tree's manifest lists mission.json with kind sim_plan (WP9b exporter "mission");
    // the file itself is written once the job is done
    if (p === 'manifest.json') return has('nominal') ? { ...staticDoc(), ...SIM_ENTRY } : null
    if (p === MISSION_FILE) return done.length === STAGES.length && r.plan ? (r.mission ??= liveMission(world, r, iso(r.t0 + STAGES.length * stageMs))) : null
    if (p === 'scenarios/index.json') {
      if (has('bands')) return staticDoc()
      if (!has('nominal')) return null
      const s = world.index.scenarios.find((x) => x.id === def)
      const { headline_60: _h, ...entry } = s
      return { ...world.index, scenarios: [{ ...entry, headline: { ...s.headline, range_pct: [null, null] } }] }
    }
    if (/^scenarios\/[a-z]+_\d+\/partner\.geojson$/.test(p)) return has('partner') ? staticDoc() : null
    const nomFiles = ['scenarios/bands_104.geojson', `scenarios/${def}/isochrones.geojson`, `scenarios/${def}/edges.geojson`]
    if (nomFiles.includes(p)) return has('nominal') ? staticDoc() : null
    if (p.startsWith('scenarios/')) return has('bands') ? staticDoc() : null
    return null // timeline, cards, ...: not written by the mock
  }

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin
    const cors = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Expose-Headers': 'Retry-After' } : {}
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors })
      res.end(JSON.stringify(body))
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? 'content-type', 'Access-Control-Max-Age': '600' })
      return res.end()
    }
    const url = new URL(req.url, 'http://mock')
    let body = null
    if (req.method === 'POST') {
      let raw = ''
      for await (const c of req) raw += c
      try { body = raw ? JSON.parse(raw) : null } catch { return send(422, { error: 'invalid_input', detail: 'body is not JSON' }) }
    }
    log(`${req.method} ${url.pathname}`)
    if (url.pathname === '/__mock/info') return send(200, { officialHash, stageMs, stages: STAGES, jobs: [...jobs.values()].map((r) => ({ id: r.id, hash: r.hash, route: r.inputs.route ?? null, feasibility: r.plan?.feasibility ?? null, job: jobOf(r) })) })
    // WP8c: the official plan's static file web/public/sim/official/mission.json (WP9c), for serve-web.mjs
    // to serve at sim/official/mission.json while the checkout under test does not have it yet
    if (url.pathname === '/__mock/sim/official/mission.json') return send(200, official())
    if (!url.pathname.startsWith('/api/v1/')) return send(404, { error: 'not_found' })
    const path = url.pathname.slice('/api/v1'.length)
    if (req.method === 'GET' && path === '/health') return send(200, { ok: true, engine_warm: true, queue_length: 0, heavy_jobs: 'on' })
    if (req.method === 'GET' && path === '/engine/version')
      return send(200, { engine_tree: versionExample.tree, commit: versionExample.commit, config_hash: versionExample.config_hash, web_contract_version: versionExample.web_contract_version, backend_contract_version: '1.2.0', terrain_hash: runRecordExample.terrain_hash })
    if (req.method === 'GET' && path === '/defaults') { const { limits: _l, ...d } = defaults; return send(200, d) }
    if (req.method === 'POST' && path === '/jobs') {
      const inputs = body?.inputs
      if (!inputs?.pad || typeof inputs.pad.lon !== 'number') return send(422, { error: 'invalid_input', detail: 'inputs.pad: required' })
      if (inputs.route) {
        const bad = refusal(world, inputs.route, limits)
        if (bad) return send(422, bad)
      }
      const hash = mockHash(inputs)
      const known = results.get(hash)
      if (known) {
        known.attached = true
        return send(202, jobOf(known))
      }
      const r = { id: `j_mock_${hash}`, hash, inputs: { ...inputs, contract_version: inputs.contract_version ?? '1.2.0' }, t0: Date.now(), plan: mockPlan(world, inputs) }
      results.set(hash, r)
      jobs.set(r.id, r)
      return send(202, jobOf(r))
    }
    const jm = /^\/jobs\/([^/]+)$/.exec(path)
    if (req.method === 'GET' && jm) {
      const r = jobs.get(decodeURIComponent(jm[1]))
      return r ? send(200, jobOf(r)) : send(404, { error: 'unknown_job', detail: jm[1] })
    }
    const rm = /^\/results\/([0-9a-f]{16})\/(.*)$/.exec(path)
    if (req.method === 'GET' && rm) {
      const r = results.get(rm[1])
      if (!r) return send(404, { error: 'unknown_result', detail: rm[1] })
      if (rm[2] === 'provenance') return stagesDone(r).length === STAGES.length ? send(200, runRecord(r)) : send(404, { error: 'unknown_result', detail: `${rm[1]} is still running` })
      const doc = resultFile(r, decodeURIComponent(rm[2]))
      return doc === null ? send(404, { error: 'file_not_found', detail: rm[2] }) : send(200, doc)
    }
    if (req.method === 'POST' && path === '/plans/import') {
      if (!body?.pad) return send(422, { error: 'invalid_input', detail: 'pad: required' })
      if (body.route) {
        const bad = refusal(world, body.route, limits)
        if (bad) return send(422, bad)
      }
      const hash = mockHash(body)
      const r = results.get(hash)
      return send(200, { hash, inputs: body, computed: !!r && stagesDone(r).length === STAGES.length, range_flags: [] })
    }
    return send(404, { error: 'not_in_mock', detail: `${req.method} ${path}` })
  })
  await new Promise((ok, fail) => {
    server.once('error', fail)
    server.listen(port, host, ok)
  })
  return {
    url: `http://${host === '127.0.0.1' ? 'localhost' : host}:${port}`,
    officialHash,
    world,
    close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(() => ok()) }),
  }
}

// ---- CLI ----
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
  const repo = resolve(arg('--repo', resolve(HERE, '../../..')))
  const explain = arg('--explain', null)
  if (explain) {
    const world = loadWorld(repo)
    const inputs = { pad: world.pad, route: { mode: 'ordered', stops: explain.split(',').map((s) => ({ station: s.trim() })) } }
    const p = mockPlan(world, inputs)
    console.log(JSON.stringify({ budget_min: p.budget, legs: p.legs.map((l) => `${l.leg} ${l.from}->${l.to} ${l.t0.toFixed(1)}-${l.t1.toFixed(1)} min`), feasibility: p.feasibility }, null, 1))
  } else {
    const m = await startMock({ port: Number(arg('--port', 8170)), stageMs: Number(arg('--stage-ms', 1500)), repo, log: process.argv.includes('--verbose') ? (s) => console.log(s) : () => {} })
    console.log(`mock API on ${m.url}/api/v1 (official hash ${m.officialHash}); Ctrl+C to stop`)
  }
}
