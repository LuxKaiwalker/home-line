// /conditions — F14: RAD dose rate (latest, with its lag), baseline, the 20 May 2024 storm series
// with onset and tripwire, the dose leash with the D9 allowance slider, REMS climatology, Mars clock
// and DONKI context ("context only, not a trigger").
import { useState } from 'preact/hooks'
import { CITED, CONFIG } from '../config'
import { data } from '../data/loader'
import type { Rad } from '../data/types'
import { linear, log10Scale, logTicks, polyline } from '../chart/scale'
import { AssumedTag, DummyNote, StatusTag } from '../components/labels'
import { LooseTable } from '../components/Loose'
import { CfgNum, DerivedNum, Num } from '../components/Num'
import { sliderStops, tauMin } from './leash'
import { Page, preactView, Show, useLoad } from './page'

const F = 'conditions/rad.json'

export function utcLabel(iso: string | null): string {
  return iso ? iso.replace('T', ' ').replace(/(:00)?(\.000)?Z$/, ' UTC') : 'unknown'
}

export function RadChart({ rad }: { rad: Rad }) {
  const s = rad.storm_2024
  const pts = s.series.map(([t, v]) => [Date.parse(t), v !== null && v > 0 ? v : null] as [number, number | null]).filter(([t]) => Number.isFinite(t))
  const vals = pts.map((p) => p[1]).filter((v): v is number => v !== null)
  if (!pts.length || !vals.length) return <p class="muted">No storm series.</p>
  const W = 720
  const H = 280
  const m = { l: 64, r: 12, t: 12, b: 36 }
  const t0 = pts[0][0]
  const t1 = pts[pts.length - 1][0]
  const lo = 10 ** Math.floor(Math.log10(Math.min(...vals)))
  const hi = 10 ** Math.ceil(Math.log10(Math.max(...vals)))
  const x = linear([t0, t1], [m.l, W - m.r])
  const y = log10Scale([lo, hi], [H - m.b, m.t])
  const days: number[] = []
  for (let d = Math.ceil(t0 / 864e5) * 864e5; d <= t1; d += 864e5) days.push(d)
  const vline = (iso: string | null, cls: string, label: string, dy: number) => {
    const t = iso ? Date.parse(iso) : NaN
    if (!Number.isFinite(t)) return null
    return (
      <g class={cls}>
        <line x1={x(t)} x2={x(t)} y1={m.t} y2={H - m.b} />
        <text x={x(t) + 4} y={m.t + 12 + dy}>
          {label}
        </text>
      </g>
    )
  }
  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="RAD dose rate during the May 2024 storm, log scale">
      {logTicks(lo, hi).map((v) => (
        <g class="tick">
          <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} />
          <text x={m.l - 6} y={y(v) + 4} text-anchor="end">
            {v >= 1000 ? `${v / 1000}k` : v}
          </text>
        </g>
      ))}
      {days.map((d) => (
        <g class="tick">
          <line x1={x(d)} x2={x(d)} y1={H - m.b} y2={H - m.b + 4} />
          <text x={x(d)} y={H - m.b + 18} text-anchor="middle">
            {new Date(d).toISOString().slice(5, 10)}
          </text>
        </g>
      ))}
      <text class="axis-label" x={12} y={m.t + 4} transform={`rotate(-90 12 ${m.t + 4})`} text-anchor="end">
        µGy/day (log)
      </text>
      {rad.baseline_uGy_day !== null && rad.baseline_uGy_day > 0 && (
        <g class="baseline">
          <line x1={m.l} x2={W - m.r} y1={y(rad.baseline_uGy_day)} y2={y(rad.baseline_uGy_day)} />
          <text x={W - m.r - 4} y={y(rad.baseline_uGy_day) - 4} text-anchor="end">
            baseline
          </text>
        </g>
      )}
      {vline(s.onset_utc, 'onset', 'onset', H - m.b - m.t - 20)}
      {vline(s.tripwire_utc, 'tripwire', 'tripwire', 0)}
      {polyline(pts, x, y).map((p) => (
        <polyline class="series" points={p} />
      ))}
    </svg>
  )
}

/** D9: dose allowance slider. Off the file's default, tau is recomputed with the config formula. */
export function LeashSlider({ rad }: { rad: Rad }) {
  const sl = CONFIG.dAllowSliderMgy
  const d0 = rad.leash.D_allow_mGy ?? CONFIG.dAllowMgy
  const [d, setD] = useState(d0)
  if (!sl) {
    return (
      <p class="muted">
        Dose-allowance slider (D9): waiting for its range in <code>config/conditions.yaml</code> (<code>leash.d_allow_slider_mgy</code>); the page will not
        invent one.
      </p>
    )
  }
  const stops = sliderStops(sl.min, sl.max, sl.step)
  const i = Math.max(0, stops.findIndex((s) => Math.abs(s - d) < 1e-9))
  const atDefault = Math.abs(d - d0) < 1e-9
  const peak = rad.storm_2024.peak_uGy_day
  const latest = rad.latest.dose_rate_uGy_day
  const how = (rate: string) => `60 × D_allow / Ḋ (config/conditions.yaml leash.formula), D_allow = ${d} mGy, Ḋ = ${rate} from ${F}`
  return (
    <div class="leash-slider">
      <label>
        Dose allowance per EVA{' '}
        <input type="range" min={0} max={stops.length - 1} step={1} value={i} aria-label="Dose allowance per EVA" onInput={(e) => setD(stops[+(e.target as HTMLInputElement).value])} />{' '}
        <b>{d} mGy</b> <AssumedTag note="Dose allowance per EVA: our assumption (D9), adjustable" />
      </label>
      <dl class="leash-out">
        <dt>Time on the allowance at the storm peak</dt>
        <dd class="strong">
          {atDefault ? (
            <Num v={rad.leash.tau_min_at_peak} units="min" file={F} k="rad.leash.tau_min_at_peak" />
          ) : (
            <DerivedNum v={roundTenth(tauMin(d, peak))} units="min" how={how('storm peak')} />
          )}
        </dd>
        <dt>… at the latest measured rate</dt>
        <dd>
          <DerivedNum v={roundTenth(tauMin(d, latest))} units="min" how={how('latest rate')} />
        </dd>
      </dl>
      <p class="caption">
        At the default allowance the value is the pipeline's (rad.json); other allowances are computed in the browser from the same backed rate.
      </p>
    </div>
  )
}

function roundTenth(v: number | null): number | null {
  return v === null ? null : Math.round(v * 10) / 10
}

function Context() {
  const l = useLoad(async () => {
    const L = data()
    const [clock, rems, donki] = await Promise.all([L.optional(() => L.clock()), L.optional(() => L.rems()), L.optional(() => L.donki())])
    return { clock, rems, donki }
  })
  return (
    <Show l={l} what="Weather, clock and space-weather context">
      {({ clock, rems, donki }) => (
        <>
          <h3>
            Mars clock and sun <StatusTag kind="modelled" />
          </h3>
          {clock ? <LooseTable value={clock} file="conditions/clock.json" /> : <p class="muted">conditions/clock.json not available yet (WS4).</p>}

          <h3>
            Weather (REMS same-season climatology) <StatusTag kind="real" />
          </h3>
          {rems ? <LooseTable value={rems} file="conditions/rems.json" /> : <p class="muted">conditions/rems.json not available yet (WS4).</p>}
          <p class="caption">
            The REMS feed is stale since <CfgNum v={CITED.remsStaleSince.value} source={CITED.remsStaleSince.source} />.
          </p>

          <h3>Space weather (DONKI): context only, not a trigger</h3>
          {donki ? (
            donki.records.length ? (
              <LooseTable value={Object.fromEntries(donki.records.map((r, i) => [String(i), r]))} file="conditions/donki.json" />
            ) : (
              <p class="muted">No DONKI records in the window.</p>
            )
          ) : (
            <p class="muted">conditions/donki.json not available yet (WS4).</p>
          )}
        </>
      )}
    </Show>
  )
}

function ConditionsView() {
  const l = useLoad(() => data().rad())
  return (
    <Page title="Conditions">
      <DummyNote />
      <Show l={l} what="RAD conditions">
        {(r) => (
          <>
            <section>
              <h2>
                Radiation now <StatusTag kind="real" />
              </h2>
              <p>
                Latest Curiosity RAD dose rate: <Num v={r.latest.dose_rate_uGy_day} units="uGy/day" file={F} k="rad.latest.dose_rate_uGy_day" /> at{' '}
                <Num v={r.latest.utc} file={F} k="rad.latest.utc" fmt={utcLabel} />, <Num v={r.latest.lag_days} units="days" file={F} k="rad.latest.lag_days" /> behind
                real time. Baseline <Num v={r.baseline_uGy_day} units="uGy/day" file={F} k="rad.baseline_uGy_day" />.
              </p>
            </section>
            <section>
              <h2>
                20 May 2024 solar storm, replayed <StatusTag kind="real" /> <StatusTag kind="modelled" />
              </h2>
              <RadChart rad={r} />
              <p>
                Peak <Num v={r.storm_2024.peak_uGy_day} units="uGy/day" file={F} k="rad.storm_2024.peak_uGy_day" />, event excess{' '}
                <Num v={r.storm_2024.excess_mGy} units="mGy" file={F} k="rad.storm_2024.excess_mGy" /> (quality factor{' '}
                <CfgNum v={CITED.qSep.value} source={CITED.qSep.source} /> for the SEP). Onset{' '}
                <Num v={r.storm_2024.onset_utc} file={F} k="rad.storm_2024.onset_utc" fmt={utcLabel} />; the tripwire fired at{' '}
                <Num v={r.storm_2024.tripwire_utc} file={F} k="rad.storm_2024.tripwire_utc" fmt={utcLabel} />.
              </p>
              <p class="caption">
                Tripwire (the alarm): more than <CfgNum v={CITED.tripwireFactor.value} source={CITED.tripwireFactor.source} />× baseline in{' '}
                <CfgNum v={CITED.tripwireSamples.value} source={CITED.tripwireSamples.source} /> consecutive samples. The storm dose for a hypothetical crew is
                modelled from Curiosity's measured rate.
              </p>
            </section>
            <section>
              <h2>
                Dose leash <StatusTag kind="modelled" />
              </h2>
              <p>
                With a dose allowance of <Num v={r.leash.D_allow_mGy} units="mGy" file={F} k="rad.leash.D_allow_mGy" /> per EVA{' '}
                <AssumedTag note="Dose allowance per EVA: our assumption (D9), adjustable" />, the crew turns back when the walk home takes longer than the time left on
                the allowance. At the storm peak that time is{' '}
                <b>
                  <Num v={r.leash.tau_min_at_peak} units="min" file={F} k="rad.leash.tau_min_at_peak" />
                </b>
                .
              </p>
              <LeashSlider rad={r} />
            </section>
            <section>
              <h2>Weather, clock and space-weather context</h2>
              <Context />
            </section>
          </>
        )}
      </Show>
    </Page>
  )
}

export const view = preactView(() => <ConditionsView />)
