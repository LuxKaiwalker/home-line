// "/" planning console (F17): map + side panel. Default view per SPEC F17: basemap, 30-min nominal
// band, edge causes, stations; everything else behind toggles. Budget slider (F5), scenario picker (F6).
import { render, type ComponentChildren } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { CITED, CONFIG } from '../config'
import { data } from '../data/loader'
import { accessFor } from '../data/access'
import { unknownMaskField } from '../data/fields'
import { partnerLabel } from '../data/partner'
import type { PartnerFC, RouteFC, ScenarioEntry, ScenariosIndex, Station, TimelineEvent } from '../data/types'
import { dataUrl } from '../env'
import { ConsoleMap, DEFAULT_VISIBLE, type LayerGroup } from '../map/consoleMap'
import { BASEMAP_CREDIT, basemapSources } from '../map/basemap'
import { loadAlpha } from '../map/hatch'
import { padMarker, padProposal, type PadMarkerInfo, type PadProposal } from '../map/pad'
import { binEdges, binLabelsFor } from '../map/legend'
import { isochroneMinutes, keyStep, snapMinutes, uniformStep } from '../map/slider'
import { href } from '../router'
import { THEME } from '../theme'
import { AssumedTag, DataProblem, DummyNote } from '../components/labels'
import { CfgNum, Num } from '../components/Num'
import { DragNote } from '../components/DragNote'
import { ensureManifest } from './common'
import { routeSummary, type RouteLeg } from './route'
import type { View } from './types'

const LAYER_LABELS: Record<LayerGroup, string> = {
  basemap: 'Basemap',
  bands: 'Homeline band',
  unknown: 'Unknown terrain (hatched)',
  edges: 'Edge causes',
  stations: 'Stations and pad',
  slider: 'Budget slider (isochrones)',
  route: 'Planned route',
  partner: 'Partner line (cart haul)', // replaced by partner.geojson `label` (D20) once loaded
  siting: 'Pad siting proposal (F8)',
}

export const view: View = async (el) => {
  el.innerHTML = `<div class="console"><div class="console-map"></div><aside class="console-panel"></aside></div>`
  const mapEl = el.querySelector<HTMLElement>('.console-map')!
  const panelEl = el.querySelector<HTMLElement>('.console-panel')!
  await ensureManifest()
  const cmap = new ConsoleMap(mapEl, (id) => {
    location.hash = href({ name: 'station', id })
  })
  render(<ConsolePanel cmap={cmap} />, panelEl)
  return () => {
    render(null, panelEl)
    cmap.destroy()
  }
}

export function findScenario(idx: ScenariosIndex, variant: string, suit: number): ScenarioEntry | undefined {
  return idx.scenarios.find((s) => s.variant === variant && s.suit_kg === suit)
}

function ConsolePanel({ cmap }: { cmap: ConsoleMap }) {
  const L = data()
  const [idx, setIdx] = useState<ScenariosIndex | null>(null)
  const [stations, setStations] = useState<Station[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [scenarioId, setScenarioId] = useState<string | null>(null)
  const [budget, setBudget] = useState<number>(CONFIG.walkbackBudgetsMin[0])
  const [sliderMin, setSliderMin] = useState<number>(CONFIG.walkbackBudgetsMin[0])
  const [isoMinutes, setIsoMinutes] = useState<number[]>([])
  const [visible, setVisible] = useState<Record<LayerGroup, boolean>>({ ...DEFAULT_VISIBLE })
  const [notes, setNotes] = useState<Partial<Record<LayerGroup, ComponentChildren>>>({})
  const [padInfo, setPadInfo] = useState<PadMarkerInfo | null>(null)
  const [proposal, setProposal] = useState<PadProposal | null>(null)
  const [sitingShown, setSitingShown] = useState(false)
  const [partner, setPartner] = useState<PartnerFC | null>(null)
  const [route, setRoute] = useState<RouteFC | null>(null)
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null)
  const [credit, setCredit] = useState<string | null>(null)

  const note = (k: LayerGroup, v: ComponentChildren) => setNotes((n) => ({ ...n, [k]: v }))

  // Static layers: index, pad, stations, unknown mask.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const i = await L.scenarios()
        if (!alive) return
        setIdx(i)
        setScenarioId((i.scenarios.find((s) => s.id === i.default) ?? i.scenarios[0]).id)
      } catch (e) {
        if (alive) setError(e)
        return
      }
      // The pad in use: pad.json (C 14:58: it describes pad_default), else config/site.yaml pad_default.
      // The F8 siting result is a proposal only: siting.png + siting_png.json (+ optional pad.json proposal).
      let pad = padMarker(null, CONFIG.padDefault)
      let pp: PadProposal | null = null
      try {
        const pf = await L.optional(() => L.pad())
        pad = padMarker(pf, CONFIG.padDefault)
        pp = padProposal(pf)
      } catch (e) {
        note('stations', `pad.json: ${e instanceof Error ? e.message : String(e)}`)
      }
      try {
        const sp = await L.optional(() => L.sitingPng())
        if (!alive) return
        setProposal(pp)
        setSitingShown(!!sp)
        if (sp || pp) {
          await cmap.setSiting(
            sp ? { url: dataUrl(sp.image), coordinates: sp.coordinates } : null,
            pp ? { lon: pp.lon, lat: pp.lat, title: 'F8 siting proposal (not adopted; pad_default is kept, S decides)', alternatives: pp.alternatives } : null,
          )
        }
        note('siting', sp ? '' : 'siting_png.json not available yet')
      } catch (e) {
        note('siting', `siting_png.json: ${e instanceof Error ? e.message : String(e)}`)
      }
      if (!alive) return
      setPadInfo(pad)
      cmap.setPad({ lon: pad.lon, lat: pad.lat, label: 'Pad', title: pad.title })
      try {
        const st = await L.stations()
        if (!alive) return
        setStations(st)
        cmap.fitTo([...st, pad])
      } catch (e) {
        note('stations', e instanceof Error ? e.message : String(e))
      }
      // Basemap (F17): tiles/basemap/tilejson.json (contract v1.1.0).
      try {
        const tj = await L.optional(() => L.tilejson())
        if (!alive) return
        if (!tj) {
          note('basemap', 'tiles/basemap/tilejson.json not available yet: plain background')
        } else {
          const src = basemapSources(tj, (p) => dataUrl(p))
          await cmap.setBasemap(src)
          setCredit(tj.attribution ?? BASEMAP_CREDIT)
          note('basemap', `HiRISE colour ortho, z${tj.minzoom}–${tj.maxzoom}${tj.zoom_bounds ? ` (z${Object.keys(tj.zoom_bounds).join('/z')} near the stations)` : ''}`)
        }
      } catch (e) {
        note('basemap', e instanceof Error ? e.message : String(e))
      }
      // Hatched unknowns (F1): terrain/cellstate.png alpha (A = 0 unknown, contract v1.1.0);
      // without it, the alpha of the shared slope field (SPEC §6.1).
      try {
        const cs = await L.optional(() => L.cellstate())
        if (cs) {
          const a = await loadAlpha(dataUrl(cs.image))
          if (a.width !== cs.width || a.height !== cs.height) return note('unknown', `${cs.image} is ${a.width}×${a.height}, cellstate.json says ${cs.width}×${cs.height}`)
          await cmap.setUnknownMask({ ...a, bounds: cs.bounds })
          const pct = cs.pct?.unknown
          if (alive)
            note(
              'unknown',
              <>
                F1 cell states, {cs.res_m} m cells; unknown{' '}
                {pct === undefined ? '(share not given)' : <Num v={pct} units="%" file="terrain/cellstate.json" k="terrain.cellstate.pct.unknown" />}
                {pct === 0 ? ' (nothing to hatch: every cell is HiRISE-assessed)' : ''}
              </>,
            )
          return
        }
        const fi = await L.optional(() => L.fieldsIndex())
        const g = fi && unknownMaskField(fi)
        if (!g) return note('unknown', fi ? 'no cell states and no shared slope field' : 'terrain/cellstate.json not available yet')
        const a = await loadAlpha(dataUrl(g.file))
        if (a.width !== g.width || a.height !== g.height) return note('unknown', `${g.file} is ${a.width}×${a.height}, index says ${g.width}×${g.height}`)
        await cmap.setUnknownMask({ ...a, bounds: g.bounds })
        if (alive) note('unknown', `from ${g.file} (A = 0; no terrain/cellstate.json)`)
      } catch (e) {
        note('unknown', e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const scenario = useMemo(() => idx?.scenarios.find((s) => s.id === scenarioId) ?? null, [idx, scenarioId])

  // Science points, access cells and walk-in lines depend on the scenario (WS2 access per scenario).
  useEffect(() => {
    if (stations && scenario) void cmap.setStations(stations, scenario.id)
  }, [stations, scenario])

  // Scenario layers.
  useEffect(() => {
    if (!scenario) return
    let alive = true
    ;(async () => {
      try {
        const [bands, isochrones, edges, partner] = await Promise.all([L.bands(scenario), L.isochrones(scenario), L.edges(scenario), L.partner(scenario)])
        if (!alive) return
        await cmap.setScenarioData({ bands, isochrones, edges, partner, variant: scenario.variant })
        setPartner(partner)
        const mins = isochroneMinutes(isochrones)
        setIsoMinutes(mins)
        setSliderMin((v) => snapMinutes(mins, v) ?? v)
        setError(null)
      } catch (e) {
        if (alive) setError(e)
      }
      try {
        const r = await L.optional(() => L.route(scenario.id))
        if (!alive) return
        setRoute(r)
        setTimeline(r ? await L.optional(() => L.timeline(scenario.id)) : null)
        await cmap.setRoute(r)
        note('route', r ? (routeSummary(r) ? '' : `route_${scenario.id}.geojson has no legs (no reachable station)`) : `no route for ${scenario.id}`)
      } catch (e) {
        setRoute(null)
        if (alive) note('route', e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [scenario])

  useEffect(() => cmap.setBudget(budget), [budget])
  useEffect(() => cmap.setSliderMinutes(sliderMin), [sliderMin])

  const toggle = (g: LayerGroup, on: boolean) => {
    cmap.setVisible(g, on)
    setVisible((v) => ({ ...v, [g]: on }))
  }

  if (error && !idx) {
    return (
      <div class="panel-body">
        <h2>Planning console</h2>
        <DataProblem error={error} what="Scenarios" />
      </div>
    )
  }
  if (!idx || !scenario) return <div class="panel-body muted">Loading…</div>

  const pick = (variant: string, suit: number) => {
    const s = findScenario(idx, variant, suit)
    if (s) setScenarioId(s.id)
  }
  const h = scenario.headline
  const hb = h.budget_min
  const defaultPartnerFile = idx.scenarios.find((s) => s.id === idx.default)?.files.partner ?? null
  const label = (g: LayerGroup) => (g === 'partner' ? partnerLabel(partner) : LAYER_LABELS[g])

  return (
    <div class="panel-body">
      <DummyNote />
      {error != null && <DataProblem error={error} what="Scenario layers" />}

      <section class="headline">
        <div class="headline-value">
          <Num v={h.reachable_pct} units="%" file="scenarios/index.json" k={`reachable_pct.${scenario.id}.${hb}`} />
        </div>
        <div class="headline-text">
          reachable of the <i>assessed</i> flat disc within {hb} min.
          <br />
          Range <Num v={h.range_pct[0]} units="%" file="scenarios/index.json" k={`reachable_pct_range.${scenario.id}.${hb}.low`} /> (conservative) to{' '}
          <Num v={h.range_pct[1]} units="%" file="scenarios/index.json" k={`reachable_pct_range.${scenario.id}.${hb}.high`} /> (optimistic)
        </div>
      </section>

      <RouteSection scenarioId={scenario.id} route={route} timeline={timeline} shown={visible.route} onShow={(on) => toggle('route', on)} />

      <section>
        <h3>Scenario</h3>
        <div class="seg" role="radiogroup" aria-label="Variant">
          {CONFIG.variantNames.map((v) => {
            const ok = !!findScenario(idx, v, scenario.suit_kg)
            return (
              <button type="button" role="radio" aria-checked={scenario.variant === v} class={scenario.variant === v ? 'on' : ''} disabled={!ok} onClick={() => pick(v, scenario.suit_kg)}>
                {v}
              </button>
            )
          })}
        </div>
        <div class="seg" role="radiogroup" aria-label="Suit mass">
          {CONFIG.suitMassesKg.map((kg) => {
            const ok = !!findScenario(idx, scenario.variant, kg)
            return (
              <button
                type="button"
                role="radio"
                aria-checked={scenario.suit_kg === kg}
                class={scenario.suit_kg === kg ? 'on' : ''}
                disabled={!ok}
                onClick={() => pick(scenario.variant, kg)}
                title={ok ? '' : 'scenario not in scenarios/index.json'}
              >
                {kg} kg suit
              </button>
            )
          })}
        </div>
        <p class="caption">
          Scenario <code>{scenario.id}</code>. Combinations not in <code>scenarios/index.json</code> are disabled.
          {CONFIG.suitMassesKg[0] === 80 && <> The 80 kg suit is our sensitivity value.</>}
        </p>
      </section>

      <section>
        <h3>Walkback budget</h3>
        <div class="seg" role="radiogroup" aria-label="Walkback budget">
          {CONFIG.bandBudgetsMin.map((b) => (
            <button type="button" role="radio" aria-checked={budget === b} class={budget === b ? 'on' : ''} onClick={() => setBudget(b)}>
              {b} min
            </button>
          ))}
        </div>
        <p class="caption">NASA is <i>considering</i> a 30- or 60-min walkback; neither is a rule.</p>
        <label class="toggle">
          <input type="checkbox" checked={visible.slider} onChange={(e) => toggle('slider', (e.target as HTMLInputElement).checked)} />
          Budget slider (0–{CONFIG.isochroneMinutes.max} min)
        </label>
        {visible.slider && isoMinutes.length > 0 && (
          <BudgetSlider values={isoMinutes} value={sliderMin} onChange={setSliderMin} file={scenario.files.isochrones} scenarioId={scenario.id} />
        )}
      </section>

      <section>
        <h3>Layers</h3>
        {(Object.keys(LAYER_LABELS) as LayerGroup[])
          .filter((g) => g !== 'slider')
          .map((g) => (
            <label class="toggle">
              <input type="checkbox" checked={visible[g]} onChange={(e) => toggle(g, (e.target as HTMLInputElement).checked)} />
              {label(g)}
              {notes[g] ? <span class="muted"> · {notes[g]}</span> : null}
            </label>
          ))}
      </section>

      <Legend
        visible={visible}
        budget={budget}
        variant={scenario.variant}
        minutes={isoMinutes}
        pad={padInfo}
        credit={credit}
        partner={visible.partner ? { fc: partner, label: partnerLabel(partner), file: scenario.files.partner, defaultFile: defaultPartnerFile } : null}
        proposal={visible.siting ? proposal : null}
      />

      {visible.siting && <PadProposalSection p={proposal} heatmap={sitingShown} pad={padInfo} />}

      <section>
        <h3>Stations</h3>
        {stations ? (
          <table class="mini">
            <thead>
              <tr>
                <th>Station</th>
                <th class="r" title="Straight-line walk-in from the access cell to the science point (not modelled)">
                  Walk-in
                </th>
                <th class="r" title="Walk home from the access cell, this scenario">
                  Home
                </th>
              </tr>
            </thead>
            <tbody>
              {stations.map((s) => {
                const a = accessFor(s, scenario.id)
                return (
                  <tr>
                    <td>
                      <a href={href({ name: 'station', id: s.id })}>
                        <b>{s.id}</b> {s.name}
                      </a>
                    </td>
                    <td class="r">
                      {a.state === 'access' ? (
                        <Num v={a.dist_m} units="m" file={a.file} k={`${a.keyPrefix}.dist_m`} />
                      ) : a.state === 'none' ? (
                        <span class="num-unknown" title={a.reason ?? ''}>
                          no access cell
                        </span>
                      ) : (
                        <span class="num-unknown">unknown</span>
                      )}
                    </td>
                    <td class="r">
                      <Num v={s.t_home_min[scenario.id] ?? null} units="min" file="stations.json" k={`t_home_min.${s.id}.${scenario.id}`} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <p class="muted">{notes.stations || 'Loading…'}</p>
        )}
        {stations && (
          <p class="caption">
            Access-cell rule: each station keeps its science point (filled marker); the route ends at the nearest walkable cell within{' '}
            <CfgNum v={CITED.accessRadiusM.value} units="m" source={CITED.accessRadiusM.source} /> (open circle, dotted walk-in line).{' '}
            <AssumedTag note="Access radius: assumed (WS2), user chose the rule 2026-11-14 11:40" /> The walk-in leg is not modelled.
            {stations.some((s) => accessFor(s, scenario.id).state === 'none') && (
              <>
                {' '}
                <b>{stations.filter((s) => accessFor(s, scenario.id).state === 'none').map((s) => s.id).join(', ')}</b>: no access cell within the radius, so no walk home
                is computed (hover for the reason).
              </>
            )}
          </p>
        )}
      </section>
    </div>
  )
}

/**
 * Budget slider over the contours that exist (isochrones.geojson `minutes`): the range input runs
 * over their indices, so dragging, clicking and the arrow keys always land on a real contour.
 */
function BudgetSlider({ values, value, onChange, file, scenarioId }: { values: number[]; value: number; onChange: (v: number) => void; file: string; scenarioId: string }) {
  const v = snapMinutes(values, value) ?? values[0]
  const i = values.indexOf(v)
  const step = uniformStep(values)
  const onKey = (e: KeyboardEvent) => {
    const nv = keyStep(values, v, e.key, THEME.isoBinStepMin)
    if (nv === null) return
    e.preventDefault()
    if (nv !== v) onChange(nv)
  }
  return (
    <div class="slider">
      <input
        type="range"
        min={0}
        max={values.length - 1}
        step={1}
        value={i}
        onInput={(e) => onChange(values[+(e.target as HTMLInputElement).value] ?? v)}
        onKeyDown={onKey}
        aria-label="Isochrone minutes"
        aria-valuetext={`${v} min`}
      />
      <span class="slider-value">{v} min</span>
      <span class="caption slider-steps">
        Where the crew can be and still walk home within {v} min. Contours {values[0]}–{values[values.length - 1]} min,{' '}
        {step !== null ? (
          <>
            <Num v={step} units="min" file={file} k={`isochrone_step_min.${scenarioId}`} /> steps
            {step === CONFIG.isochroneFallbackStepMin && step !== CONFIG.isochroneMinutes.step ? ' (size fallback; config/variants.yaml isochrone_fallback_step_min)' : ''}
          </>
        ) : (
          `${values.length} contours`
        )}{' '}
        (<code>{file}</code>).
      </span>
    </div>
  )
}

function Swatch({ kind, color, dashed }: { kind: 'fill' | 'line' | 'hatch' | 'dot' | 'ring' | 'pad'; color?: string; dashed?: boolean }) {
  return <span class={`sw sw-${kind}${dashed ? ' sw-dashed' : ''}`} style={color ? { '--c': color } : undefined} />
}

function Legend(p: {
  visible: Record<LayerGroup, boolean>
  budget: number
  variant: string
  minutes: number[]
  pad: PadMarkerInfo | null
  credit: string | null
  partner: { fc: PartnerFC | null; label: string; file: string; defaultFile: string | null } | null
  proposal: PadProposal | null
}) {
  const v = p.visible
  const edges = binEdges(CONFIG.isochroneMinutes.max, THEME.isoBinStepMin) // same bins as the map colour ramp
  return (
    <section class="legend">
      <h3>Legend</h3>
      <ul>
        {v.basemap && (
          <li>
            {p.credit ? (
              <>
                Basemap: HiRISE colour ortho <span class="muted">({p.credit})</span>
              </>
            ) : (
              <>
                <Swatch kind="fill" color={THEME.mapBackground} /> Basemap not available: plain background
              </>
            )}
          </li>
        )}
        {v.bands && (
          <>
            <li>
              <Swatch kind="fill" color={THEME.variant.conservative} /> {p.budget}-min homeline, conservative (inner)
            </li>
            <li>
              <Swatch kind="fill" color={THEME.variant.optimistic} /> … optimistic only (outer)
            </li>
            <li>
              <Swatch kind="line" color={THEME.variant[p.variant] ?? THEME.variant.nominal} /> {p.variant} contour (selected scenario, bold)
            </li>
          </>
        )}
        {v.edges &&
          (['physiology', 'slope', 'data'] as const).map((c) => (
            <li>
              <Swatch kind="line" color={THEME.cause[c]} /> edge set by <b>{THEME.causeLabel[c]}</b>: {THEME.causeHelp[c]}
            </li>
          ))}
        {v.unknown && (
          <li>
            <Swatch kind="hatch" /> unknown terrain: never routed, left out of every percentage
          </li>
        )}
        {v.slider &&
          binLabelsFor(edges, p.minutes).map(({ i, label }) => (
            <li>
              <Swatch kind="line" color={THEME.isoRamp[i]} /> isochrone {label}
            </li>
          ))}
        {v.stations && (
          <li>
            <Swatch kind="dot" color={THEME.station} /> science point (click for its card) · <Swatch kind="ring" color={THEME.station} /> access cell, dotted walk-in ·{' '}
            <Swatch kind="pad" /> rover pad
            {p.pad ? <span class="muted"> ({p.pad.sourceLabel})</span> : null}
          </li>
        )}
        {v.route && (
          <li>
            <Swatch kind="line" color={THEME.route} dashed /> planned route (simulated EVA)
          </li>
        )}
        {p.partner && (
          <li>
            <Swatch kind="line" color={THEME.partner} dashed /> <b>{p.partner.label}</b>: where one astronaut can still haul a downed crewmate home by cart. <i>{CONFIG.haulPartnerCaption}</i>{' '}
            <AssumedTag />
            <DragNote fc={p.partner.fc} file={p.partner.file} defaultFile={p.partner.defaultFile} />
          </li>
        )}
        {v.siting && (
          <li>
            <Swatch kind="fill" color="#bbbbbb" /> F8 siting score (grey; white = highest)
            {p.proposal ? (
              <>
                {' '}
                · <span class="pad-marker pad-proposal">Pad?</span> proposed pad · <span class="pad-alt">#2</span> alternatives
              </>
            ) : null}
            . <b>Proposal only</b>: the plan keeps pad_default.
          </li>
        )}
      </ul>
    </section>
  )
}

/** F9 route (simulated EVA): stop order from the route legs, times from the timeline (manifest-backed). */
function RouteSection(p: { scenarioId: string; route: RouteFC | null; timeline: TimelineEvent[] | null; shown: boolean; onShow: (on: boolean) => void }) {
  const r = routeSummary(p.route)
  const tf = `timeline_${p.scenarioId}.json`
  if (!r) {
    return (
      <section>
        <h3>Planned route</h3>
        <p class="muted">No route for {p.scenarioId}{p.route ? ' (no reachable station)' : ''}.</p>
      </section>
    )
  }
  const tl = p.timeline ?? []
  const at = (event: string, station: string | null) => {
    const i = tl.findIndex((e) => e.event === event && e.station === station)
    return i < 0 ? null : <Num v={tl[i].t_min} units="min" file={tf} k={`timeline.${p.scenarioId}.${i}.t_min`} />
  }
  return (
    <section>
      <h3>
        Planned route <span class="tag tag-simulated">simulated EVA</span>
      </h3>
      <ol class="route-stops">
        {r.stops.map((st, i) => {
          const first = i === 0
          const last = i === r.stops.length - 1
          const t = first ? at('depart', null) : last ? at('return', null) : at('arrive', st)
          return (
            <li>
              {st === 'pad' ? 'Pad' : <a href={href({ name: 'station', id: st })}>{st}</a>}
              {t ? <span class="muted"> · {first ? 'depart' : last ? 'back' : 'arrive'} </span> : null}
              {t}
            </li>
          )
        })}
      </ol>
      <RouteLegs scenarioId={p.scenarioId} legs={r.legs} />
      <p>
        Total <Num v={r.endMin} units="min" file={tf} k={`route.${p.scenarioId}.total_min`} />{' '}
        <label class="toggle inline">
          <input type="checkbox" checked={p.shown} onChange={(e) => p.onShow((e.target as HTMLInputElement).checked)} /> show on map
        </label>
      </p>
    </section>
  )
}

/** Route legs (F9) from route_{scenario}.geojson; manifest keys route.{sid}.leg.{i}.* (WS2, i = the 1-based `leg`). */
function RouteLegs({ scenarioId, legs }: { scenarioId: string; legs: RouteLeg[] }) {
  const rf = `route_${scenarioId}.geojson`
  const k = (l: RouteLeg, f: string) => `route.${scenarioId}.leg.${l.leg}.${f}`
  const name = (s: string) => (s === 'pad' ? 'Pad' : s)
  return (
    <table class="mini route-legs">
      <thead>
        <tr>
          <th>Leg</th>
          <th class="r">Walk</th>
          <th class="r">Distance</th>
          <th class="r">O₂</th>
          <th class="r" title="Straight walk-in from the access cell to the science point at the leg's end (not modelled)">
            Walk-in
          </th>
        </tr>
      </thead>
      <tbody>
        {legs.map((l) => (
          <tr>
            <td>
              {name(l.from)} → {name(l.to)}
            </td>
            <td class="r">
              <Num v={l.t_min} units="min" file={rf} k={k(l, 't_min')} />
            </td>
            <td class="r">
              <Num v={l.length_m} units="m" file={rf} k={k(l, 'length_m')} />
            </td>
            <td class="r">
              <Num v={l.o2_L} units="L" file={rf} k={k(l, 'o2_L')} />
            </td>
            <td class="r">{l.to === 'pad' ? <span class="muted">–</span> : <Num v={l.to_access_dist_m} units="m" file={rf} k={k(l, 'to_access_dist_m')} />}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** F8 pad siting proposal (C 14:58): siting.png heatmap + optional pad.json `proposal`; never the pad in use. */
function PadProposalSection({ p, heatmap, pad }: { p: PadProposal | null; heatmap: boolean; pad: PadMarkerInfo | null }) {
  const F = 'pad.json'
  const b = CONFIG.walkbackBudgetsMin[0]
  return (
    <section>
      <h3>
        Pad siting <span class="tag tag-assumed">proposal</span>
      </h3>
      <p>
        <b>pad_default is kept; S decides.</b> The pad in use is {pad?.file ? 'pad.json (= pad_default)' : 'config/site.yaml pad_default'}; every route, band
        and number in the plan uses it. The F8 siting rule's result is shown here only as a proposal
        {heatmap ? ' (grey heatmap: siting score, white = highest)' : ' (siting.png not available yet)'}.
      </p>
      {p ? (
        <>
          <p>
            Proposed pad <Num v={p.lon} file={F} k="pad.proposal.lon" />, <Num v={p.lat} file={F} k="pad.proposal.lat" /> (score{' '}
            <Num v={p.score} file={F} k="pad.proposal.score" />, steepest slope in its block{' '}
            <Num v={p.maxSlopeDeg} units="deg" file={F} k="pad.proposal.checks.max_slope_deg" />
            ); {b}-min disc assessed <Num v={p.assessedPct} units="%" file={F} k="pad.proposal.checks.assessed_pct_30min" />, pad rule {p.ruleLabel}.
          </p>
          {p.assessedPct === null && (
            <p class="caption">
              The disc check is null: the {b}-min flat disc around the proposed pad runs off the edge of the 3 m routing grid, so WS2 cannot assess it.
            </p>
          )}
          {p.rule && <p class="caption">Rule: {p.rule}.</p>}
        </>
      ) : (
        <p class="caption">
          WS2 (STATUS, session 4): the proposal's {b}-min disc check is null because the disc runs off the 3 m routing grid, and with only one station reachable
          under the conservative variant the top candidate blocks tie, so the rule cannot discriminate between them.
        </p>
      )}
      {p?.tied && (
        <p class="caption">
          Every listed alternative has the proposal's score: with one reachable station the rule cannot tell the candidates apart (WS2 STATUS reports the full tie).
        </p>
      )}
    </section>
  )
}
