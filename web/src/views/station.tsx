// /station/:id — station card (F15): Navcam frame + skyline overlay and its error, predicted
// panorama, landmarks, timeline (arrive / leave / turn back), time home per scenario, binding margin
// term, contingency, tasks. Every number is read from stations.json, cards/<id>.json or the timeline.
import { CITED, CONFIG } from '../config'
import { accessFor, type AccessView } from '../data/access'
import { data } from '../data/loader'
import type { Card, ScenariosIndex, Station, TimelineEvent } from '../data/types'
import { dataUrl } from '../env'
import { href, type Route } from '../router'
import { AssumedTag, DataProblem, DummyNote, StatusTag } from '../components/labels'
import { CfgNum, Num } from '../components/Num'
import { Page, preactView, Show, useLoad } from './page'

export const MARGIN_LABEL: Record<string, string> = { O2: 'oxygen', daylight: 'daylight', dose: 'radiation dose' }

/** Binding margin term for display; null = the station has no route (contract v1.1.1). */
export function marginLabel(b: string | null | undefined): string {
  if (b === null) return 'none: no route to this station'
  if (b === undefined || b === '') return 'unknown'
  return MARGIN_LABEL[b] ?? b
}

/** Manifest key of a landmark number (WS3 pipeline/horizon/cards.py: spaces become underscores). */
export function landmarkKey(station: string, name: string, f: 'bearing_deg' | 'dist_km'): string {
  return `landmark.${station}.${name.replace(/\s+/g, '_')}.${f}`
}

interface StationData {
  station: Station
  stations: Station[]
  card: Card | null
  cardError: unknown
  idx: ScenariosIndex | null
  timeline: TimelineEvent[] | null
  scenario: string | null
}

async function loadStation(id: string): Promise<StationData> {
  const L = data()
  const stations = await L.stations()
  const station = stations.find((s) => s.id === id)
  if (!station) throw new Error(`no station "${id}" in stations.json`)
  const idx = await L.optional(() => L.scenarios())
  // A card that fails its contract is reported on the page, the rest of the card still shows.
  let card: Card | null = null
  let cardError: unknown = null
  try {
    card = await L.optional(() => L.card(station))
  } catch (e) {
    cardError = e
  }
  const scenario = card?.scenario ?? idx?.default ?? null
  const timeline = scenario ? await L.optional(() => L.timeline(scenario)) : null
  return { station, stations, card, cardError, idx, timeline, scenario }
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
  const tk = (i: number, f: string) => `timeline.${d.scenario}.${i}.${f}`
  const tfile = d.scenario ? `timeline_${d.scenario}.json` : ''
  const acc = d.scenario ? accessFor(s, d.scenario, card) : null
  const farPending = /D7/.test(c.skyline_error_scope ?? '') || c.skyline_error_deg.far !== null

  return (
    <div class="card-grid">
      <section class="card-main">
        {s.objective && <p class="objective">{s.objective}</p>}
        {d.cardError != null && <DataProblem error={d.cardError} what={`Station card ${cf}`} />}
        {!card && d.cardError == null && <p class="muted">Station card file {NO_CARD}: Navcam, panorama, landmarks and timeline are missing; values below come from stations.json.</p>}
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
            {c.navcam.image_id ? `, ${c.navcam.image_id}` : c.navcam.url_local ? ' (placeholder image, no frame yet)' : ''}
            {typeof c.navcam.credit === 'string' ? ` (${c.navcam.credit})` : ''} · <StatusTag kind="modelled" /> predicted skyline
            {c.navcam.overlay_png ? '' : ' (overlay not available yet)'}
            <br />
            Skyline error, far field (&gt; {FAR_KM} km): <Num v={c.skyline_error_deg.far} units="deg" file={cf} k={`skyline_error_deg.${s.id}.far`} />
            {farPending && (
              <span class="pending" title="Far-field skyline errors wait for the D7 manual check of the automatic sky detector (decision open)">
                {' '}
                pending D7
              </span>
            )}{' '}
            · mid: <Num v={c.skyline_error_deg.mid} units="deg" file={cf} k={`skyline_error_deg.${s.id}.mid`} /> · near:{' '}
            <Num v={c.skyline_error_deg.near} units="deg" file={cf} k={`skyline_error_deg.${s.id}.near`} />
            {c.skyline_error_deg.near === null && c.skyline_error_deg.mid === null && c.navcam.image_id ? (
              <span class="muted"> (this frame has no near or mid skyline columns)</span>
            ) : null}
            <br />
            {c.skyline_error_scope && (
              <>
                <span class="muted">{c.skyline_error_scope}.</span>
                <br />
              </>
            )}
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
            <StatusTag kind="modelled" /> Predicted horizon from the elevation model at crew eye height
            {c.observer?.position === 'access_cell' ? ', seen from the access cell' : c.observer?.position === 'science_coordinate_no_access' ? ', seen from the science point (no access cell)' : ''}
            .
          </figcaption>
        </figure>

        <h3>Landmarks</h3>
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
              {c.landmarks.map((lm) => (
                <tr>
                  <td>
                    {lm.name}
                    {lm.above_skyline === false ? <span class="muted"> (within 5 km, below the skyline)</span> : null}
                  </td>
                  <td class="r">
                    <Num v={lm.bearing_deg} units="deg" file={cf} k={landmarkKey(s.id, lm.name, 'bearing_deg')} />
                  </td>
                  <td class="r">
                    <Num v={lm.dist_km} units="km" file={cf} k={landmarkKey(s.id, lm.name, 'dist_km')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {card && c.landmarks.length === 0 && <p>No landmark qualifies from this station.</p>}
        {c.landmarks_note && <p class="caption">{c.landmarks_note}. The list is not padded.</p>}
      </section>

      <aside class="card-side">
        {acc && <AccessBlock s={s} a={acc} scenario={d.scenario!} />}

        <section class="kv">
          <h3>
            Timeline {d.scenario ? <code>{d.scenario}</code> : null} <StatusTag kind="simulated" />
          </h3>
          {card?.on_route === false && <p class="muted">Not on the planned route for this scenario.</p>}
          <dl>
            <dt>Arrive</dt>
            <dd>
              <Num v={c.timeline.arrive} units="min" file={cf} k={`card.${s.id}.timeline.arrive`} /> <span class="muted">into the EVA</span>
            </dd>
            <dt>Leave</dt>
            <dd>
              <Num v={c.timeline.leave} units="min" file={cf} k={`card.${s.id}.timeline.leave`} />
            </dd>
            <dt>Turn back by</dt>
            <dd class="strong">
              <Num v={c.timeline.turn_back} units="min" file={cf} k={`card.${s.id}.timeline.turn_back`} />
            </dd>
            <dt>Dwell</dt>
            <dd>
              <Num v={s.dwell_min} units="min" file="stations.json" k={`dwell_min.${s.id}`} />
            </dd>
            <dt>Binding margin</dt>
            <dd>{card ? marginLabel(c.margin_binding) : <span class="muted">{NO_CARD}</span>}</dd>
            {card && c.margin_min !== undefined && (
              <>
                <dt>Margin</dt>
                <dd>
                  <Num v={c.margin_min} units="min" file={cf} k={`card.${s.id}.margin_min`} />
                </dd>
              </>
            )}
          </dl>
        </section>

        <section class="kv">
          <h3>
            Walk home from the access cell <StatusTag kind="modelled" />
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
              Route events ({d.scenario}) <StatusTag kind="simulated" />
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

/** Access-cell rule (user 11:40): science point, access cell, straight walk-in (not modelled). */
function AccessBlock({ s, a, scenario }: { s: Station; a: AccessView; scenario: string }) {
  const k = (f: string) => `${a.keyPrefix}.${f}`
  const w = a.walkIn
  return (
    <section class="kv">
      <h3>
        Access <code>{scenario}</code>
      </h3>
      {a.state === 'none' ? (
        <p>
          <b>
            No access cell within{' '}
            {a.radius_m !== null ? <CfgNum v={a.radius_m} units="m" source={CITED.accessRadiusM.source} /> : 'the access radius'}
          </b>
          {a.reason ? `: ${a.reason}` : ''}. No walk home is computed for {s.id}; the science point is shown as is, never snapped.
        </p>
      ) : a.state === 'unknown' ? (
        <p class="muted">No access-cell data for this scenario.</p>
      ) : (
        <>
          <dl>
            <dt>Science point</dt>
            <dd>the station coordinate (filled marker)</dd>
            <dt>Access cell</dt>
            <dd>
              <Num v={a.access!.lon} file={a.file} k={k('lon')} />, <Num v={a.access!.lat} file={a.file} k={k('lat')} />
            </dd>
            <dt>Walk-in</dt>
            <dd class="strong">
              <Num v={a.dist_m} units="m" file={a.file} k={k('dist_m')} />
            </dd>
            {w && (
              <>
                <dt>Rise</dt>
                <dd>
                  <Num v={w.rise_m ?? null} units="m" file={a.file} k={k('walk_in.rise_m')} />
                </dd>
                <dt>Slope, mean / max along</dt>
                <dd>
                  <Num v={w.mean_slope_deg ?? null} units="deg" file={a.file} k={k('walk_in.mean_slope_deg')} /> /{' '}
                  <Num v={w.max_slope_deg ?? null} units="deg" file={a.file} k={k('walk_in.max_slope_deg')} />
                </dd>
                <dt>Steepest terrain crossed</dt>
                <dd>
                  <Num v={w.max_terrain_slope_deg ?? null} units="deg" file={a.file} k={k('walk_in.max_terrain_slope_deg')} />
                </dd>
              </>
            )}
          </dl>
          <p class="caption">
            Walk-in is a straight line from the access cell to the science point and is <b>not modelled</b> (no time or O₂ for it). Access radius{' '}
            <CfgNum v={CITED.accessRadiusM.value} units="m" source={CITED.accessRadiusM.source} /> <AssumedTag note="Access radius assumed by WS2" />.
          </p>
        </>
      )}
    </section>
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
  margin_binding: undefined as unknown as Card['margin_binding'],
  contingency: '',
}

export const view = preactView((route: Route) => <StationCard id={route.name === 'station' ? route.id : ''} />)
