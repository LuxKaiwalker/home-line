// "/mission" Mission Planer: the main planning area where waypoints are made. Left: the 2D map
// (HiRISE basemap, reachable-area boundary, pad, waypoints, legs, way home). Right: estimated times
// and consumption, then the waypoint list and the boundary picker. Click the map to add a
// waypoint; each leg is routed in the browser (src/mission/router.ts), the way home from the last
// waypoint is WS2's (pointer field, T_home, O2 home).
// Each waypoint carries a note, quick tags and a planned stop time (station work: EVA time + O2).
// Later (PDF "Mission Planer"): O2 / radiation budget dropdown, reachable foundries, Save.
import '../mission/mission.css'
import { render } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { CITED, CONFIG } from '../config'
import { DataProblem, DummyNote } from '../components/labels'
import { BASEMAP_CREDIT, basemapSources } from '../map/basemap'
import { dataUrl } from '../env'
import { BUDGET_CONSTANTS, missionBudget, stopMinutes, type MissionBudget } from '../mission/budget'
import { loadMissionData, type MissionData } from '../mission/data'
import { MissionMap } from '../mission/missionMap'
import { MapsControl } from '../mission/MapsControl'
import { boundaryOptions, defaultBoundary, legPairs, moveWaypoint, removeWaypoint, replaceWaypoint, routeLegs, toggleTag, WAYPOINT_TAGS, type LonLat, type Waypoint } from '../mission/plan'
import { LegRouter, type Leg } from '../mission/router'
import { ensureManifest } from './common'
import type { View } from './types'

export const view: View = async (el) => {
  el.innerHTML = `<div class="console mission"><div class="console-map mission-map"></div><aside class="console-panel mission-panel"></aside></div>`
  const mapEl = el.querySelector<HTMLElement>('.mission-map')!
  const panelEl = el.querySelector<HTMLElement>('.mission-panel')!
  await ensureManifest()
  const handlers = { onAdd: (_lon: number, _lat: number) => {}, onMove: (_i: number, _lon: number, _lat: number) => {} }
  const mmap = new MissionMap(mapEl, { onAdd: (a, b) => handlers.onAdd(a, b), onMove: (i, a, b) => handlers.onMove(i, a, b) })
  const mapsEl = document.createElement('div')
  // The switcher sits inside the MapLibre container: keep its clicks from adding waypoints.
  for (const ev of ['mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'wheel']) mapsEl.addEventListener(ev, (e) => e.stopPropagation())
  mapEl.append(mapsEl)
  render(<MissionPanel mmap={mmap} handlers={handlers} mapsEl={mapsEl} />, panelEl)
  return () => {
    render(null, mapsEl)
    render(null, panelEl)
    mmap.destroy()
  }
}

type Handlers = { onAdd: (lon: number, lat: number) => void; onMove: (i: number, lon: number, lat: number) => void }

const fmtMin = (v: number | null, digits = 1) => (v === null ? '–' : `${v.toFixed(digits)} min`)
const fmtL = (v: number | null, digits = 1) => (v === null ? '–' : `${v.toFixed(digits)} L`)
const fmtM = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} km` : `${Math.round(v)} m`)

function MissionPanel({ mmap, handlers, mapsEl }: { mmap: MissionMap; handlers: Handlers; mapsEl: HTMLElement }) {
  const [d, setD] = useState<MissionData | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [step, setStep] = useState('scenarios and pad')
  const [wps, setWps] = useState<Waypoint[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [boundary, setBoundary] = useState('none')
  const [credit, setCredit] = useState<string | null>(null)
  const nextId = useRef(1)
  const cache = useRef(new Map<string, Leg | null>())

  // Load once.
  useEffect(() => {
    let alive = true
    loadMissionData(undefined, (s) => alive && setStep(s)).then(
      async (md) => {
        if (!alive) return
        setD(md)
        mmap.setPad({ lon: md.pad.lon, lat: md.pad.lat, title: md.pad.title })
        mmap.fitTo([[md.pad.lon, md.pad.lat]])
        if (md.tilejson) {
          await mmap.setBasemap(basemapSources(md.tilejson, (p) => dataUrl(p)))
          setCredit(md.tilejson.attribution ?? BASEMAP_CREDIT)
        }
        await mmap.setBoundaryData(md)
        // Maps switcher (bottom left of the map): satellite / topography / material.
        render(<MapsControl mmap={mmap} src={{ grid: md.tHome, elev: md.grid.elev, resM: md.grid.resM, hasBasemap: !!md.tilejson }} />, mapsEl)
        setBoundary(defaultBoundary(boundaryOptions(md.bands, md.isochrones, md.edges), CONFIG.walkbackBudgetsMin[0]))
      },
      (e) => alive && setError(e),
    )
    return () => {
      alive = false
    }
  }, [])

  const router = useMemo(() => (d ? new LegRouter(d.grid, d.model) : null), [d])
  const padCell = useMemo(() => {
    if (!d) return -1
    const p = d.tHome.pixelOf(d.pad.lon, d.pad.lat)
    return p ? p.row * d.tHome.width + p.col : -1
  }, [d])
  const options = useMemo(() => (d ? boundaryOptions(d.bands, d.isochrones, d.edges) : []), [d])

  /** Snap a click to the routing grid: null + a notice when the spot cannot be walked from. */
  const snap = (lon: number, lat: number): number | null => {
    if (!d) return null
    const p = d.tHome.pixelOf(lon, lat)
    if (!p) {
      setNotice('That spot is outside the terrain data: no waypoint added.')
      return null
    }
    const cell = p.row * d.tHome.width + p.col
    if (!d.grid.passable[cell]) {
      setNotice(`No walk home from that spot in ${d.scenario.id} (blocked, too steep, unknown terrain or not reached): no waypoint there.`)
      return null
    }
    setNotice(null)
    return cell
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
  const legs = useMemo<(Leg | null)[]>(() => {
    if (!router || padCell < 0) return []
    return routeLegs(legPairs(padCell, wps), (a, b) => router.route(a, b), cache.current)
  }, [router, padCell, wps])

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

  // Draw.
  useEffect(() => {
    if (!d) return
    mmap.setWaypoints(wps.map((w, i) => ({ lon: w.lon, lat: w.lat, bad: legs[i] === null, info: waypointInfo(w) })))
    const toLL = (c: number): LonLat => d.tHome.lonLatOf(Math.floor(c / d.tHome.width), c % d.tHome.width)
    void mmap.setRoute(
      legs.map((l) => (l ? l.cells.map(toLL) : [])),
      home.path,
    )
  }, [d, wps, legs, home])

  useEffect(() => void mmap.showBoundary(options.find((o) => o.id === boundary)), [boundary, options])

  if (error) return <div class="panel-body"><DataProblem error={error} what="Mission Planer data" /></div>
  if (!d) return <div class="panel-body"><p class="muted">Loading {step}…</p></div>

  return (
    <div class="panel-body mp-body">
      <h2>Mission Planer</h2>
      <DummyNote />
      <p class="caption">
        Click the map to add a waypoint. Each leg is the fastest walk on the {d.grid.resM} m grid for <code>{d.scenario.id}</code>; the dashed line is the way home from the last waypoint.
      </p>
      {notice && <p class="mp-notice">{notice}</p>}

      <section class="mp-card">
        <h3>Estimated times and consumption</h3>
        <Estimates b={budget} n={wps.length} />
      </section>

      <section class="mp-card">
        <details open>
          <summary>
            Waypoints <span class="muted">({wps.length})</span>
          </summary>
          <WaypointList wps={wps} legs={legs} setWps={setWps} />
        </details>
        <details open>
          <summary>Reachable-area boundary</summary>
          <label class="mp-select">
            <span class="sr-only">Boundary shown on the map</span>
            <select value={boundary} onChange={(e) => setBoundary((e.target as HTMLSelectElement).value)}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <p class="caption">
            From <code>{boundaryFile(boundary, d)}</code> ({d.scenario.id}): the area from which the crew can walk back to the pad within that time.
          </p>
        </details>
      </section>

      <p class="caption mp-sources">
        <b>Estimates.</b> Leg times and leg O₂ are computed in your browser with the engine's walking model (<code>config/crew.yaml</code>, <code>config/variants.yaml</code>) on
        the {d.grid.resM} m grid with {d.elevationResM} m terrain heights (<code>{d.files.elevation}</code>), so they can differ from WS2's 3 m routes. Time home and O₂ home come
        from WS2's fields (<code>{d.files.tHome}</code>
        {d.files.o2Home ? (
          <>
            , <code>{d.files.o2Home}</code>
          </>
        ) : null}
        ). O₂ capacity: primary supply per <code>{CITED.o2PrimaryL.source}</code> (computed from its formula); reserve: {CITED.o2ReserveMinAtEffortCap.value} min at the effort cap; EVA limit: {CITED.evaH.value} h. Planned time at a waypoint is station work at the station task rate (<code>crew.yaml</code> <code>o2_margin.station_task_rate_btu_h</code>, {BUDGET_CONSTANTS.stationRateLMin.toFixed(3)} L/min); tags and notes are labels only.
        {credit ? ` Basemap: ${credit}.` : ''}
      </p>
    </div>
  )
}

function boundaryFile(id: string, d: MissionData): string {
  if (id.startsWith('band:')) return d.files.bands
  if (id.startsWith('iso:')) return d.files.isochrones
  if (id.startsWith('edges:')) return d.files.edges
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

function Estimates({ b, n }: { b: MissionBudget; n: number }) {
  if (!b.legsKnown) return <p class="mp-notice">A leg could not be routed (see the waypoint list): times and O₂ are unknown until it is moved or removed.</p>
  return (
    <div class="mp-est">
      <Row k={n ? `Time home from #${n}` : 'Time home'} v={fmtMin(b.tHomeMin)} title="WS2 T_home at the last waypoint (fastest walk back to the pad)" />
      <Row k="Walk out (all legs)" v={fmtMin(b.walkMin)} />
      <Row k="Time at waypoints" v={fmtMin(b.stopMin)} title="Sum of the planned stop times" />
      <Row k="EVA total" v={b.evaMin === null ? '–' : `${b.evaMin.toFixed(1)} of ${b.evaLimitMin} min`} />
      <Row k="Time margin" v={fmtMin(b.timeMarginMin)} cls={sign(b.timeMarginMin)} title="EVA limit − walk out − time home" />
      <div class="mp-sep" />
      <Row k="O₂ left at the last waypoint" v={fmtL(b.o2LeftL)} title={`${b.o2CapacityL.toFixed(1)} L primary supply − ${fmtL(b.o2UsedL)} used (legs + ${b.o2StopsL.toFixed(1)} L at stops)`} />
      {b.stopMin > 0 && <Row k="O₂ for stops" v={fmtL(b.o2StopsL)} title={`${b.stopMin.toFixed(0)} min × ${BUDGET_CONSTANTS.stationRateLMin.toFixed(3)} L/min station task rate`} />}
      <Row k="O₂ needed (home + reserve)" v={b.o2NeedL === null ? '–' : `${b.o2NeedL.toFixed(1)} L`} title={`O₂ home ${fmtL(b.o2HomeL)} + reserve ${b.reserveL.toFixed(1)} L`} />
      <Row k="O₂ margin" v={b.o2MarginL === null ? '–' : `${b.o2MarginL.toFixed(1)} L · ${b.o2MarginMin!.toFixed(0)} min at max effort`} cls={sign(b.o2MarginL)} />
    </div>
  )
}

function WaypointList({ wps, legs, setWps }: { wps: Waypoint[]; legs: (Leg | null)[]; setWps: (f: (w: Waypoint[]) => Waypoint[]) => void }) {
  if (!wps.length) return <p class="muted mp-empty">No waypoints yet: click the map.</p>
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
                  {i === 0 ? 'Pad' : `#${i}`} → #{i + 1}
                </span>
                <span class="mp-actions">
                  <button type="button" title="Move up" aria-label={`Move waypoint ${i + 1} up`} disabled={i === 0} onClick={() => setWps((x) => moveWaypoint(x, i, -1))}>
                    ↑
                  </button>
                  <button type="button" title="Move down" aria-label={`Move waypoint ${i + 1} down`} disabled={i === wps.length - 1} onClick={() => setWps((x) => moveWaypoint(x, i, 1))}>
                    ↓
                  </button>
                  <button type="button" title="Delete" aria-label={`Delete waypoint ${i + 1}`} onClick={() => setWps((x) => removeWaypoint(x, i))}>
                    ✕
                  </button>
                </span>
              </div>
              <div class="mp-li-body">
                {l ? (
                  <>
                    {(l.timeS / 60).toFixed(1)} min · {fmtM(l.distM)} · {l.o2L.toFixed(1)} L O₂
                  </>
                ) : (
                  <span class="mp-bad">no walkable route from the previous point</span>
                )}
              </div>
              <WaypointEditor w={w} n={i + 1} onChange={(nw) => setWps((x) => x.map((y) => (y.id === w.id ? nw : y)))} />
            </li>
          )
        })}
      </ol>
      <button type="button" class="mp-clear" onClick={() => setWps(() => [])}>
        Clear all
      </button>
    </>
  )
}

/** Marker tooltip text: stop time, tags, note. */
function waypointInfo(w: Waypoint): string {
  const parts: string[] = []
  if (w.stopMin > 0) parts.push(`stop ${w.stopMin} min`)
  if (w.tags.length) parts.push(w.tags.join(', '))
  if (w.note.trim()) parts.push(w.note.trim())
  return parts.join(' · ')
}

function WaypointEditor({ w, n, onChange }: { w: Waypoint; n: number; onChange: (w: Waypoint) => void }) {
  const summary = waypointInfo(w)
  const o2 = w.stopMin * BUDGET_CONSTANTS.stationRateLMin
  return (
    <details class="mp-wpe">
      <summary>{summary || <span class="muted">Add stop time, tags, note</span>}</summary>
      <label class="mp-wpe-stop">
        <span>Planned stop</span>
        <input
          type="number"
          min={0}
          step={5}
          inputMode="numeric"
          placeholder="0"
          aria-label={`Planned stop time at waypoint ${n} in minutes`}
          value={w.stopMin || ''}
          onInput={(e) => onChange({ ...w, stopMin: stopMinutes(parseFloat((e.target as HTMLInputElement).value)) })}
        />
        <span>min</span>
        {w.stopMin > 0 && <span class="muted">≈ {o2.toFixed(1)} L O₂</span>}
      </label>
      <div class="mp-tags" role="group" aria-label={`Tags for waypoint ${n}`}>
        {WAYPOINT_TAGS.map((t) => (
          <button type="button" key={t} class={w.tags.includes(t) ? 'on' : ''} aria-pressed={w.tags.includes(t)} onClick={() => onChange({ ...w, tags: toggleTag(w.tags, t) })}>
            {t}
          </button>
        ))}
      </div>
      <textarea
        rows={2}
        placeholder="Note: resource, task, what to carry out here…"
        aria-label={`Note for waypoint ${n}`}
        value={w.note}
        onInput={(e) => onChange({ ...w, note: (e.target as HTMLTextAreaElement).value })}
      />
    </details>
  )
}
