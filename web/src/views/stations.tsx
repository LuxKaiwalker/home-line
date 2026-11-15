// "/stations" Science stations (its own top-bar mode, SCIENCE; no map, user 2026-11-15): why these spots.
// One card per site first (short name, one line, mineral index, score, walk home, links to the station card and the
// Mission Planer); the F7 scoring and placement rules follow below as quiet small print (teammate cleanup 2026-11-15). Rules and weights come from config/stations.yaml (stationsWhy.ts).
import './stations.css'
import { useEffect, useState } from 'preact/hooks'
import { data } from '../data/loader'
import type { ScenarioEntry, Station } from '../data/types'
import { href } from '../router'
import { AssumedTag, DataProblem, DummyNote, StatusTag } from '../components/labels'
import { CfgNum, Num } from '../components/Num'
import { homeFor } from './decisions'
import { preactView } from './page'
import { indexWords, OBJECTIVE_SOURCE, SCORING, siteSummary, STATIONS_SOURCE } from './stationsWhy'
import type { View } from './types'

export const view: View = preactView(() => <StationsPage />)

function StationsPage() {
  const L = data()
  const [stations, setStations] = useState<Station[] | null>(null)
  const [scenario, setScenario] = useState<ScenarioEntry | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [idx, st] = await Promise.all([L.scenarios(), L.stations()])
        if (!alive) return
        setStations(st)
        setScenario(idx.scenarios.find((s) => s.id === idx.default) ?? idx.scenarios[0])
      } catch (e) {
        if (alive) setError(e)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const W = SCORING.weights
  const src = STATIONS_SOURCE
  return (
    <div class="page page-wide st-body">
      <h1>Science stations</h1>
      <DummyNote />
      <p class="lead">
        Where the crew stops to do science. Click a site for its card: Curiosity's own Navcam photo, the predicted skyline, timeline and walk home. How the sites
        were picked is at the bottom of the page.
      </p>

      {error != null && <DataProblem error={error} what="Science stations" />}
      {!stations && error == null && <p class="muted">Loading stations…</p>}
      {stations && scenario && (
        <ol class="st-list">
          {stations.map((s) => (
            <StationRow key={s.id} s={s} sid={scenario.id} />
          ))}
        </ol>
      )}

      <section class="st-method">
        <h4>How a spot is scored (F7)</h4>
        <p class="st-formula">
          score = <CfgNum v={W.crism} source={src} /> × mineral signal + <CfgNum v={W.ridge_density} source={src} /> × ridge density + <CfgNum v={W.manual} source={src} /> × priority{' '}
          {SCORING.weightsAssumed && <AssumedTag note="F7 weights 0.4 / 0.4 / 0.2 are a team choice (D32), labelled assumed" />}
        </p>
        <dl class="st-terms">
          <dt>Mineral signal</dt>
          <dd>
            <StatusTag kind="real" /> Orbital spectra from NASA's MRO CRISM: the <code>{SCORING.crismIndices.clay}</code> index ({indexWords(SCORING.crismIndices.clay)}) and the{' '}
            <code>{SCORING.crismIndices.sulfate}</code> index ({indexWords(SCORING.crismIndices.sulfate)}). Clays and sulfates formed in water, so they mark where groundwater once flowed. Scaled 0–1
            within the study area.
          </dd>
          <dt>Ridge density</dt>
          <dd>
            <StatusTag kind="real" /> Share of boxwork ridge cells in the 1 m terrain model within <CfgNum v={SCORING.ridgeRadiusM} units="m" source={src} />. The ridges are thought to be fractures cemented by minerals from groundwater,
            the question S1 tests.
          </dd>
          <dt>Priority</dt>
          <dd>Extra weight for sites the science plan asks for (e.g. the sulfur field Curiosity found); 0 otherwise.</dd>
        </dl>
      </section>

      <section class="st-method">
        <h4>How the stations are placed</h4>
        <ul class="st-rules">
          <li>
            Named stations first, each by its own rule, in the order {SCORING.placementOrder.join(' → ')}. Then up to <CfgNum v={SCORING.extrasMax} source={src} /> extra stations: the highest scores
            left.
          </li>
          <li>
            Every station is at least <CfgNum v={SCORING.minSpacingM} units="m" source={src} /> from every other, and its ground is walkable.
          </li>
          {SCORING.dropped.length > 0 && (
            <li>
              Dropped: {SCORING.dropped.map((d) => `${d.id} ${d.name}`).join(', ')}. They were hand picks whose imagery was never checked (D44).
            </li>
          )}
        </ul>
      </section>

      <p class="caption">
        Rules and weights: <code>{src}</code>. Objectives of named stations: {OBJECTIVE_SOURCE}. Scores: <code>stations.json</code> (WS1). Time home: WS2, scenario <code>{scenario?.id ?? '…'}</code>.
      </p>
    </div>
  )
}

function StationRow({ s, sid }: { s: Station; sid: string }) {
  const site = siteSummary(s.id, s.name)
  const h = homeFor(s, sid)
  return (
    <li class="st-row">
      <a class="st-head" href={href({ name: 'station', id: s.id })}>
        <span class="st-id">{s.id}</span>
        <span class="st-name">{site.title}</span>
      </a>
      {site.note && <p class="st-why">{site.note}</p>}
      <dl class="st-nums">
        <div>
          <dt>Mineral index</dt>
          <dd>
            {site.index === 'max' ? (
              <span title={indexWords('max') ?? undefined}>clay / sulfate</span>
            ) : (
              <>
                {indexWords(site.index) ?? '–'}
                {site.index && <span class="st-code"> {site.index}</span>}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Score</dt>
          <dd>
            <Num v={s.value} file="stations.json" k={`stations.${s.id}.value`} />
          </dd>
        </div>
        <div>
          <dt>Walk home</dt>
          <dd>{h.kind === 'time' ? <Num v={h.v} units="min" file="stations.json" k={`t_home_min.${s.id}.${sid}`} /> : h.kind === 'unreachable' ? h.label : 'unknown'}</dd>
        </div>
      </dl>
      <div class="st-actions">
        <a href={href({ name: 'station', id: s.id })}>Details →</a>
        <a href={href({ name: 'mission', add: s.id })}>+ Add to Mission Planer</a>
      </div>
    </li>
  )
}
