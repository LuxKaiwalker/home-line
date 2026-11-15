// I4: the "EVA start" card at the top of the instant estimate (Edit-route drawer). Ported from
// origin/waypoint-routing d7d80e0 (N0CEO, Mission Planer) web/src/mission/StartTime.tsx, adapted to the
// design components and tokens: pick the start as an Earth date/time (UTC) or as a Mars sol + LMST; both
// set one instant. Sol, LMST/LTST, Ls, the sun at the pad, sunset and the minutes to darkness come from
// the Mars24 port (browser/marstime.ts); the minutes to darkness feed the estimate's daylight term and
// mission.json. Default = clock.json's instant (D31); a moved start is labelled CUSTOM_START_LABEL.
// Undo: the start is not part of the plan-edit store, so the card has a reset-to-default button.
import { useSignalValue } from '../../../state/signal'
import { Button } from '../../../ui/components/Button'
import { Icon } from '../../../ui/components/Icon'
import { fill } from '../text'
import { CLOCK, formatHms, lmstH, utcAtSolLmst } from '../browser/marstime'
import { CUSTOM_START_LABEL, MAX_START_MS, MIN_START_MS } from '../browser/start'
import type { RouteEstimate } from './estimate'
import './start.css'

export const START_TEXT = {
  title: 'EVA start',
  utc: 'Earth (UTC)',
  sol: 'Mars sol',
  lmst: 'LMST',
  local: 'Local time at Gale',
  localValue: 'Sol {sol}, {lmst} LMST',
  season: 'Season',
  seasonValue: 'Ls {ls}°, MY {my}',
  sun: 'Sun at start',
  sunValue: '{el}° up, az {az}°',
  sunset: 'Sunset',
  daylight: 'Daylight left',
  daylightValue: '{min} min',
  sunDown: 'sun is down',
  sunDownNote: 'The sun is below the horizon at this start: the daylight margin is negative from the first minute.',
  isDefault: 'Default: {lmst} LMST on the sol of {date} (D31), the validated scenario.',
  reset: 'Reset to default',
}

/** "YYYY-MM-DDTHH:MM" in UTC, for <input type="datetime-local"> used as a UTC field. */
const toInput = (ms: number) => new Date(Math.round(ms / 60000) * 60000).toISOString().slice(0, 16)
const fromInput = (v: string) => Date.parse(`${v}:00Z`)
const hm = (h: number) => formatHms(h).slice(0, 5)
const utcHm = (ms: number) => new Date(ms).toISOString().slice(11, 16)

export function StartCard({ est }: { est: RouteEstimate }) {
  const startMs = useSignalValue(est.start)
  const clock = est.clockAt(startMs)
  const custom = startMs !== null
  const setSolLmst = (sol: number, lmstHours: number) => {
    if (!Number.isInteger(sol) || sol < 0 || !Number.isFinite(lmstHours)) return
    est.setStart(utcAtSolLmst(sol, lmstHours, CLOCK.galeLonEastDeg))
  }
  const sunDown = clock.tDarkMin === null
  const sunsetLmst = clock.sunset !== null ? lmstH(clock.sunset, CLOCK.galeLonEastDeg) : null
  return (
    <section class="hl-route__start" data-eva-start={custom ? 'custom' : 'default'} aria-label={START_TEXT.title}>
      <p class="hl-route__start-head">
        <span class="hl-route__start-title">
          <Icon name="sun" /> {START_TEXT.title}
        </span>
        {custom ? (
          <span class="hl-tag hl-tag--estimate" data-custom-start>
            {CUSTOM_START_LABEL}
          </span>
        ) : null}
      </p>
      <div class="hl-route__start-grid">
        <label>
          <span>{START_TEXT.utc}</span>
          <input
            type="datetime-local"
            data-start-input="utc"
            value={toInput(clock.startMs)}
            min={toInput(MIN_START_MS)}
            max={toInput(MAX_START_MS)}
            onChange={(e) => {
              const v = fromInput((e.target as HTMLInputElement).value)
              if (Number.isFinite(v)) est.setStart(v)
            }}
          />
        </label>
        <label>
          <span>{START_TEXT.sol}</span>
          <input type="number" data-start-input="sol" min={0} step={1} value={clock.mslSol} onChange={(e) => setSolLmst(parseInt((e.target as HTMLInputElement).value, 10), clock.lmstH)} />
        </label>
        <label>
          <span>{START_TEXT.lmst}</span>
          <input
            type="time"
            data-start-input="lmst"
            value={hm(clock.lmstH)}
            onChange={(e) => {
              const [h, m] = (e.target as HTMLInputElement).value.split(':').map(Number)
              setSolLmst(clock.mslSol, h + m / 60)
            }}
          />
        </label>
      </div>
      <dl class="hl-route__start-rows num">
        <dt>{START_TEXT.local}</dt>
        <dd data-start="local">{fill(START_TEXT.localValue, { sol: clock.mslSol, lmst: clock.lmst })}</dd>
        <dt title="Areocentric solar longitude (season) and Mars year">{START_TEXT.season}</dt>
        <dd>{fill(START_TEXT.seasonValue, { ls: clock.lsDeg.toFixed(1), my: clock.marsYear })}</dd>
        <dt title="Sun's centre at the pad, no refraction (Mars24 D-5/D-6)">{START_TEXT.sun}</dt>
        <dd class={sunDown ? 'is-bad' : undefined}>{fill(START_TEXT.sunValue, { el: clock.sun.elevationDeg.toFixed(1), az: clock.sun.azimuthDeg.toFixed(0) })}</dd>
        <dt title={`Flat horizon at ${CLOCK.sunHorizonDeg}° (config clock.sun_horizon_elevation_deg)`}>{START_TEXT.sunset}</dt>
        <dd>{clock.sunset !== null ? `${utcHm(clock.sunset)} UTC${sunsetLmst !== null ? ` · ${hm(sunsetLmst)} LMST` : ''}` : '–'}</dd>
        <dt title="Minutes from EVA start until the sun sets on a flat horizon: the margin's daylight term">{START_TEXT.daylight}</dt>
        <dd class={sunDown ? 'is-bad' : undefined} data-start="daylight">
          {sunDown ? START_TEXT.sunDown : fill(START_TEXT.daylightValue, { min: clock.tDarkMin!.toFixed(1) })}
        </dd>
      </dl>
      {sunDown ? (
        <p class="hl-route__warn" role="status">
          {START_TEXT.sunDownNote}
        </p>
      ) : null}
      <div class="hl-route__start-foot">
        {custom ? (
          <Button variant="ghost" icon="undo-2" class="hl-route__start-reset" data-start-reset onClick={() => est.setStart(null)}>
            {START_TEXT.reset}
          </Button>
        ) : (
          <span class="hl-route__note">{fill(START_TEXT.isDefault, { lmst: formatHms(CLOCK.evaStartLmstH), date: CLOCK.evaSolRefUtc.slice(0, 10) })}</span>
        )}
      </div>
    </section>
  )
}
