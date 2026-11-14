// /station/:id — station card (F15): Navcam frame + skyline overlay and its error, predicted
// panorama, landmarks, timeline (arrive / leave / turn back), time home per scenario, binding margin
// term, contingency, tasks. Every number is read from stations.json, cards/<id>.json or the timeline.
import { CONFIG } from '../config'
import { data } from '../data/loader'
import type { Card, ScenariosIndex, Station, TimelineEvent } from '../data/types'
import { dataUrl } from '../env'
import { href, type Route } from '../router'
import { AssumedTag, DummyNote, StatusTag } from '../components/labels'
import { Num } from '../components/Num'
import { Page, preactView, Show, useLoad } from './page'

export const MARGIN_LABEL: Record<string, string> = { O2: 'oxygen', daylight: 'daylight', dose: 'radiation dose' }

interface StationData {
  station: Station
  stations: Station[]
  card: Card | null
  idx: ScenariosIndex | null
  timeline: TimelineEvent[] | null
  timelineScenario: string | null
}

async function loadStation(id: string): Promise<StationData> {
  const L = data()
  const stations = await L.stations()
  const station = stations.find((s) => s.id === id)
  if (!station) throw new Error(`no station "${id}" in stations.json`)
  const [card, idx] = await Promise.all([L.optional(() => L.card(station)), L.optional(() => L.scenarios())])
  const timelineScenario = idx?.default ?? null
  const timeline = timelineScenario ? await L.optional(() => L.timeline(timelineScenario)) : null
  return { station, stations, card, idx, timeline, timelineScenario }
}

function StationCard({ id }: { id: string }) {
  const l = useLoad(() => loadStation(id), [id])
  const title = l.state === 'ok' ? `${l.data.station.id} · ${l.data.station.name}` : `Station ${id}`
  return (
    <Page title={title} wide>
      <DummyNote />
      <Show l={l} what="Station card">
        {(d) => <CardBody d={d} />}
      </Show>
    </Page>
  )
}

const NO_CARD = 'not available yet (cards/*.json)'

function CardBody({ d }: { d: StationData }) {
  const { station: s, card } = d
  const cf = s.card
  const c: Card = card ?? EMPTY_CARD
  const i = d.stations.findIndex((x) => x.id === s.id)
  const prev = d.stations[(i - 1 + d.stations.length) % d.stations.length]
  const next = d.stations[(i + 1) % d.stations.length]
  const events = (d.timeline ?? []).map((e, i) => ({ e, i })).filter(({ e }) => e.station === s.id)
  const tk = (i: number, f: string) => `timeline.${d.timelineScenario}.${i}.${f}`
  const tfile = d.timelineScenario ? `timeline_${d.timelineScenario}.json` : ''

  return (
    <div class="card-grid">
      <section class="card-main">
        <p class="objective">{s.objective}</p>
        {!card && <p class="muted">Station card file {NO_CARD}: Navcam, panorama, landmarks and timeline are missing; values below come from stations.json.</p>}
        <figure class="navcam">
          {c.navcam.url_local ? (
            <div class="navcam-stack">
              <img src={dataUrl(c.navcam.url_local)} alt={c.navcam.image_id ? `Navcam frame ${c.navcam.image_id}` : 'Navcam frame placeholder'} />
              {c.navcam.overlay_png && <img class="overlay" src={dataUrl(c.navcam.overlay_png)} alt="Predicted skyline overlay" />}
            </div>
          ) : (
            <div class="placeholder-box">Navcam frame: not available yet (WS3)</div>
          )}
          <figcaption>
            {c.navcam.image_id ? <StatusTag kind="real" /> : null} Curiosity Navcam
            {c.navcam.sol !== null ? (
              <>
                , sol <Num v={c.navcam.sol} file={cf} k={`navcam_sol.${s.id}`} />
              </>
            ) : null}
            {c.navcam.image_id ? `, ${c.navcam.image_id}` : c.navcam.url_local ? ' (placeholder image, no frame yet)' : ''} · <StatusTag kind="modelled" /> predicted skyline
            {c.navcam.overlay_png ? '' : ' (overlay not available yet)'}
            <br />
            Skyline error, far field (&gt; {FAR_KM} km): <Num v={c.skyline_error_deg.far} units="deg" file={cf} k={`skyline_error_deg.${s.id}.far`} /> · mid:{' '}
            <Num v={c.skyline_error_deg.mid} units="deg" file={cf} k={`skyline_error_deg.${s.id}.mid`} /> · near:{' '}
            <Num v={c.skyline_error_deg.near} units="deg" file={cf} k={`skyline_error_deg.${s.id}.near`} />
            <br />
            <span class="muted">The skyline check validates the DEM–camera–pose chain. It is not a hazard validation.</span>
          </figcaption>
        </figure>

        <figure class="panorama">
          {c.panorama_png ? (
            <img src={dataUrl(c.panorama_png)} alt="Predicted panorama from this station" />
          ) : (
            <div class="placeholder-box slim">Predicted panorama: not available yet (WS3)</div>
          )}
          <figcaption>
            <StatusTag kind="modelled" /> Predicted horizon from the elevation model at crew eye height.
          </figcaption>
        </figure>

        {c.landmarks.length > 0 && (
          <table class="mini">
            <thead>
              <tr>
                <th>Landmark</th>
                <th class="r">Bearing</th>
                <th class="r">Distance</th>
              </tr>
            </thead>
            <tbody>
              {c.landmarks.map((lm, j) => (
                <tr>
                  <td>{lm.name}</td>
                  <td class="r">
                    <Num v={lm.bearing_deg} units="deg" file={cf} k={`landmarks.${s.id}.${j}.bearing_deg`} />
                  </td>
                  <td class="r">
                    <Num v={lm.dist_km} units="km" file={cf} k={`landmarks.${s.id}.${j}.dist_km`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <aside class="card-side">
        <section class="kv">
          <h3>
            Timeline <StatusTag kind="simulated" />
          </h3>
          <dl>
            <dt>Arrive</dt>
            <dd>
              <Num v={c.timeline.arrive} units="min" file={cf} k={`arrive_min.${s.id}`} /> <span class="muted">into the EVA</span>
            </dd>
            <dt>Leave</dt>
            <dd>
              <Num v={c.timeline.leave} units="min" file={cf} k={`leave_min.${s.id}`} />
            </dd>
            <dt>Turn back by</dt>
            <dd class="strong">
              <Num v={c.timeline.turn_back} units="min" file={cf} k={`turn_back_min.${s.id}`} />
            </dd>
            <dt>Dwell</dt>
            <dd>
              <Num v={s.dwell_min} units="min" file="stations.json" k={`dwell_min.${s.id}`} />
            </dd>
            <dt>Binding margin</dt>
            <dd>{card ? (MARGIN_LABEL[c.margin_binding] ?? c.margin_binding) : <span class="muted">{NO_CARD}</span>}</dd>
          </dl>
        </section>

        <section class="kv">
          <h3>
            Walk home from here <StatusTag kind="modelled" />
          </h3>
          <dl>
            {Object.entries(s.t_home_min).map(([sc, v]) => (
              <>
                <dt>{sc}</dt>
                <dd>
                  <Num v={v} units="min" file="stations.json" k={`t_home_min.${s.id}.${sc}`} />
                </dd>
              </>
            ))}
          </dl>
        </section>

        <section class="kv">
          <h3>Contingency</h3>
          <p>{card ? c.contingency : <span class="muted">{NO_CARD}</span>}</p>
          <p>
            Partner-haul range: {s.in_partner_line === null ? <span class="num-unknown">unknown</span> : s.in_partner_line ? 'inside' : <b>outside</b>}{' '}
            <AssumedTag note="Partner line: design question; every haul parameter is an assumed band" />
          </p>
        </section>

        <section class="kv">
          <h3>Science</h3>
          <p>
            Value <Num v={s.value} file="stations.json" k={`station_value.${s.id}`} />
          </p>
          <ul class="tasks">
            {s.tasks.map((t) => (
              <li>{t}</li>
            ))}
          </ul>
        </section>

        {events.length > 0 && (
          <section class="kv">
            <h3>
              Route events ({d.timelineScenario}) <StatusTag kind="simulated" />
            </h3>
            <table class="mini">
              <thead>
                <tr>
                  <th>Event</th>
                  <th class="r">t</th>
                  <th class="r">O₂ left</th>
                  <th class="r">Margin</th>
                </tr>
              </thead>
              <tbody>
                {events.map(({ e, i }) => (
                  <tr>
                    <td>{e.event}</td>
                    <td class="r">
                      <Num v={e.t_min} units="min" file={tfile} k={tk(i, 't_min')} />
                    </td>
                    <td class="r">
                      <Num v={e.o2_left_L} units="L" file={tfile} k={tk(i, 'o2_left_L')} />
                    </td>
                    <td class="r">
                      <Num v={e.margin_min} units="min" file={tfile} k={tk(i, 'margin_min')} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <nav class="card-nav">
          <a href={href({ name: 'station', id: prev.id })}>← {prev.id}</a>
          <a href={href({ name: 'console' })}>Map</a>
          <a href={href({ name: 'cuff' })}>Cuff card</a>
          <a href={href({ name: 'station', id: next.id })}>{next.id} →</a>
        </nav>
      </aside>
    </div>
  )
}

// Far-field class boundary (config/horizon.yaml distance_classes_km, last value).
const FAR_KM = CONFIG.distanceClassesKm[CONFIG.distanceClassesKm.length - 1]

// Placeholder for a missing cards/<id>.json: every number null (shown "unknown"), no fake text.
const EMPTY_CARD: Card = {
  navcam: { sol: null, image_id: null, url_local: null, overlay_png: null },
  skyline_error_deg: { near: null, mid: null, far: null },
  panorama_png: null,
  landmarks: [],
  timeline: { arrive: null, leave: null, turn_back: null },
  margin_binding: '' as Card['margin_binding'],
  contingency: '',
}

export const view = preactView((route: Route) => <StationCard id={route.name === 'station' ? route.id : ''} />)
