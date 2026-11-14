// /nav (F21, F22; SPEC §2.4): the fix-interval map per drift set, the estimated track (true track
// behind "show truth"), 95% ellipses, fix events, playback with the ellipse in force and the HUD
// position line, the headline and the method. Simulated dead reckoning on real terrain; the page
// says plainly that this is a concept, not a navigation system.
import { render } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { CITED, CONFIG } from '../config'
import { AssumedTag, DataProblem, DummyNote, SimulatedLabel } from '../components/labels'
import { CfgNum, Num } from '../components/Num'
import type { FieldsIndex, RouteFC, Station } from '../data/types'
import type { DataMode } from '../env'
import { formatValue } from '../prov/provenance'
import { ensureManifest } from '../views/common'
import { EllipseChart } from './chart'
import { NAV, navSource } from './config'
import { classifyRGBA, classLabels, decodeRGBA, valueAt, type DecodedField } from './fixclass'
import { ellipseRingLonLat, sphereMetric } from './geom'
import { createNavLoader, slotFetcher, SUMMARY_PATH, type NavLoader } from './load'
import { NavMap, NAV_DEFAULT_VISIBLE, type FixPoint, type NavLayer } from './navmap'
import { fmtEva, navLine, navReading } from './navstate'
import { ellipsesUpTo, filterFixes, interpAlong, lineWithTimes, routeKnots, trackLine } from './series'
import { NAV_THEME, rgb } from './theme'
import type { Fix, FixIntervalSummary, FixType, LonLat, MonteCarlo, TracksFC } from './types'
import './nav.css'

export interface NavContext {
  dataUrl: (path: string) => string
  dataMode: DataMode
}

const FIX_TYPES: FixType[] = ['rover', 'station', 'skyline']
const LAYER_LABELS: Record<NavLayer, string> = {
  fixint: 'Fix-interval map (D_max classes)',
  ellipses: `95% ellipses every ${NAV.ellipseEveryMin} min`,
  estimated: 'Estimated track (sample run)',
  truth: 'Show truth (true track)',
  route: 'Planned route',
  fixes: 'Fix events',
}

export async function mountNav(el: HTMLElement, ctx: NavContext): Promise<() => void> {
  await ensureManifest()
  el.innerHTML = `<div class="console nav-view"><div class="console-map nav-map"></div><aside class="console-panel nav-side"></aside></div>`
  const mapEl = el.querySelector<HTMLElement>('.nav-map')!
  const side = el.querySelector<HTMLElement>('.nav-side')!
  const nmap = new NavMap(mapEl)
  const loader = createNavLoader(slotFetcher(ctx.dataUrl), ctx.dataMode)
  render(<NavSide nmap={nmap} loader={loader} ctx={ctx} />, side)
  return () => {
    render(null, side)
    nmap.destroy()
  }
}

// ------------------------------------------------------------------------------------------------
// data
// ------------------------------------------------------------------------------------------------

interface BaseData {
  route: RouteFC | null
  stations: Station[]
  index: FieldsIndex | null
  fixes: Fix[] | null
  fixesErr: unknown
  available: string[]
}

interface SetData {
  set: string
  mc: MonteCarlo | null
  tracks: TracksFC | null
  dmax: DecodedField | null
  dmaxImage: string | null
  summary: FixIntervalSummary | null
  /** set named in the single summary file when it is not this set */
  summaryOther: string | null
  errors: { what: string; error: unknown }[]
}

async function loadBase(L: NavLoader): Promise<BaseData> {
  const B = L.base
  const idx = await B.optional(() => B.scenarios())
  const scenario = idx?.default ?? null
  let fixesErr: unknown = null
  const [route, stations, index, fixes, ...mcs] = await Promise.all([
    scenario ? B.optional(() => B.route(scenario)).catch(() => null) : Promise.resolve(null),
    B.optional(() => B.stations()).catch(() => null),
    B.optional(() => B.fieldsIndex()).catch(() => null),
    L.optional(() => L.fixes()).catch((e) => {
      fixesErr = e
      return null
    }),
    ...NAV.sets.map((s) => L.optional(() => L.montecarlo(s)).then((m) => (m ? s : null), () => s)),
  ])
  return { route, stations: stations ?? [], index, fixes, fixesErr, available: mcs.filter((s): s is string => !!s) }
}

async function loadField(url: string, scale: number): Promise<DecodedField> {
  const img = new Image()
  img.src = url
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0)
  return decodeRGBA(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height, scale)
}

async function loadSet(L: NavLoader, set: string, index: FieldsIndex | null, dataUrl: (p: string) => string): Promise<SetData> {
  const errors: SetData['errors'] = []
  const opt = async <T,>(what: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await L.optional(fn)
    } catch (e) {
      errors.push({ what, error: e })
      return null
    }
  }
  const entry = index?.fields[`fix_interval_${set}`]
  const [mc, tracks, summaryAny, dmax] = await Promise.all([
    opt('Monte Carlo summary', () => L.montecarlo(set)),
    opt('Tracks', () => L.tracks(set)),
    opt('Fix-interval summary', () => L.summaryAny()),
    entry
      ? loadField(dataUrl(entry.file), entry.scale).catch((e) => {
          errors.push({ what: 'Fix-interval field', error: e })
          return null
        })
      : Promise.resolve(null),
  ])
  let dmaxImage: string | null = null
  if (dmax) {
    const rgba = classifyRGBA(dmax, NAV.classesM, NAV_THEME.classColours, NAV_THEME.classAlpha)
    const c = document.createElement('canvas')
    c.width = dmax.width
    c.height = dmax.height
    c.getContext('2d')!.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, dmax.width, dmax.height), 0, 0)
    dmaxImage = c.toDataURL('image/png')
  }
  const summary = summaryAny && summaryAny.set === set ? summaryAny : null
  return { set, mc, tracks, dmax, dmaxImage, summary, summaryOther: summaryAny && !summary ? summaryAny.set : null, errors }
}

/** Where the crew thinks it is at t: the sample estimated track if it has vertex times, else the planned route. */
function positionSource(tracks: TracksFC | null, route: RouteFC | null) {
  const est = tracks ? trackLine(tracks, 'estimated') : null
  const timed = est ? lineWithTimes(est) : null
  if (timed) return { label: 'sample estimated track', at: (t: number): LonLat => interpAlong(timed.coords, timed.times, t) }
  if (route) {
    const k = routeKnots(route.features as never, sphereMetric(CONFIG.padDefault.lat, CONFIG.marsRadiusM))
    if (k.coords.length) return { label: 'planned route (the estimated track has no vertex times)', at: (t: number): LonLat => interpAlong(k.coords, k.times, t) }
  }
  return null
}

function fixPoints(fixes: Fix[], at: ((t: number) => LonLat) | null, stations: Station[]): FixPoint[] {
  const byId = new Map(stations.map((s) => [s.id, s]))
  return fixes.map((fix) => {
    const st = fix.station ? byId.get(fix.station) : undefined
    const p: LonLat = st ? [st.lon, st.lat] : at ? at(fix.t_eva_min) : [CONFIG.padDefault.lon, CONFIG.padDefault.lat]
    return { fix, at: p }
  })
}

/** A value read from a per-minute row at the playback time: cites its file and row (the file's numbers are recorded per file in the manifest). */
function RowNum({ v, units, file, t }: { v: number | null; units?: string; file: string; t: number | null }) {
  return (
    <span class="num num-row" title={`per-minute row t = ${t ?? '?'} min of ${file} (held, not interpolated)`}>
      {formatValue(v, units)}
    </span>
  )
}

// ------------------------------------------------------------------------------------------------
// side panel
// ------------------------------------------------------------------------------------------------

function NavSide({ nmap, loader, ctx }: { nmap: NavMap; loader: NavLoader; ctx: NavContext }) {
  const [base, setBase] = useState<BaseData | null>(null)
  const [baseErr, setBaseErr] = useState<unknown>(null)
  const [set, setSet] = useState<string>(NAV.defaultSet)
  const [sd, setSd] = useState<SetData | null>(null)
  const [visible, setVisible] = useState<Record<NavLayer, boolean>>({ ...NAV_DEFAULT_VISIBLE })
  const [types, setTypes] = useState<Set<FixType>>(new Set(FIX_TYPES))
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(NAV.defaultSpeed)
  const [probe, setProbe] = useState<{ v: number | null } | null>(null)

  useEffect(() => {
    let alive = true
    loadBase(loader).then((b) => alive && setBase(b), (e) => alive && setBaseErr(e))
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    if (!base) return
    let alive = true
    setSd(null)
    loadSet(loader, set, base.index, ctx.dataUrl).then((d) => alive && setSd(d))
    return () => {
      alive = false
    }
  }, [base, set])

  const tEnd = useMemo(() => {
    const rows = sd?.mc?.per_minute ?? []
    return rows.length ? Math.max(...rows.map((r) => r.t_eva_min)) : CITED.evaH.value * 60
  }, [sd])

  // playback: EVA minutes advance at `speed` x real time
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      const dt = ((now - last) / 60000) * speed
      last = now
      setT((v) => {
        const nv = Math.min(tEnd, v + dt)
        if (nv >= tEnd) setPlaying(false)
        return nv
      })
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, tEnd])

  const pos = useMemo(() => positionSource(sd?.tracks ?? null, base?.route ?? null), [sd, base])
  const at = pos ? pos.at(t) : null
  const bounds = base?.index?.bounds as [number, number, number, number] | undefined
  const reading = useMemo(() => {
    const d = at && sd?.dmax && bounds ? valueAt(sd.dmax, bounds, at[0], at[1]) : null
    return navReading(t, sd?.mc ?? null, base?.fixes ?? [], d)
  }, [t, sd, base, at?.[0], at?.[1]])

  // map
  useEffect(() => {
    nmap.setVisible(visible)
  }, [visible])
  useEffect(() => {
    nmap.whenReady().then(() => nmap.setRoute((base?.route as never) ?? null))
  }, [base])
  useEffect(() => {
    nmap.onPointer = (p) => setProbe(p && sd?.dmax && bounds ? { v: valueAt(sd.dmax, bounds, p.lon, p.lat) } : null)
    nmap.whenReady().then(() => {
      const tr = sd?.tracks
      nmap.setTracks(tr ? (trackLine(tr, 'true')?.feature ?? null) : null, tr ? (trackLine(tr, 'estimated')?.feature ?? null) : null, tr ? ellipsesUpTo(tr, Infinity) : [])
      nmap.setFixInterval(sd?.dmaxImage ?? null, bounds)
      const pts: LonLat[] = []
      if (tr) for (const k of ['true', 'estimated']) trackLine(tr, k)?.parts.forEach((p) => pts.push(...p))
      nmap.fitTo(pts)
    })
  }, [sd])
  useEffect(() => {
    nmap.whenReady().then(() => nmap.setFixes(fixPoints(filterFixes(base?.fixes ?? [], types), pos?.at ?? null, base?.stations ?? [])))
  }, [base, types, pos])
  useEffect(() => {
    nmap.whenReady().then(() => {
      const ring = at && reading.ellipse ? ellipseRingLonLat(at, reading.ellipse, sphereMetric(at[1], CONFIG.marsRadiusM), NAV.ellipseVertices) : null
      nmap.setNow(at, ring)
    })
  }, [at?.[0], at?.[1], reading.ellipse])

  if (baseErr) return <div class="panel-body"><DataProblem error={baseErr} what="Navigation data" /></div>
  if (!base) return <div class="panel-body muted">Loading…</div>

  const mcFile = `nav/montecarlo_${set}.json`
  const F = 'nav/fixes.json'
  const S = SUMMARY_PATH
  const dmaxFile = `fields/fix_interval_${set}.png`
  const summary = sd?.summary
  const labels = classLabels(NAV.classesM)
  const fixes = base.fixes ?? []

  return (
    <div class="panel-body nav-panel-body">
      <h2>Navigation without GPS</h2>
      <p>
        <SimulatedLabel /> <DummyNote />
      </p>
      <p class="muted">
        Simulated suit dead reckoning (a concept, with assumed parameters) plus periodic fixes. Mars has no GPS; rovers use visual odometry and matching to
        orbital maps. HOMELINE takes position as an input with uncertainty; it is not a navigation system.
      </p>

      <h3>Drift parameter set</h3>
      <div class="seg" role="radiogroup" aria-label="Drift parameter set">
        {NAV.sets.map((s) => (
          <button type="button" role="radio" aria-checked={s === set} class={s === set ? 'on' : ''} disabled={!base.available.includes(s)} onClick={() => setSet(s)} title={base.available.includes(s) ? '' : `nav/montecarlo_${s}.json not in the data tree`}>
            {s}
          </button>
        ))}
      </div>
      <p class="muted">
        <AssumedTag note="config/nav.yaml sets (D15): assumed, not measured" /> σ_s, σ_b, ψ₀, slip of each set are in the method below.
      </p>
      {sd?.errors.map((e) => <DataProblem error={e.error} what={e.what} />)}

      <h3>Headline</h3>
      {summary ? (
        <p class="nav-headline">
          On this site at {set} drift, a crew inside the <CfgNum v={NAV.homelineBudgetMin} source="config/crew.yaml: walkback_budgets_min[0]" units="min" /> homeline needs a fix at least every{' '}
          <Num v={summary.median_m} units="m" file={S} k={`nav.fix_interval.${set}.median_m`} /> (median), <Num v={summary.edge_p10_m} units="m" file={S} k={`nav.fix_interval.${set}.edge_p10_m`} /> near the edge
          (p<CfgNum v={NAV.edgePercentile} source={navSource('fix_interval_ws9.edge_percentile')} />).
        </p>
      ) : (
        <p class="muted">
          {sd?.summaryOther ? `The fix-interval summary (${S}) is computed for the ${sd.summaryOther} set only (contracts v1.0.0: one file).` : sd ? `${S} is not in the data tree.` : 'Loading…'}
        </p>
      )}
      {summary && (
        <table class="mini">
          <thead>
            <tr>
              <th>D_max class</th>
              <th class="r">share of homeline</th>
            </tr>
          </thead>
          <tbody>
            {labels.map((lab, i) => (
              <tr>
                <td>
                  <span class="swatch" style={{ background: rgb(NAV_THEME.classColours[i]) }} /> {lab} m
                </td>
                <td class="r">
                  <Num v={summary.class_area_pct[lab as keyof FixIntervalSummary['class_area_pct']] ?? null} units="%" file={S} k={`nav.fix_interval.${set}.class_area_pct.${lab}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p class="muted">
        D_max under the pointer: {probe ? <Num v={probe.v} units="m" file={dmaxFile} /> : 'hover the map'}
        {!sd?.dmax && sd && ` (${dmaxFile} is not listed in fields/index.json)`}
      </p>

      <h3>Playback</h3>
      <div class="nav-playback">
        <button type="button" class="nav-play" onClick={() => (t >= tEnd ? (setT(0), setPlaying(true)) : setPlaying(!playing))}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <select aria-label="Playback speed" value={speed} onChange={(e) => setSpeed(Number((e.target as HTMLSelectElement).value))}>
          {NAV.playbackSpeeds.map((s) => (
            <option value={s}>{s}×</option>
          ))}
        </select>
        <span class="nav-time">EVA {fmtEva(t)}</span>
      </div>
      <input type="range" class="nav-scrub" min={0} max={tEnd} step={0.1} value={t} aria-label="EVA time" onInput={(e) => setT(Number((e.target as HTMLInputElement).value))} />
      <div class="hl-nav-panel" data-due={reading.due}>
        <div class="hl-nav-line">{navLine(reading)}</div>
        {reading.due && <div class="hl-nav-prompt">Fix due: take a fix or head toward the rover</div>}
      </div>
      {reading.row ? (
        <div class="kv">
          <h3>95% ellipse in force (minute {reading.row.t_eva_min})</h3>
          <dl>
            <dt>semi-axes a × b</dt>
            <dd>
              <RowNum v={reading.row.ellipse.a_m} units="m" file={mcFile} t={reading.row.t_eva_min} /> × <RowNum v={reading.row.ellipse.b_m} units="m" file={mcFile} t={reading.row.t_eva_min} />
            </dd>
            <dt>major axis</dt>
            <dd>
              <RowNum v={reading.row.ellipse.theta_deg} units="deg" file={mcFile} t={reading.row.t_eva_min} /> from north
            </dd>
            <dt>r95</dt>
            <dd>
              <RowNum v={reading.row.r95_m} units="m" file={mcFile} t={reading.row.t_eva_min} />
            </dd>
            <dt>walked since fix</dt>
            <dd>
              <RowNum v={reading.row.dist_since_fix_m} units="m" file={mcFile} t={reading.row.t_eva_min} />
            </dd>
          </dl>
          <p class="muted">Position on the map: {pos?.label ?? 'unknown'}.</p>
        </div>
      ) : (
        <p class="muted">{sd ? `${mcFile} is not in the data tree.` : 'Loading…'}</p>
      )}

      {sd?.mc && (
        <>
          <h3>Ellipse size over the EVA</h3>
          <EllipseChart mc={sd.mc} fixes={fixes} t={t} onSeek={(v) => setT(v)} />
          <p class="muted">
            r95: 95% radial error over <Num v={sd.mc.runs} file={mcFile} k={`nav.montecarlo.${set}.runs`} /> runs; a, b: semi-axes of the{' '}
            <CfgNum v={NAV.ellipseConf} source={navSource('ellipse_conf')} /> ellipse. Fixes reset the error. Fit {NAV.r95FitText}: a ={' '}
            <Num v={sd.mc.r95_fit.a} file={mcFile} k={`nav.r95_fit.${set}.a`} />, b = <Num v={sd.mc.r95_fit.b} file={mcFile} k={`nav.r95_fit.${set}.b`} />.
          </p>
        </>
      )}

      <h3>Fix events</h3>
      {base.fixesErr ? <DataProblem error={base.fixesErr} what="Fix events" /> : null}
      <div class="nav-types">
        {FIX_TYPES.map((ty) => (
          <label>
            <input
              type="checkbox"
              checked={types.has(ty)}
              onChange={(e) => {
                const n = new Set(types)
                if ((e.target as HTMLInputElement).checked) n.add(ty)
                else n.delete(ty)
                setTypes(n)
              }}
            />{' '}
            <span class="swatch" style={{ background: NAV_THEME.fix[ty] }} /> {ty}
          </label>
        ))}
      </div>
      <table class="mini">
        <thead>
          <tr>
            <th>EVA</th>
            <th>type</th>
            <th>station</th>
            <th class="r">σ</th>
            <th class="r">error</th>
          </tr>
        </thead>
        <tbody>
          {filterFixes(fixes, types).map((f) => {
            const i = fixes.indexOf(f)
            return (
              <tr class="nav-fixrow" onClick={() => setT(f.t_eva_min)}>
                <td>
                  <Num v={f.t_eva_min} units="min" file={F} k={`nav.fixes.${i}.t_eva_min`} />
                </td>
                <td>{f.type}</td>
                <td>{f.station ?? '—'}</td>
                <td class="r">
                  <Num v={f.sigma_m} units="m" file={F} k={`nav.fixes.${i}.sigma_m`} />
                </td>
                <td class="r">{f.type === 'skyline' ? <Num v={f.error_m ?? null} units="m" file={F} /> : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <h3>Layers</h3>
      <div class="layers">
        {(Object.keys(LAYER_LABELS) as NavLayer[]).map((k) => (
          <label class="layer">
            <input type="checkbox" checked={visible[k]} onChange={(e) => setVisible({ ...visible, [k]: (e.target as HTMLInputElement).checked })} /> {LAYER_LABELS[k]}
          </label>
        ))}
      </div>

      <h3>Method</h3>
      <p class="muted">
        Per step, the suit estimate scales the step length (per-run factor, per-step noise), adds a heading error (initial error after each fix, gyro bias, random walk; no
        compass on Mars) and extra along-track noise on slopes above the slip threshold. A Monte Carlo of <CfgNum v={NAV.runs} source={navSource('monte_carlo.runs')} /> runs along
        the planned route gives the <CfgNum v={NAV.ellipseConf} source={navSource('ellipse_conf')} /> ellipses and the r95 fit. Fixes at the rover pad (σ{' '}
        <CfgNum v={NAV.fixSigmaM.rover} source={navSource('fix_sigma_m.rover')} units="m" />), at surveyed stations (σ <CfgNum v={NAV.fixSigmaM.station} source={navSource('fix_sigma_m.station')} units="m" />)
        and skyline fixes on real Navcam frames (F22, σ = measured error) reset the error. D_max is the largest distance whose r95 stays inside the margin radius ({NAV.criterion}).
        The skyline fix is coarse (tens to hundreds of metres); production rovers match images to orbital maps far more precisely.
      </p>
      <table class="mini">
        <thead>
          <tr>
            <th>set</th>
            <th class="r">σ_s</th>
            <th class="r">σ_b °/h</th>
            <th class="r">ψ₀ °</th>
            <th class="r">slip</th>
          </tr>
        </thead>
        <tbody>
          {NAV.sets.map((s) => {
            const p = NAV.setParams[s]
            const c = (k: string) => (typeof p[k] === 'number' ? <CfgNum v={p[k]} source={navSource(`sets.${s}.${k}`)} /> : '—')
            return (
              <tr>
                <td>{s}</td>
                <td class="r">{c('sigma_s')}</td>
                <td class="r">{c('sigma_b_deg_h')}</td>
                <td class="r">{c('psi0_deg')}</td>
                <td class="r">{c('slip')}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
