// I3 (instant browser path): the "EVA start" card in the Edit-route drawer, ported from N0CEO's Mission
// Planer picker (origin/waypoint-routing d7d80e0, web/src/mission/StartTime.tsx). Pick the start as an
// Earth date/time (UTC) or as a Mars sol + LMST; both set one instant. Sol, LMST, Ls, the sun at the
// pad, sunset and the minutes to darkness come from the Mars24 port (mission/marstime.ts); the instant
// feeds the estimate's daylight term and mission.json (estimate.ts start / setStart, browser/start.ts).
// Default = clock.json's instant (09:00 LMST, D31): nothing changes until the user moves it. A moved
// start is labelled CUSTOM_START_LABEL. Changes from the Mission Planer card: the start lives for this
// visit only (not in browser storage), so a reload is the validated scenario again; drawer classes.
import { useSignalValue } from '../../../state/signal'
import { cx } from '../../../ui/components/Icon'
import { CLOCK, formatHms, LEAP_VALID_UNTIL_MS, lmstH, utcAtSolLmst, type EvaClock } from '../../../mission/marstime'
import { fill } from '../text'
import { CUSTOM_START_LABEL, DEFAULT_START_MS } from './adapter'
import type { RouteEstimate } from './estimate'

/** Earliest pickable start: Curiosity's landing (mission sol 0). */
export const MIN_START_MS = Date.parse(CLOCK.mslLandingUtc)
/** Latest: the end of the leap-second table the Mars24 port trusts. */
export const MAX_START_MS = LEAP_VALID_UNTIL_MS - 24 * 3600 * 1000

export const START_TEXT = {
  title: 'EVA start',
  utc: 'Earth (UTC)',
  sol: 'Mars sol',
  lmst: 'LMST',
  local: 'Local time at Gale',
  localValue: 'Sol {sol}, {lmst} LMST',
  season: 'Season',
  seasonValue: 'Ls {ls}°, MY {my}',
  seasonWhy: 'Areocentric solar longitude (season) and Mars year',
  sun: 'Sun at start',
  sunValue: '{el}° up, az {az}°',
  sunWhy: "Sun's centre at the pad ({lat}°, {lon}°E), no refraction (Mars24 D-5/D-6)",
  sunset: 'Sunset',
  sunsetWhy: 'Flat horizon at {deg}° (config clock.sun_horizon_elevation_deg)',
  daylight: 'Daylight left',
  daylightValue: '{min} min',
  daylightWhy: 'Minutes from EVA start until the sun sets on a flat horizon: the margin’s daylight term',
  sunDown: 'sun is down',
  sunDownNote: 'The sun is below the horizon at this start: the daylight margin is negative from the first minute.',
  isDefault: 'Default: {lmst} LMST on the sol of {date} (clock.json, D31).',
  moved: 'Changed from the default {lmst} LMST, sol of {date}.',
  reset: 'Reset',
  custom: CUSTOM_START_LABEL,
}

/** "YYYY-MM-DDTHH:MM" in UTC, for <input type="datetime-local"> used as a UTC field. */
const toInput = (ms: number) => new Date(Math.round(ms / 60000) * 60000).toISOString().slice(0, 16)
const fromInput = (v: string) => Date.parse(`${v}:00Z`)
const hm = (h: number) => formatHms(h).slice(0, 5)
const utcHm = (ms: number) => new Date(ms).toISOString().slice(11, 16)
export const clampStart = (ms: number) => Math.min(MAX_START_MS, Math.max(MIN_START_MS, ms))

export interface StartCardProps {
  /** the start instant shown (the default when not moved) */
  startMs: number
  custom: boolean
  clock: EvaClock
  /** null = back to the default */
  onChange: (ms: number | null) => void
  sunSite: { lat: number; lon: number }
}

/** Pure view (tests render it with a clock). */
export function StartCard({ startMs, custom, clock, onChange, sunSite }: StartCardProps) {
  const setSolLmst = (sol: number, lmstHours: number) => {
    if (!Number.isInteger(sol) || sol < 0 || !Number.isFinite(lmstHours)) return
    onChange(clampStart(utcAtSolLmst(sol, lmstHours, CLOCK.galeLonEastDeg)))
  }
  const sunDown = clock.tDarkMin === null
  const sunsetLmst = clock.sunset !== null ? lmstH(clock.sunset, CLOCK.galeLonEastDeg) : null
  const def = { lmst: formatHms(CLOCK.evaStartLmstH), date: CLOCK.evaSolRefUtc.slice(0, 10) }
  return (
    <section class={cx('hl-route__start', custom && 'is-custom')} data-eva-start={custom ? 'custom' : 'default'} aria-label={START_TEXT.title}>
      <p class="hl-route__est-head">
        <span class="hl-route__ghost-title">{START_TEXT.title}</span>{' '}
        {custom ? (
          <span class="hl-tag hl-tag--estimate" data-start-custom>
            {START_TEXT.custom}
          </span>
        ) : null}
      </p>
      <div class="hl-route__start-grid">
        <label>
          <span>{START_TEXT.utc}</span>
          <input
            type="datetime-local"
            data-start="utc"
            value={toInput(startMs)}
            min={toInput(MIN_START_MS)}
            max={toInput(MAX_START_MS)}
            onChange={(e) => {
              const v = fromInput((e.target as HTMLInputElement).value)
              if (Number.isFinite(v)) onChange(clampStart(v))
            }}
          />
        </label>
        <label>
          <span>{START_TEXT.sol}</span>
          <input type="number" data-start="sol" min={0} step={1} value={clock.mslSol} onChange={(e) => setSolLmst(parseInt((e.target as HTMLInputElement).value, 10), clock.lmstH)} />
        </label>
        <label>
          <span>{START_TEXT.lmst}</span>
          <input
            type="time"
            data-start="lmst"
            value={hm(clock.lmstH)}
            onChange={(e) => {
              const [h, m] = (e.target as HTMLInputElement).value.split(':').map(Number)
              setSolLmst(clock.mslSol, h + m / 60)
            }}
          />
        </label>
      </div>
      <dl class="hl-route__start-rows num">
        <div>
          <dt>{START_TEXT.local}</dt>
          <dd>{fill(START_TEXT.localValue, { sol: clock.mslSol, lmst: clock.lmst })}</dd>
        </div>
        <div title={START_TEXT.seasonWhy}>
          <dt>{START_TEXT.season}</dt>
          <dd>{fill(START_TEXT.seasonValue, { ls: clock.lsDeg.toFixed(1), my: clock.marsYear })}</dd>
        </div>
        <div title={fill(START_TEXT.sunWhy, { lat: sunSite.lat.toFixed(5), lon: sunSite.lon.toFixed(5) })}>
          <dt>{START_TEXT.sun}</dt>
          <dd class={cx(sunDown && 'is-bad')}>{fill(START_TEXT.sunValue, { el: clock.sun.elevationDeg.toFixed(1), az: clock.sun.azimuthDeg.toFixed(0) })}</dd>
        </div>
        <div title={fill(START_TEXT.sunsetWhy, { deg: CLOCK.sunHorizonDeg })}>
          <dt>{START_TEXT.sunset}</dt>
          <dd>{clock.sunset !== null ? `${utcHm(clock.sunset)} UTC${sunsetLmst !== null ? ` · ${hm(sunsetLmst)} LMST` : ''}` : '–'}</dd>
        </div>
        <div title={START_TEXT.daylightWhy}>
          <dt>{START_TEXT.daylight}</dt>
          <dd class={cx(sunDown && 'is-bad')} data-start-daylight>
            {sunDown ? START_TEXT.sunDown : fill(START_TEXT.daylightValue, { min: clock.tDarkMin!.toFixed(1) })}
          </dd>
        </div>
      </dl>
      {sunDown ? (
        <p class="hl-route__note is-bad" role="alert">
          {START_TEXT.sunDownNote}
        </p>
      ) : null}
      <div class="hl-route__start-foot">
        <span class="hl-route__note">{fill(custom ? START_TEXT.moved : START_TEXT.isDefault, def)}</span>
        {custom ? (
          <button type="button" class="hl-route__start-reset" data-start-reset onClick={() => onChange(null)}>
            {START_TEXT.reset}
          </button>
        ) : null}
      </div>
    </section>
  )
}

/** The card bound to the estimate: shown once the pad's browser data is loaded (the sun needs the pad). */
export function StartBox({ est }: { est: RouteEstimate }) {
  const start = useSignalValue(est.start)
  void useSignalValue(est.state) // re-render when the data arrives
  const clock = est.clockAt(start)
  if (!clock) return null
  const sunSite = est.sunSite()
  if (!sunSite) return null
  return <StartCard startMs={start ?? DEFAULT_START_MS} custom={start !== null} clock={clock} onChange={est.setStart} sunSite={sunSite} />
}
