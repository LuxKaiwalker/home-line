// /scorecard — F16: validation (V1, V2 by distance class, coverage, co-registration, RAD checks,
// KAT list), the assumptions table, the real / modelled / simulated table and the provenance
// manifest (every on-screen number links here). Never in the default view (brief WS5 "Don't").
import { useEffect, useMemo, useState } from 'preact/hooks'
import { CITED, CONFIG } from '../config'
import { data } from '../data/loader'
import type { Manifest, ManifestEntry } from '../data/types'
import { contractVersions } from '../data/contracts'
import { formatValue, isEntry } from '../prov/provenance'
import { getManifest } from '../prov/store'
import type { Route } from '../router'
import { DummyNote, StatusTag } from '../components/labels'
import { LooseTable } from '../components/Loose'
import { CfgNum, Num } from '../components/Num'
import { Page, preactView, Show, useLoad } from './page'

export function manifestEntries(m: Manifest | null): [string, ManifestEntry][] {
  if (!m) return []
  return (Object.entries(m).filter(([k, v]) => k !== 'dummy' && isEntry(v)) as [string, ManifestEntry][]).sort(([a], [b]) => a.localeCompare(b))
}

/** Entries recorded before H0 (config/event.yaml h0_utc): must be none (SPEC F16, CI check_h0). */
export function preH0(entries: [string, ManifestEntry][], h0Utc: string): string[] {
  const h0 = Date.parse(h0Utc)
  return entries.filter(([, e]) => !(Date.parse(e.utc) >= h0)).map(([k]) => k)
}

function show(v: unknown, units: string | null): string {
  return typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' || v === null ? formatValue(v, units) : JSON.stringify(v)
}

function ManifestTable({ focus }: { focus?: string }) {
  const m = getManifest()
  const [q, setQ] = useState(focus ?? '')
  const all = useMemo(() => manifestEntries(m), [m])
  const early = useMemo(() => preH0(all, CONFIG.h0Utc), [all])
  const rows = all.filter(([k, e]) => !q || k.includes(q) || e.file.includes(q))
  useEffect(() => {
    if (focus) document.getElementById(`k-${focus}`)?.scrollIntoView({ block: 'center' })
  }, [focus])
  if (!m) return <p class="muted">manifest.json is not available in this data tree.</p>
  return (
    <>
      <p>
        {all.length} entries{m.dummy ? ' (dummy manifest)' : ''}. Each number on the site links here.{' '}
        {early.length ? <b class="bad">{early.length} entries carry a time before H0 ({CONFIG.h0Utc}).</b> : <>All entries are after H0 ({CONFIG.h0Utc}).</>}{' '}
        <input type="search" placeholder="filter by key or file" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      </p>
      <div class="table-scroll">
        <table class="mini manifest">
          <thead>
            <tr>
              <th>Key</th>
              <th class="r">Value</th>
              <th>File</th>
              <th>Script</th>
              <th>Commit</th>
              <th>UTC</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, e]) => (
              <tr id={`k-${k}`} class={k === focus ? 'focus' : ''}>
                <td>
                  <code>{k}</code>
                </td>
                <td class="r">{show(e.value, e.units)}</td>
                <td>{e.file}</td>
                <td>{e.script}</td>
                <td>
                  <code>{e.commit.slice(0, 10)}</code>
                </td>
                <td>{e.utc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function V1Section() {
  const l = useLoad(() => data().optional(() => data().v1()))
  const F = 'validation/v1.json'
  return (
    <Show l={l} what="V1 tilt validation">
      {(v) =>
        v ? (
          <>
            <p>
              DEM slope over the rover footprint vs Curiosity's IMU tilt at <Num v={v.n} file={F} k="v1.n" /> drive ends. Bias{' '}
              <Num v={v.bias_deg} units="deg" file={F} k="v1.bias_deg" />, RMSE <Num v={v.rmse_deg} units="deg" file={F} k="v1.rmse_deg" />, r{' '}
              <Num v={v.r} file={F} k="v1.r" />. Confusion at {v.thresholds_deg.join('° / ')}°:
            </p>
            <LooseTable value={v.confusion} file={F} />
            <p class="caption">Caveat: the rover chose gentle ground.</p>
          </>
        ) : (
          <p class="muted">validation/v1.json not available yet (WS6).</p>
        )
      }
    </Show>
  )
}

function V2Section() {
  const l = useLoad(() => data().optional(() => data().v2()))
  const F = 'validation/v2.json'
  const [a, b] = CONFIG.distanceClassesKm
  return (
    <Show l={l} what="V2 skyline validation">
      {(v) =>
        v ? (
          <>
            <p>
              Predicted vs detected skyline elevation angle per image column, median and P90 by distance class (near &lt; {a} km, mid {a}–{b} km, far &gt;{' '}
              {b} km), over {v.frames.length} frames.
            </p>
            <LooseTable value={v.summary} file={F} />
            <p class="caption">The skyline check validates the DEM–camera–pose chain. It is not a hazard validation.</p>
          </>
        ) : (
          <p class="muted">validation/v2.json not available yet (WS3).</p>
        )
      }
    </Show>
  )
}

function CoverageSection() {
  const l = useLoad(async () => {
    const L = data()
    const [coverage, coreg, pad] = await Promise.all([L.optional(() => L.coverage()), L.optional(() => L.coreg()), L.optional(() => L.pad())])
    return { coverage, coreg, pad }
  })
  return (
    <Show l={l} what="Coverage and co-registration">
      {({ coverage, coreg, pad }) => (
        <>
          {coverage ? <LooseTable value={coverage} file="validation/coverage.json" /> : <p class="muted">validation/coverage.json not available yet (WS1).</p>}
          {pad && (
            <p>
              Pad 30-min flat disc assessed: <Num v={pad.pad.checks.assessed_pct_30min} units="%" file="pad.json" k="pad.checks.assessed_pct_30min" /> (rule: at
              least the site.yaml minimum); max slope at the pad <Num v={pad.pad.checks.max_slope_deg} units="deg" file="pad.json" k="pad.checks.max_slope_deg" />.
            </p>
          )}
          {coreg ? (
            <p>
              Co-registration shift to Curiosity drive ends: dx <Num v={coreg.dx_m} units="m" file="validation/coreg.json" k="coreg.dx_m" />, dy{' '}
              <Num v={coreg.dy_m} units="m" file="validation/coreg.json" k="coreg.dy_m" />; residual median{' '}
              <Num v={coreg.residual_median_m} units="m" file="validation/coreg.json" k="coreg.residual_median_m" />, MAD{' '}
              <Num v={coreg.residual_mad_m} units="m" file="validation/coreg.json" k="coreg.residual_mad_m" /> over {coreg.residuals.length} drive ends.
            </p>
          ) : (
            <p class="muted">validation/coreg.json not available yet (WS1).</p>
          )}
        </>
      )}
    </Show>
  )
}

function RadChecks() {
  const l = useLoad(() => data().optional(() => data().rad()))
  const ex = CITED.radExpected
  return (
    <Show l={l} what="RAD checks">
      {(r) =>
        r ? (
          <table class="mini">
            <thead>
              <tr>
                <th>Check</th>
                <th class="r">Recomputed (file)</th>
                <th class="r">Published range (config)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Storm peak dose rate</td>
                <td class="r">
                  <Num v={r.storm_2024.peak_uGy_day} units="uGy/day" file="conditions/rad.json" k="rad.storm_2024.peak_uGy_day" />
                </td>
                <td class="r">
                  <CfgNum v={`${ex.value.peak_mgy_day[0]}–${ex.value.peak_mgy_day[1]}`} units="mGy/day" source={`${ex.source}.peak_mgy_day`} />
                </td>
              </tr>
              <tr>
                <td>Event excess dose</td>
                <td class="r">
                  <Num v={r.storm_2024.excess_mGy} units="mGy" file="conditions/rad.json" k="rad.storm_2024.excess_mGy" />
                </td>
                <td class="r">
                  <CfgNum v={`${ex.value.excess_mgy[0]}–${ex.value.excess_mgy[1]}`} units="mGy" source={`${ex.source}.excess_mgy`} />
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p class="muted">conditions/rad.json not available yet (WS4).</p>
        )
      }
    </Show>
  )
}

const ASSUMPTIONS: { what: string; c: { value: unknown; source: string }; units?: string; basis: string }[] = [
  { what: 'Walkback budgets', c: CITED.walkbackBudgetsMin, units: 'min', basis: 'ICES-2026-127, "being considered"; not policy' },
  { what: 'Effort cap (fraction of VO₂max)', c: CITED.effortCapFrac, basis: 'ICES; NASA-STD-3001' },
  { what: 'VO₂max', c: CITED.vo2maxMlKgMin, units: 'mL/kg/min', basis: 'ICES; NASA-STD-3001' },
  { what: 'Level cost at Mars offload (anchor)', c: CITED.anchorVo2, units: 'mL/kg/min', basis: 'ICES (6 subjects)' },
  { what: 'Anchor speed', c: CITED.anchorSpeed, units: 'm/s', basis: 'ICES' },
  { what: 'Body mass', c: CITED.bodyMassKg, units: 'kg', basis: 'Our assumption (D10)' },
  { what: 'Suit masses', c: CITED.suitMassesKg, units: 'kg', basis: '80 kg is our sensitivity value' },
  { what: 'Suit O₂ budget planned against (primary)', c: CITED.o2PrimaryL, units: 'L', basis: 'Derived: NASA EVA-EXP-0075, ICES-2026-127; metabolic only' },
  { what: 'O₂ reserve in the route margin', c: CITED.o2ReserveFrac, basis: 'Our assumption' },
  { what: 'Slope limit, nominal', c: CITED.nogoNominalDeg, units: 'deg', basis: 'Scoville; our assumption' },
  { what: 'Slope limit, optimistic', c: CITED.nogoOptimisticDeg, units: 'deg', basis: 'Our assumption' },
  { what: 'Beyond tested suited data above', c: CITED.flagBeyondTestedDeg, units: 'deg', basis: 'IST-2 tested up to ≈17°' },
  { what: 'Dose allowance per EVA', c: CITED.dAllowMgy, units: 'mGy', basis: 'Our assumption, adjustable (D9)' },
  { what: 'Fix accuracy at the rover', c: CITED.fixSigmaRoverM, units: 'm', basis: 'Our assumption' },
  { what: 'Fix accuracy at a station', c: CITED.fixSigmaStationM, units: 'm', basis: 'Our assumption' },
  { what: 'Simulated drift (fallback rule)', c: CITED.driftPct, units: '%', basis: 'Our assumption (D12), % of distance walked' },
  { what: 'Casualty mass bound', c: CITED.casualtyBoundKg, units: 'kg', basis: 'NASA 2024 rescue challenge' },
  { what: 'Boot traction μ', c: CITED.haulBootMu, basis: 'Assumed band' },
]

export function RealModelledSimulated() {
  return (
    <table class="mini">
      <tbody>
        <tr>
          <td>
            <StatusTag kind="real" />
          </td>
          <td>
            Terrain, imagery, CRISM, THEMIS; Curiosity positions, tilt, Navcam frames, camera models; RAD dose rates; REMS archive; DONKI records; ephemeris.
            Labelled with their lag; the REMS feed is marked stale.
          </td>
        </tr>
        <tr>
          <td>
            <StatusTag kind="modelled" />
          </td>
          <td>
            Slope and no-go; metabolic cost, speed, O₂ and heat; return, haul and siting fields; predicted skylines; daylight; storm dose for a hypothetical crew;
            skyline-matching fix errors (measured on real Navcam); visual-odometry drift on Curiosity drives. Shown with bands.
          </td>
        </tr>
        <tr>
          <td>
            <StatusTag kind="simulated" />
          </td>
          <td>Astronauts, rover pad, casualty, EVA timing, the storm hitting this EVA; the HUD playback, crew position, position drift and fixes.</td>
        </tr>
      </tbody>
    </table>
  )
}

function Scorecard({ focus }: { focus?: string }) {
  return (
    <Page title="Scorecard" wide>
      <DummyNote />
      <section>
        <h2>Validation</h2>
        <h3>V1 · footing: DEM slope vs rover tilt</h3>
        <V1Section />
        <h3>V2 · view: predicted vs observed skyline</h3>
        <V2Section />
        <h3>Coverage and co-registration</h3>
        <CoverageSection />
        <h3>RAD checks</h3>
        <RadChecks />
        <h3>Known-answer tests</h3>
        <p class="muted">
          The KAT pass list has no web contract in contracts v{contractVersions().join(', ')} yet (WS6 proposed one; awaiting C). The full list runs in CI on every PR.
        </p>
      </section>
      <section>
        <h2>Assumptions</h2>
        <table class="mini">
          <thead>
            <tr>
              <th>Assumption</th>
              <th class="r">Value</th>
              <th>Basis</th>
            </tr>
          </thead>
          <tbody>
            {ASSUMPTIONS.map((a) => (
              <tr>
                <td>{a.what}</td>
                <td class="r">
                  <CfgNum v={Array.isArray(a.c.value) ? a.c.value.join(' / ') : (a.c.value as number)} units={a.units} source={a.c.source} />
                </td>
                <td>{a.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="caption">Values read from config/*.yaml at build time; hover a value for its file and key.</p>
      </section>
      <section>
        <h2>Real, modelled, simulated</h2>
        <RealModelledSimulated />
      </section>
      <section>
        <h2>Provenance manifest</h2>
        <ManifestTable focus={focus} />
      </section>
    </Page>
  )
}

export const view = preactView((route: Route) => <Scorecard focus={route.name === 'scorecard' ? route.key : undefined} />)
