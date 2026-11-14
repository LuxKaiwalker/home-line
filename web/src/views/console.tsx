// "/" planning console (F17): map + side panel. Default view per SPEC F17: basemap, 30-min nominal
// band, edge causes, stations; everything else behind toggles. Budget slider (F5), scenario picker (F6).
import { render } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { CONFIG } from '../config'
import { data } from '../data/loader'
import { unknownMaskField } from '../data/fields'
import type { ScenarioEntry, ScenariosIndex, Station } from '../data/types'
import { dataUrl } from '../env'
import { ConsoleMap, DEFAULT_VISIBLE, type LayerGroup } from '../map/consoleMap'
import { BASEMAP_PLACEHOLDER_NOTE } from '../map/basemap'
import { loadAlpha } from '../map/hatch'
import { padMarker, type PadMarkerInfo } from '../map/pad'
import { binEdges, binLabelsFor } from '../map/legend'
import { isochroneMinutes, keyStep, snapMinutes, uniformStep } from '../map/slider'
import { href } from '../router'
import { THEME } from '../theme'
import { AssumedTag, DataProblem, DummyNote } from '../components/labels'
import { CfgNum, Num } from '../components/Num'
import { ensureManifest } from './common'
import type { View } from './types'

const LAYER_LABELS: Record<LayerGroup, string> = {
  basemap: 'Basemap',
  bands: 'Homeline band',
  unknown: 'Unknown terrain (hatched)',
  edges: 'Edge causes',
  stations: 'Stations and pad',
  slider: 'Budget slider (isochrones)',
  route: 'Planned route',
  partner: 'Partner line (design question)',
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
  const [notes, setNotes] = useState<Partial<Record<LayerGroup, string>>>({ basemap: BASEMAP_PLACEHOLDER_NOTE })
  const [padInfo, setPadInfo] = useState<PadMarkerInfo | null>(null)

  const note = (k: LayerGroup, v: string) => setNotes((n) => ({ ...n, [k]: v }))

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
      let pad = padMarker(null, CONFIG.padDefault)
      try {
        pad = padMarker(await L.optional(() => L.pad()), CONFIG.padDefault)
      } catch (e) {
        note('stations', `pad.json: ${e instanceof Error ? e.message : String(e)}`)
      }
      if (!alive) return
      setPadInfo(pad)
      cmap.setPad({ lon: pad.lon, lat: pad.lat, label: 'Pad', title: pad.title })
      try {
        const st = await L.stations()
        if (!alive) return
        setStations(st)
        cmap.setStations(st)
        cmap.fitTo([...st, pad])
      } catch (e) {
        note('stations', e instanceof Error ? e.message : String(e))
      }
      // Hatched unknowns (F1): alpha of the shared slope field, A = 0 unknown (SPEC §6.1).
      try {
        const fi = await L.optional(() => L.fieldsIndex())
        const g = fi && unknownMaskField(fi)
        if (!g) return note('unknown', fi ? 'no shared slope field in fields/index.json' : 'fields/index.json not available yet')
        const a = await loadAlpha(dataUrl(g.file))
        if (a.width !== g.width || a.height !== g.height) return note('unknown', `${g.file} is ${a.width}×${a.height}, index says ${g.width}×${g.height}`)
        await cmap.setUnknownMask({ ...a, bounds: g.bounds })
        if (alive) note('unknown', `from ${g.file} (A = 0)`)
      } catch (e) {
        note('unknown', e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const scenario = useMemo(() => idx?.scenarios.find((s) => s.id === scenarioId) ?? null, [idx, scenarioId])

  // Scenario layers.
  useEffect(() => {
    if (!scenario) return
    let alive = true
    ;(async () => {
      try {
        const [bands, isochrones, edges, partner] = await Promise.all([L.bands(scenario), L.isochrones(scenario), L.edges(scenario), L.partner(scenario)])
        if (!alive) return
        await cmap.setScenarioData({ bands, isochrones, edges, partner, variant: scenario.variant })
        const mins = isochroneMinutes(isochrones)
        setIsoMinutes(mins)
        setSliderMin((v) => snapMinutes(mins, v) ?? v)
        setError(null)
      } catch (e) {
        if (alive) setError(e)
      }
      try {
        const route = await L.optional(() => L.route(scenario.id))
        if (!alive) return
        await cmap.setRoute(route)
        note('route', route ? '' : `no route_${scenario.id}.geojson yet`)
      } catch (e) {
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

  return (
    <div class="panel-body">
      <DummyNote />
      {error != null && <DataProblem error={error} what="Scenario layers" />}

      <section class="headline">
        <div class="headline-value">
          <Num v={h.reachable_pct} units="%" file="scenarios/index.json" k={`reachable_pct.${scenario.id}.${hb}`} />
        </div>
        <div class="headline-text">
          reachable <span class="muted">(</span>
          <Num v={h.range_pct[0]} units="%" file="scenarios/index.json" k={`reachable_pct_range.${scenario.id}.${hb}.low`} />–
          <Num v={h.range_pct[1]} units="%" file="scenarios/index.json" k={`reachable_pct_range.${scenario.id}.${hb}.high`} />
          <span class="muted">)</span> of the <i>assessed</i> flat disc within {hb} min
        </div>
      </section>

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
        {visible.slider && isoMinutes.length > 0 && <BudgetSlider values={isoMinutes} value={sliderMin} onChange={setSliderMin} file={scenario.files.isochrones} />}
      </section>

      <section>
        <h3>Layers</h3>
        {(Object.keys(LAYER_LABELS) as LayerGroup[])
          .filter((g) => g !== 'slider')
          .map((g) => (
            <label class="toggle">
              <input type="checkbox" checked={visible[g]} onChange={(e) => toggle(g, (e.target as HTMLInputElement).checked)} />
              {LAYER_LABELS[g]}
              {notes[g] ? <span class="muted"> · {notes[g]}</span> : null}
            </label>
          ))}
      </section>

      <Legend visible={visible} budget={budget} variant={scenario.variant} minutes={isoMinutes} pad={padInfo} />

      <section>
        <h3>Stations</h3>
        {stations ? (
          <table class="mini">
            <thead>
              <tr>
                <th>Station</th>
                <th class="r" title="Walk home from the station, this scenario">
                  Home
                </th>
              </tr>
            </thead>
            <tbody>
              {stations.map((s) => (
                <tr>
                  <td>
                    <a href={href({ name: 'station', id: s.id })}>
                      <b>{s.id}</b> {s.name}
                    </a>
                  </td>
                  <td class="r">
                    <Num v={s.t_home_min[scenario.id] ?? null} units="min" file="stations.json" k={`t_home_min.${s.id}.${scenario.id}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p class="muted">{notes.stations || 'Loading…'}</p>
        )}
      </section>
    </div>
  )
}

/**
 * Budget slider over the contours that exist (isochrones.geojson `minutes`): the range input runs
 * over their indices, so dragging, clicking and the arrow keys always land on a real contour.
 */
function BudgetSlider({ values, value, onChange, file }: { values: number[]; value: number; onChange: (v: number) => void; file: string }) {
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
        {step !== null ? `${step}-min steps` : `${values.length} contours`} (<code>{file}</code>).
      </span>
    </div>
  )
}

function Swatch({ kind, color, dashed }: { kind: 'fill' | 'line' | 'hatch' | 'dot' | 'pad'; color?: string; dashed?: boolean }) {
  return <span class={`sw sw-${kind}${dashed ? ' sw-dashed' : ''}`} style={color ? { '--c': color } : undefined} />
}

function Legend(p: { visible: Record<LayerGroup, boolean>; budget: number; variant: string; minutes: number[]; pad: PadMarkerInfo | null }) {
  const v = p.visible
  const edges = binEdges(CONFIG.isochroneMinutes.max, THEME.isoBinStepMin) // same bins as the map colour ramp
  return (
    <section class="legend">
      <h3>Legend</h3>
      <ul>
        {v.basemap && (
          <li>
            <Swatch kind="fill" color={THEME.mapBackground} /> Basemap {BASEMAP_PLACEHOLDER_NOTE}
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
            <Swatch kind="dot" color={THEME.station} /> science station (click for its card) · <Swatch kind="pad" /> rover pad
            {p.pad ? <span class="muted"> ({p.pad.sourceLabel})</span> : null}
          </li>
        )}
        {v.route && (
          <li>
            <Swatch kind="line" color={THEME.route} dashed /> planned route (simulated EVA)
          </li>
        )}
        {v.partner && (
          <li>
            <Swatch kind="line" color={THEME.partner} dashed /> <CfgNum v={CONFIG.haulContourMin} units="min" source="config/haul.yaml: contour_min" /> partner-haul
            contour. <i>Design question. Every haul parameter is an assumed band.</i> <AssumedTag />
          </li>
        )}
      </ul>
    </section>
  )
}
