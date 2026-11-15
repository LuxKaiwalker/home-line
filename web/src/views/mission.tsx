// "/mission" Mission Planer: the main planning area where waypoints are made. Left: the 3D map
// (HiRISE basemap, reachable-area boundary, pad, waypoints, legs, way home). Right: estimated times
// and consumption, then the waypoint list and the boundary picker. Click the map to add a
// waypoint; each leg is routed in the browser (src/mission/router.ts), the way home from the last
// waypoint is WS2's (pointer field, T_home, O2 home).
// Each waypoint carries a note, quick tags and a planned stop time (station work: EVA time + O2).
// The plan lives in the address (#/mission?plan=…, mission/share.ts), not in browser storage (D97), so it can be
// shared as a link and survives a reload.
// Later (PDF "Mission Planer"): O2 / radiation budget dropdown, reachable foundries.
import '../mission/mission.css'
import { render } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { CITED, CONFIG } from '../config'
import { DataProblem, DummyNote } from '../components/labels'
import { BASEMAP_CREDIT, basemapSources } from '../map/basemap'
import { dataUrl, DATA_MODE } from '../env'
import { BUDGET_CONSTANTS, missionBudget, stopMinutes, type MissionBudget } from '../mission/budget'
import { missionData, type MissionData } from '../mission/data'
import { addRefusal, MAX_STOPS, rememberPad, rememberPlan, startPad, startPlan } from '../mission/add'
import { PadPick } from '../mission/PadPick'
import type { MissionPad } from '../mission/pads'
import { MissionMap } from '../mission/missionMap'
import { MapsControl } from '../mission/MapsControl'
import { LayersControl } from '../mission/LayersControl'
import { evaClock } from '../mission/marstime'
import { daylightFor, DEFAULT_START_MS, isDefaultStart, StartTime } from '../mission/StartTime'
import { boundaryOptions, defaultBoundary, legPairs, moveWaypoint, removeWaypoint, replaceWaypoint, routeLegs, toggleTag, WAYPOINT_TAGS, type LonLat, type Waypoint } from '../mission/plan'
import { LegRouter, type Leg } from '../mission/router'
import { scenarioParams } from '../mission/physio'
import type { LegsReply, LegsRequest } from '../mission/legsRoute'
import { decodePlan, encodePlan } from '../mission/share'
import { stationWaypoint } from '../mission/stations'
import { data } from '../data/loader'
import type { Station } from '../data/types'
import { href, type Route } from '../router'
import { buildTrack, legProfile, missionMargin } from '../mission/margin'
import { buildMission, downloadJson, finalizeMission, originLabel } from '../mission/export'
import { tx } from '../mission/richCopy'
import { t } from '../ui/copy'
import { ensureManifest } from './common'
import type { View } from './types'

export const view: View = async (el, route) => {
  const initial = route.name === 'mission' ? { plan: route.plan, add: route.add } : {}
  el.innerHTML = `<div class="console mission"><div class="console-map mission-map"></div><aside class="console-panel mission-panel"></aside></div>`
  const mapEl = el.querySelector<HTMLElement>('.mission-map')!
  const panelEl = el.querySelector<HTMLElement>('.mission-panel')!
  await ensureManifest()
  const handlers = { onAdd: (_lon: number, _lat: number) => {}, onMove: (_i: number, _lon: number, _lat: number) => {} }
  const mmap = new MissionMap(mapEl, { onAdd: (a, b) => handlers.onAdd(a, b), onMove: (i, a, b) => handlers.onMove(i, a, b) })
  const mapsEl = document.createElement('div')
  const layersEl = document.createElement('div')
  // The switchers sit inside the MapLibre container: keep their clicks from adding waypoints.
  for (const box of [mapsEl, layersEl]) {
    for (const ev of ['mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'wheel']) box.addEventListener(ev, (e) => e.stopPropagation())
    mapEl.append(box)
  }
  render(<MissionPanel mmap={mmap} handlers={handlers} mapsEl={mapsEl} layersEl={layersEl} initial={initial} />, panelEl)
  return () => {
    render(null, mapsEl)
    render(null, layersEl)
    render(null, panelEl)
    mmap.destroy()
  }
}

type Handlers = { onAdd: (lon: number, lat: number) => void; onMove: (i: number, lon: number, lat: number) => void }

const fmtMin = (v: number | null, digits = 1) => (v === null ? '–' : `${v.toFixed(digits)} min`)
const fmtL = (v: number | null, digits = 1) => (v === null ? '–' : `${v.toFixed(digits)} L`)
const fmtM = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} km` : `${Math.round(v)} m`)

type Initial = { plan?: string; add?: string }

/** Date of the RAD storm the storm switch replays (D39). */
const STORM_DATE = '20 May 2024'
/** Grid of the engine's own routes, for the sources caption. */
const ENGINE_ROUTE_RES_M = 3

function MissionPanel({ mmap, handlers, mapsEl, layersEl, initial }: { mmap: MissionMap; handlers: Handlers; mapsEl: HTMLElement; layersEl: HTMLElement; initial: Initial }) {
  const [d, setD] = useState<MissionData | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [step, setStep] = useState(t('mission.loading.firstStep'))
  const [wps, setWps] = useState<Waypoint[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [boundary, setBoundary] = useState('none')
  const [credit, setCredit] = useState<string | null>(null)
  const nextId = useRef(1)
  // J1d: the pad (official / P2–P4); leg caches per pad (each pad has its own walkable area)
  const [pad, setPad] = useState<MissionPad>(() => startPad(initial))
  const caches = useRef(new Map<MissionPad, Map<string, Leg | null>>())
  const mapReady = useRef(false)
  const restored = useRef(false)
  // The Waypoints card starts closed; it opens by itself when a waypoint is added (not on removal).
  const wpDetails = useRef<HTMLDetailsElement>(null)
  const wpCount = useRef(0)
  useEffect(() => {
    if (wps.length > wpCount.current && wpDetails.current) wpDetails.current.open = true
    wpCount.current = wps.length
  }, [wps.length])
  // Science stations (stations.json): undefined while loading, null when they cannot be loaded.
  const [stations, setStations] = useState<Station[] | null | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  /** D39 storm switch: replay the 20 May 2024 RAD storm on this EVA's clock (dose term in the margin and the export) */
  const [storm, setStorm] = useState(false)
  /** EVA start instant (UTC ms); default = WS4's simulated EVA (D31); not stored (D97) */
  const [startMs, setStartMs] = useState(DEFAULT_START_MS)

  // Load once per pad (J1d: mission/data.ts caches each (pad, scenario)).
  useEffect(() => {
    let alive = true
    missionData(undefined, (s) => alive && setStep(s), pad).then(
      async (md) => {
        if (!alive) return
        setD(md)
        mmap.setPad({ lon: md.pad.lon, lat: md.pad.lat, title: md.pad.title })
        await mmap.setBoundaryData(md)
        setBoundary(defaultBoundary(boundaryOptions(md.bands, md.isochrones, md.edges), CONFIG.walkbackBudgetsMin[0]))
        if (mapReady.current) return
        mapReady.current = true
        mmap.fitTo([[md.pad.lon, md.pad.lat]])
        if (md.tilejson) {
          await mmap.setBasemap(basemapSources(md.tilejson, (p) => dataUrl(p)))
          setCredit(md.tilejson.attribution ?? BASEMAP_CREDIT)
        }
        // Maps switcher (bottom left of the map): satellite / topography / material.
        render(<MapsControl mmap={mmap} src={{ grid: md.tHome, elev: md.grid.elev, resM: md.grid.resM, hasBasemap: !!md.tilejson }} />, mapsEl)
        // Overlays (top right): slope classes, Curiosity's route and photos.
        render(<LayersControl mmap={mmap} bounds={[md.tHome.w, md.tHome.s, md.tHome.e, md.tHome.n]} />, layersEl)
      },
      (e) => alive && setError(e),
    )
    return () => {
      alive = false
    }
  }, [pad])

  // J1d: a pad switch keeps the waypoints that have a walk home from the new pad (cells snap again).
  const dPad = useRef<MissionData | null>(null)
  useEffect(() => {
    if (!d || dPad.current === d) return
    const first = dPad.current === null
    dPad.current = d
    if (first || !restored.current) return
    const kept = wps.flatMap((w) => {
      const c = cellAt(w.lon, w.lat)
      return typeof c === 'number' ? [{ ...w, cell: c }] : []
    })
    const lost = wps.length - kept.length
    setNotice(lost ? t(lost === 1 ? 'mission.notices.padLostOne' : 'mission.notices.padLostMany', { n: lost }) : null)
    setWps(kept)
  }, [d])

  // Mars clock at the chosen start; the sun is computed at the pad (D21, as clock.json).
  const clock = useMemo(() => (d ? evaClock(startMs, { lat: d.pad.lat, lon: d.pad.lon }) : null), [d, startMs])
  // I3 behaviour (#177, edit/route/browser/start.ts withEvaStart): the default start is clock.json's
  // data as is (D31); only a moved start ("custom start", labelled) recomputes t_dark (2 decimals).
  const customStart = !isDefaultStart(startMs)
  const tDarkMin = customStart && clock ? Math.round(daylightFor(clock) * 100) / 100 : (d?.tDarkMin ?? null)

  const router = useMemo(() => (d ? new LegRouter(d.grid, d.model) : null), [d])
  // J1h: legs are routed in a Web Worker (mission/legsWorker.ts, the same LegRouter), so an edit renders
  // at once with the known legs and "routing…" for new ones; a result fills the leg cache and re-renders.
  // No Worker (old browser, tests): route on the main thread as before.
  const [legTick, setLegTick] = useState(0)
  const legsWorker = useRef<{ w: Worker; asked: Set<string> } | null>(null)
  useEffect(() => {
    if (!d || typeof Worker === 'undefined') return
    let w: Worker
    try {
      w = new Worker(new URL('../mission/legsWorker.ts', import.meta.url), { type: 'module' })
    } catch {
      return
    }
    const cache = caches.current.get(d.fieldsPad ?? null) ?? new Map<string, Leg | null>()
    caches.current.set(d.fieldsPad ?? null, cache)
    const asked = new Set<string>()
    let alive = true
    w.onmessage = (e: MessageEvent<LegsReply>) => {
      if (!alive) return
      const k = `${e.data.a}-${e.data.b}`
      asked.delete(k)
      cache.set(k, e.data.leg)
      setLegTick((n) => n + 1)
    }
    w.onerror = () => {
      // the worker failed: fall back to main-thread routing for what is left
      if (!alive) return
      alive = false
      w.terminate()
      if (legsWorker.current?.w === w) legsWorker.current = null
      setLegTick((n) => n + 1)
    }
    // copies (the main thread keeps its own arrays), transferred to avoid a second copy
    const elev = d.grid.elev.slice()
    const passable = d.grid.passable.slice()
    const init: LegsRequest = { type: 'init', grid: { width: d.grid.width, height: d.grid.height, resM: d.grid.resM, elev, passable }, params: scenarioParams(d.scenario.id) }
    w.postMessage(init, [elev.buffer, passable.buffer])
    legsWorker.current = { w, asked }
    setLegTick((n) => n + 1)
    return () => {
      alive = false
      w.terminate()
      if (legsWorker.current?.w === w) legsWorker.current = null
    }
  }, [d])
  const padCell = useMemo(() => {
    if (!d) return -1
    const p = d.tHome.pixelOf(d.pad.lon, d.pad.lat)
    return p ? p.row * d.tHome.width + p.col : -1
  }, [d])
  const options = useMemo(() => (d ? boundaryOptions(d.bands, d.isochrones, d.edges) : []), [d])

  /** Grid cell of a spot, or why it cannot be a waypoint. */
  const cellAt = (lon: number, lat: number): number | 'outside' | 'blocked' => {
    const p = d!.tHome.pixelOf(lon, lat)
    if (!p) return 'outside'
    const cell = p.row * d!.tHome.width + p.col
    return d!.grid.passable[cell] ? cell : 'blocked'
  }

  /** Snap a click to the routing grid: null + a notice when the spot cannot be walked from. */
  const snap = (lon: number, lat: number): number | null => {
    if (!d) return null
    const c = cellAt(lon, lat)
    if (c === 'outside') {
      setNotice(t('mission.notices.outside'))
      return null
    }
    if (c === 'blocked') {
      setNotice(t('mission.notices.blocked', { scenario: d.scenario.id }))
      return null
    }
    setNotice(null)
    return c
  }

  useEffect(() => {
    let alive = true
    data()
      .stations()
      .then(
        (s) => alive && setStations(s),
        () => alive && setStations(null),
      )
    return () => {
      alive = false
    }
  }, [])

  /** Append a science station (its access cell, its dwell time) unless it is in the plan already. */
  const withStation = (list: Waypoint[], id: string): { list: Waypoint[]; msg: string } => {
    const s = stations?.find((x) => x.id === id)
    if (!s) return { list, msg: t('mission.notices.noStation', { id }) }
    // J1d: no duplicate, at most route.max_stops (mission/add.ts)
    const no = addRefusal(list, id)
    if (no === 'inPlan') return { list, msg: t('mission.notices.stationInPlan', { id }) }
    if (no === 'full') return { list, msg: t('mission.notices.routeFull', { id, n: MAX_STOPS }) }
    const w = stationWaypoint(s, d!.scenario.id)
    const c = w ? cellAt(w.lon, w.lat) : 'blocked'
    if (!w || typeof c !== 'number') return { list, msg: t('mission.notices.stationNoAccess', { id, scenario: d!.scenario.id }) }
    return { list: [...list, { ...w, id: nextId.current++, cell: c }], msg: t('mission.notices.stationAdded', { id, n: list.length + 1, stop_min: w.stopMin }) }
  }
  const addStation = (id: string) => {
    const r = withStation(wps, id)
    setNotice(r.msg)
    if (r.list !== wps) setWps(r.list)
  }

  // Restore once the data and stations are in: the link's plan (no browser storage, D97);
  // then the station from ?add= (from the Science stations page).
  useEffect(() => {
    if (!d || stations === undefined || restored.current) return
    restored.current = true
    const src = startPlan(initial) ?? '' // J1d: an "Add to route" link adds to this page load's last plan
    const plan = decodePlan(src)
    if (plan === null && initial.plan) setNotice(t('mission.notices.planDamaged'))
    let out: Waypoint[] = []
    for (const w of plan ?? []) {
      const c = cellAt(w.lon, w.lat)
      if (typeof c === 'number') out.push({ ...w, id: nextId.current++, cell: c })
    }
    const lost = (plan ?? []).length - out.length
    if (lost) setNotice(t(lost === 1 ? 'mission.notices.lostOne' : 'mission.notices.lostMany', { n: lost, scenario: d.scenario.id }))
    if (initial.add) {
      const r = withStation(out, initial.add)
      out = r.list
      setNotice(r.msg)
    }
    setWps(out)
    // Drop ?add= from the address at once, so a reload does not add it again.
    const ps = encodePlan(out)
    history.replaceState(history.state, '', href(ps ? { name: 'mission', plan: ps } : { name: 'mission' }))
  }, [d, stations])

  // Keep the address in step with the plan (replaceState: no re-render); a reload keeps it.
  const planStr = useMemo(() => encodePlan(wps), [wps])
  useEffect(() => {
    if (!restored.current) return
    rememberPlan(planStr)
    const r: Route = planStr ? { name: 'mission', plan: planStr } : { name: 'mission' }
    history.replaceState(history.state, '', href(r))
    setCopied(false)
  }, [planStr])
  useEffect(() => void (d && rememberPad(d.fieldsPad)), [d])

  const copyLink = () => {
    navigator.clipboard?.writeText(location.href).then(
      () => setCopied(true),
      () => setNotice(t('mission.notices.copyFailed')),
    )
  }

  handlers.onAdd = (lon, lat) => {
    const cell = snap(lon, lat)
    if (cell === null) return
    setWps((w) => [...w, { id: nextId.current++, lon, lat, cell, note: '', tags: [], stopMin: 0 }])
  }
  handlers.onMove = (i, lon, lat) => {
    const cell = snap(lon, lat)
    if (cell === null) {
      setWps((w) => w.slice()) // redraw: the marker jumps back
      return
    }
    setWps((w) => replaceWaypoint(w, i, { ...w[i], lon, lat, cell }))
  }

  // Legs (cached) and the way home.
  // undefined = still routing in the worker (J1h)
  const legsNow = useMemo<(Leg | null | undefined)[]>(() => {
    if (!router || padCell < 0) return []
    const key = d?.fieldsPad ?? null
    if (!caches.current.has(key)) caches.current.set(key, new Map())
    const cache = caches.current.get(key)!
    const lw = legsWorker.current
    if (!lw) return routeLegs(legPairs(padCell, wps), (a, b) => router.route(a, b), cache)
    return legPairs(padCell, wps).map(([a, b]) => {
      const k = `${a}-${b}`
      if (cache.has(k)) return cache.get(k)!
      if (!lw.asked.has(k)) {
        lw.asked.add(k)
        const req: LegsRequest = { type: 'route', a, b }
        lw.w.postMessage(req)
      }
      return undefined
    })
  }, [router, padCell, wps, legTick])
  const routingN = legsNow.filter((l) => l === undefined).length
  // While a leg is routing, the rest of the panel sees it as unknown (null): no totals, margin or export.
  const legs = useMemo<(Leg | null)[]>(() => legsNow.map((l) => l ?? null), [legsNow])

  // Keyed on the cell only: editing a note or stop time must not recompute the way home.
  const lastCell = wps.length ? wps[wps.length - 1].cell : null
  const home = useMemo(() => {
    if (!d) return { tHomeMin: null, o2HomeL: null, path: null as { coords: LonLat[]; reachesPad: boolean } | null }
    if (lastCell === null) return { tHomeMin: 0, o2HomeL: 0, path: null }
    const ll = d.tHome.lonLatOf(Math.floor(lastCell / d.tHome.width), lastCell % d.tHome.width)
    const w = d.pointer?.pathFrom(ll[0], ll[1], [d.pad.lon, d.pad.lat]) ?? null
    return {
      tHomeMin: d.tHome.valueAt(ll[0], ll[1]),
      o2HomeL: d.o2Home ? d.o2Home.valueAt(ll[0], ll[1]) : null,
      path: w && w.startKnown && w.coords.length > 1 ? { coords: w.coords as LonLat[], reachesPad: w.reachesPad } : null,
    }
  }, [d, lastCell])

  const budget = useMemo(
    () => missionBudget(legs.map((l) => (l ? { timeMin: l.timeS / 60, o2L: l.o2L } : null)), home, wps.map((w) => w.stopMin)),
    [legs, home, wps],
  )

  // The planned margin over time; the storm switch (D39) adds the dose term when WS4's rad.json is loaded.
  const margin = useMemo(() => {
    if (!d || !wps.length || legs.some((l) => l === null)) return null
    const homeAt = (cell: number) => {
      const row = Math.floor(cell / d.tHome.width)
      const col = cell % d.tHome.width
      return { tHomeMin: d.tHome.valueAtPixel(row, col), o2HomeL: d.o2Home ? d.o2Home.valueAtPixel(row, col) : null }
    }
    const track = buildTrack(legs.map((l) => legProfile(l!, homeAt)), wps.map((w) => w.stopMin))
    return missionMargin(track, { tDarkMin, rad: d.rad, storm })
  }, [d, legs, wps, storm, tDarkMin])

  const exportMission = async () => {
    if (!d || !wps.length || routingN > 0) return // J1h: only with every leg routed
    const w = d.tHome.width
    const elevAt = (lon: number, lat: number) => {
      const p = d.tHome.pixelOf(lon, lat)
      const v = p ? d.grid.elev[p.row * w + p.col] : NaN
      return Number.isFinite(v) ? v : null
    }
    const doc = buildMission({
      proj: CONFIG.analysisProj,
      pad: { kind: d.padKind, id: d.padId, lon: d.pad.lon, lat: d.pad.lat, elevM: d.padElevM, source: d.pad.sourceLabel },
      scenario: { id: d.scenario.id, variant: d.scenario.variant, suit_kg: d.scenario.suit_kg },
      planner: { gridResM: d.grid.resM, elevationResM: d.elevationResM, files: d.files },
      constants: { ...BUDGET_CONSTANTS, marginAmberMin: CONFIG.marginAmberMin },
      conditions:
        customStart && clock
          ? { evaStartLmst: clock.lmst, tDarkMin, storm, evaStartUtc: clock.startUtc, mslSol: clock.mslSol, rad: d.rad }
          : { evaStartLmst: d.evaStartLmst, tDarkMin: d.tDarkMin, storm, evaStartUtc: d.evaStartUtc, mslSol: d.mslSol, rad: d.rad },
      wps,
      legs,
      homePath: home.path?.coords ?? null,
      homeReachesPad: home.path?.reachesPad ?? false,
      budget,
      margin,
      cellLonLat: (c) => d.tHome.lonLatOf(Math.floor(c / w), c % w),
      elevAt,
      homeAt: (lon, lat) => ({ tHomeMin: d.tHome.valueAt(lon, lat), o2HomeL: d.o2Home ? d.o2Home.valueAt(lon, lat) : null }),
      label: CONFIG.simulatedLabel,
      dummy: DATA_MODE === 'dummy',
    }, { customStart })
    const fin = await finalizeMission(doc)
    downloadJson(fin, `mission_${fin.mission_id}.json`)
  }

  // Draw.
  useEffect(() => {
    if (!d) return
    mmap.setWaypoints(wps.map((w, i) => ({ lon: w.lon, lat: w.lat, bad: legsNow[i] === null, info: waypointInfo(w) })))
    const toLL = (c: number): LonLat => d.tHome.lonLatOf(Math.floor(c / d.tHome.width), c % d.tHome.width)
    void mmap.setRoute(
      legs.map((l) => (l ? l.cells.map(toLL) : [])),
      home.path,
    )
  }, [d, wps, legs, legsNow, home])

  useEffect(() => void mmap.showBoundary(options.find((o) => o.id === boundary)), [boundary, options])

  // Science stations on the map (popup: add as waypoint, details). The ref keeps the click current.
  const addRef = useRef(addStation)
  addRef.current = addStation
  const inPlan = wps.map((w) => w.station ?? '').join(',')
  useEffect(() => {
    if (!d || !stations) return
    const used = new Set(inPlan.split(','))
    mmap.setStations(
      stations.map((s) => ({ id: s.id, name: s.name, lon: s.lon, lat: s.lat, detailHref: href({ name: 'station', id: s.id }), inPlan: used.has(s.id) })),
      (id) => addRef.current(id),
    )
  }, [d, stations, inPlan])

  if (error) return <div class="panel-body"><DataProblem error={error} what={t('mission.loading.what')} /></div>
  if (!d) return <div class="panel-body"><p class="muted">{t('mission.loading.step', { step })}</p></div>

  return (
    <div class="panel-body mp-body">
      <DummyNote />
      {notice && <p class="mp-notice">{notice}</p>}

      <PadPick choices={d.padChoices} pad={pad} loaded={d.fieldsPad} onPick={setPad} />

      <section class="mp-card">
        <h3>{t('mission.estimates.title')}</h3>
        <Estimates b={budget} n={wps.length} routing={routingN} />
      </section>

      {clock && (
        <section class="mp-card">
          <details>
            <summary>{t('mission.start.title')}</summary>
            <StartTime startMs={startMs} clock={clock} onChange={setStartMs} sunSiteLabel={t('mission.start.sunSite', { lat: d.pad.lat.toFixed(5), lon: d.pad.lon.toFixed(5) })} />
          </details>
        </section>
      )}

      <section class="mp-card">
        <details ref={wpDetails}>
          <summary>
            {t('mission.waypoints.title')} <span class="muted">{t('mission.waypoints.count', { n: wps.length })}</span>
          </summary>
          <WaypointList wps={wps} legs={legsNow} setWps={setWps} />
          {wps.length > 0 && (
            <div class="mp-share">
              <button type="button" class="mp-clear" onClick={copyLink}>
                {copied ? t('mission.waypoints.linkCopied') : t('mission.waypoints.copyLink')}
              </button>
            </div>
          )}
        </details>
        <details>
          <summary>{t('mission.boundary.title')}</summary>
          <label class="mp-select">
            <span class="sr-only">{t('mission.boundary.selectLabel')}</span>
            <select value={boundary} onChange={(e) => setBoundary((e.target as HTMLSelectElement).value)}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <p class="caption">
            {tx('mission.boundary.caption', { file: <code>{boundaryFile(boundary, d)}</code>, scenario: d.scenario.id })}
          </p>
        </details>
      </section>

      <section class="mp-card mp-export">
        <button type="button" disabled={!wps.length || routingN > 0} onClick={() => void exportMission()} title={routingN > 0 ? t('mission.export.routingTitle') : t('mission.export.buttonTitle')}>
          {t('mission.export.button')}
        </button>
        {/* J1 (D132): the export labels its provenance (mission.json origin_label) */}
        <p class="caption mp-origin">{originLabel(customStart)}</p>
        {margin && (
          <span class="muted">
            {' '}
            {t('mission.export.lowestMargin', { margin: margin.lowest.marginMin.toFixed(1), binding: margin.lowest.binding })}
          </span>
        )}
        <label class="mp-storm" title={d.rad ? t('mission.export.stormTitle') : t('mission.export.stormNoRad')}>
          <input type="checkbox" checked={storm && !!d.rad} disabled={!d.rad} onChange={(e) => setStorm((e.target as HTMLInputElement).checked)} />{' '}
          {t('mission.export.storm', { date: STORM_DATE })}
        </label>
      </section>

      <p class="caption mp-howto">
        {tx('mission.help.howto', { res_m: d.grid.resM, scenario: <code>{d.scenario.id}</code> })}
      </p>

      <p class="caption mp-sources">
        <b>{t('mission.help.sourcesLead')}</b>{' '}
        {tx('mission.help.sources', {
          crew: <code>config/crew.yaml</code>,
          variants: <code>config/variants.yaml</code>,
          res_m: d.grid.resM,
          elevation_res_m: d.elevationResM,
          elevation_file: <code>{d.files.elevation}</code>,
          route_res_m: ENGINE_ROUTE_RES_M,
          fields: (
            <>
              <code>{d.files.tHome}</code>
              {d.files.o2Home ? (
                <>
                  , <code>{d.files.o2Home}</code>
                </>
              ) : null}
            </>
          ),
          o2_source: <code>{CITED.o2PrimaryL.source}</code>,
          reserve_min: CITED.o2ReserveMinAtEffortCap.value,
          eva_h: CITED.evaH.value,
          crew_file: <code>crew.yaml</code>,
          rate_key: <code>o2_margin.station_task_rate_btu_h</code>,
          rate: BUDGET_CONSTANTS.stationRateLMin.toFixed(3),
        })}
        {credit ? ` ${t('mission.help.basemap', { credit })}` : ''}
      </p>
    </div>
  )
}

function boundaryFile(id: string, d: MissionData): string {
  if (id.startsWith('band:')) return d.files.bands ?? '–'
  if (id.startsWith('iso:')) return d.files.isochrones ?? '–'
  if (id.startsWith('edges:')) return d.files.edges ?? '–'
  return '–'
}

function Row({ k, v, cls, title }: { k: string; v: string; cls?: string; title?: string }) {
  return (
    <div class={`mp-row${cls ? ` ${cls}` : ''}`} title={title}>
      <span>{k}</span>
      <b>{v}</b>
    </div>
  )
}

const sign = (v: number | null) => (v === null ? '' : v < 0 ? 'mp-bad' : 'mp-ok')

function Estimates({ b, n, routing }: { b: MissionBudget; n: number; routing: number }) {
  if (routing > 0) return <p class="mp-notice">{t('mission.estimates.routing', { n: routing })}</p>
  if (!b.legsKnown) return <p class="mp-notice">{t('mission.estimates.notRouted')}</p>
  return (
    <div class="mp-est">
      <Row k={n ? t('mission.estimates.timeHomeFrom', { n }) : t('mission.estimates.timeHome')} v={fmtMin(b.tHomeMin)} title={t('mission.estimates.timeHomeTitle')} />
      <Row k={t('mission.estimates.walkOut')} v={fmtMin(b.walkMin)} />
      <Row k={t('mission.estimates.atWaypoints')} v={fmtMin(b.stopMin)} title={t('mission.estimates.atWaypointsTitle')} />
      <Row k={t('mission.estimates.evaTotal')} v={b.evaMin === null ? '–' : t('mission.estimates.evaTotalValue', { used: b.evaMin.toFixed(1), limit: b.evaLimitMin })} />
      <Row k={t('mission.estimates.timeMargin')} v={fmtMin(b.timeMarginMin)} cls={sign(b.timeMarginMin)} title={t('mission.estimates.timeMarginTitle')} />
      <div class="mp-sep" />
      <Row k={t('mission.estimates.o2Left')} v={fmtL(b.o2LeftL)} title={t('mission.estimates.o2LeftTitle', { capacity: b.o2CapacityL.toFixed(1), used: fmtL(b.o2UsedL), stops: b.o2StopsL.toFixed(1) })} />
      {b.stopMin > 0 && <Row k={t('mission.estimates.o2Stops')} v={fmtL(b.o2StopsL)} title={t('mission.estimates.o2StopsTitle', { minutes: b.stopMin.toFixed(0), rate: BUDGET_CONSTANTS.stationRateLMin.toFixed(3) })} />}
      <Row k={t('mission.estimates.o2Need')} v={b.o2NeedL === null ? '–' : `${b.o2NeedL.toFixed(1)} L`} title={t('mission.estimates.o2NeedTitle', { home: fmtL(b.o2HomeL), reserve: b.reserveL.toFixed(1) })} />
      <Row k={t('mission.estimates.o2Margin')} v={b.o2MarginL === null ? '–' : t('mission.estimates.o2MarginValue', { litres: b.o2MarginL.toFixed(1), minutes: b.o2MarginMin!.toFixed(0) })} cls={sign(b.o2MarginL)} />
    </div>
  )
}

function WaypointList({ wps, legs, setWps }: { wps: Waypoint[]; legs: (Leg | null | undefined)[]; setWps: (f: (w: Waypoint[]) => Waypoint[]) => void }) {
  if (!wps.length) return <p class="muted mp-empty">{t('mission.waypoints.empty')}</p>
  return (
    <>
      <ol class="mp-list">
        {wps.map((w, i) => {
          const l = legs[i]
          return (
            <li key={w.id} class={l === null ? 'mp-li-bad' : ''}>
              <div class="mp-li-head">
                <span class="mp-num">{i + 1}</span>
                <span class="mp-leg">
                  {i === 0 ? t('mission.waypoints.legFromPad', { to: i + 1 }) : t('mission.waypoints.legFrom', { from: i, to: i + 1 })}
                  {w.station && (
                    <a class="mp-st-link" href={href({ name: 'station', id: w.station })} title={t('mission.waypoints.stationLinkTitle')}>
                      {t('mission.waypoints.stationLink', { id: w.station })}
                    </a>
                  )}
                </span>
                <span class="mp-actions">
                  <button type="button" title={t('mission.waypoints.moveUp')} aria-label={t('mission.waypoints.moveUpLabel', { n: i + 1 })} disabled={i === 0} onClick={() => setWps((x) => moveWaypoint(x, i, -1))}>
                    {t('mission.waypoints.moveUpIcon')}
                  </button>
                  <button type="button" title={t('mission.waypoints.moveDown')} aria-label={t('mission.waypoints.moveDownLabel', { n: i + 1 })} disabled={i === wps.length - 1} onClick={() => setWps((x) => moveWaypoint(x, i, 1))}>
                    {t('mission.waypoints.moveDownIcon')}
                  </button>
                  <button type="button" title={t('mission.waypoints.remove')} aria-label={t('mission.waypoints.removeLabel', { n: i + 1 })} onClick={() => setWps((x) => removeWaypoint(x, i))}>
                    {t('mission.waypoints.removeIcon')}
                  </button>
                </span>
              </div>
              <div class="mp-li-body">
                {l ? (
                  <>
                    {t('mission.waypoints.legStats', { minutes: (l.timeS / 60).toFixed(1), distance: fmtM(l.distM), o2: l.o2L.toFixed(1) })}
                  </>
                ) : l === undefined ? (
                  <span class="muted">{t('mission.waypoints.routing')}</span>
                ) : (
                  <span class="mp-bad">{t('mission.waypoints.noRoute')}</span>
                )}
              </div>
              <WaypointEditor w={w} n={i + 1} onChange={(nw) => setWps((x) => x.map((y) => (y.id === w.id ? nw : y)))} />
            </li>
          )
        })}
      </ol>
      <button type="button" class="mp-clear" onClick={() => setWps(() => [])}>
        {t('mission.waypoints.clearAll')}
      </button>
    </>
  )
}

/** Marker tooltip text: stop time, tags, note. */
function waypointInfo(w: Waypoint): string {
  const parts: string[] = []
  if (w.stopMin > 0) parts.push(t('mission.waypoints.markerStop', { minutes: w.stopMin }))
  if (w.tags.length) parts.push(w.tags.join(', '))
  if (w.note.trim()) parts.push(w.note.trim())
  return parts.join(' · ')
}

function WaypointEditor({ w, n, onChange }: { w: Waypoint; n: number; onChange: (w: Waypoint) => void }) {
  const summary = waypointInfo(w)
  const o2 = w.stopMin * BUDGET_CONSTANTS.stationRateLMin
  return (
    <details class="mp-wpe">
      <summary>{summary || <span class="muted">{t('mission.editor.addDetails')}</span>}</summary>
      <label class="mp-wpe-stop">
        <span>{t('mission.editor.plannedStop')}</span>
        <input
          type="number"
          min={0}
          step={5}
          inputMode="numeric"
          placeholder="0"
          aria-label={t('mission.editor.plannedStopLabel', { n })}
          value={w.stopMin || ''}
          onInput={(e) => onChange({ ...w, stopMin: stopMinutes(parseFloat((e.target as HTMLInputElement).value)) })}
        />
        <span>{t('mission.editor.unit')}</span>
        {w.stopMin > 0 && <span class="muted">{t('mission.editor.stopO2', { o2: o2.toFixed(1) })}</span>}
      </label>
      <div class="mp-tags" role="group" aria-label={t('mission.editor.tagsLabel', { n })}>
        {WAYPOINT_TAGS.map((tag) => (
          <button type="button" key={tag} class={w.tags.includes(tag) ? 'on' : ''} aria-pressed={w.tags.includes(tag)} onClick={() => onChange({ ...w, tags: toggleTag(w.tags, tag) })}>
            {tag}
          </button>
        ))}
      </div>
      <textarea
        rows={2}
        placeholder={t('mission.editor.notePlaceholder')}
        aria-label={t('mission.editor.noteLabel', { n })}
        value={w.note}
        onInput={(e) => onChange({ ...w, note: (e.target as HTMLTextAreaElement).value })}
      />
    </details>
  )
}
