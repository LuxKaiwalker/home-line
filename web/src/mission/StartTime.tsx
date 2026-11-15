// "EVA start" card on the Mission Planer: pick the start as an Earth date/time (UTC) or as a Mars
// sol + local mean solar time; both set one instant. Everything that depends on it is recomputed
// in the browser with the Mars24 port (marstime.ts): sol, LMST/LTST, Ls, the sun at the pad, sunset
// and the minutes to darkness that feed the margin's daylight term and the mission export.
// The default is WS4's simulated EVA (config clock.eva_start_lmst_h on the sol of eva_sol_ref_utc,
// D31): the same instant as clock.json.
import { CLOCK, formatHms, LEAP_VALID_UNTIL_MS, lmstH, utcAtLmst, utcAtSolLmst, type EvaClock } from './marstime'

/** Default start: 09:00 LMST (D31) on the local sol of eva_sol_ref_utc, exactly as WS4 computes it. */
export const DEFAULT_START_MS = utcAtLmst(Date.parse(CLOCK.evaSolRefUtc), CLOCK.evaStartLmstH, CLOCK.galeLonEastDeg)
/** Earliest pickable start: Curiosity's landing (mission sol 0). */
export const MIN_START_MS = Date.parse(CLOCK.mslLandingUtc)
/** Latest: the end of the leap-second table the Mars24 port trusts. */
export const MAX_START_MS = LEAP_VALID_UNTIL_MS - 24 * 3600 * 1000

const START_KEY = 'homeline.mission.start'

export function loadStart(): number {
  try {
    const v = Number(localStorage.getItem(START_KEY))
    return Number.isFinite(v) && v >= MIN_START_MS && v <= MAX_START_MS && v !== 0 ? v : DEFAULT_START_MS
  } catch {
    return DEFAULT_START_MS
  }
}
export function saveStart(ms: number): void {
  try {
    if (Math.abs(ms - DEFAULT_START_MS) < 1000) localStorage.removeItem(START_KEY)
    else localStorage.setItem(START_KEY, String(ms))
  } catch {
    /* storage blocked: the start stays for this visit */
  }
}

/** "YYYY-MM-DDTHH:MM" in UTC, for <input type="datetime-local"> used as a UTC field. */
const toInput = (ms: number) => new Date(Math.round(ms / 60000) * 60000).toISOString().slice(0, 16)
const fromInput = (v: string) => Date.parse(`${v}:00Z`)
const hm = (h: number) => formatHms(h).slice(0, 5)
const utcHm = (ms: number) => new Date(ms).toISOString().slice(11, 16)
const clamp = (ms: number) => Math.min(MAX_START_MS, Math.max(MIN_START_MS, ms))

/** Minutes to darkness for the margin: 0 when the sun is already down at the start. */
export function daylightFor(c: EvaClock): number {
  return c.tDarkMin ?? 0
}

export function StartTime({ startMs, clock, onChange, sunSiteLabel }: { startMs: number; clock: EvaClock; onChange: (ms: number) => void; sunSiteLabel: string }) {
  const isDefault = Math.abs(startMs - DEFAULT_START_MS) < 1000
  const setSolLmst = (sol: number, lmstHours: number) => {
    if (!Number.isInteger(sol) || sol < 0 || !Number.isFinite(lmstHours)) return
    onChange(clamp(utcAtSolLmst(sol, lmstHours, CLOCK.galeLonEastDeg)))
  }
  const sunDown = clock.tDarkMin === null
  const sunsetLmst = clock.sunset !== null ? lmstH(clock.sunset, CLOCK.galeLonEastDeg) : null
  return (
    <div class="mp-start">
      <div class="mp-start-grid">
        <label>
          <span>Earth (UTC)</span>
          <input
            type="datetime-local"
            value={toInput(startMs)}
            min={toInput(MIN_START_MS)}
            max={toInput(MAX_START_MS)}
            onChange={(e) => {
              const v = fromInput((e.target as HTMLInputElement).value)
              if (Number.isFinite(v)) onChange(clamp(v))
            }}
          />
        </label>
        <label>
          <span>Mars sol</span>
          <input type="number" min={0} step={1} value={clock.mslSol} onChange={(e) => setSolLmst(parseInt((e.target as HTMLInputElement).value, 10), clock.lmstH)} />
        </label>
        <label>
          <span>LMST</span>
          <input
            type="time"
            value={hm(clock.lmstH)}
            onChange={(e) => {
              const [h, m] = (e.target as HTMLInputElement).value.split(':').map(Number)
              setSolLmst(clock.mslSol, h + m / 60)
            }}
          />
        </label>
      </div>
      <div class="mp-est">
        <div class="mp-row">
          <span>Local time at Gale</span>
          <b>
            Sol {clock.mslSol}, {clock.lmst} LMST
          </b>
        </div>
        <div class="mp-row" title="Areocentric solar longitude (season) and Mars year">
          <span>Season</span>
          <b>
            Ls {clock.lsDeg.toFixed(1)}°, MY {clock.marsYear}
          </b>
        </div>
        <div class="mp-row" title={`Sun's centre at ${sunSiteLabel}, no refraction (Mars24 D-5/D-6)`}>
          <span>Sun at start</span>
          <b class={sunDown ? 'mp-bad' : ''}>
            {clock.sun.elevationDeg.toFixed(1)}° up, az {clock.sun.azimuthDeg.toFixed(0)}°
          </b>
        </div>
        <div class="mp-row" title={`Flat horizon at ${CLOCK.sunHorizonDeg}° (config clock.sun_horizon_elevation_deg)`}>
          <span>Sunset</span>
          <b>{clock.sunset !== null ? `${utcHm(clock.sunset)} UTC${sunsetLmst !== null ? ` · ${hm(sunsetLmst)} LMST` : ''}` : '–'}</b>
        </div>
        <div class="mp-row" title="Minutes from EVA start until the sun sets on a flat horizon: the margin's daylight term">
          <span>Daylight left</span>
          <b class={sunDown ? 'mp-bad' : ''}>{sunDown ? 'sun is down' : `${clock.tDarkMin!.toFixed(1)} min`}</b>
        </div>
      </div>
      {sunDown && <p class="mp-notice">The sun is below the horizon at this start: the daylight margin is negative from the first minute.</p>}
      <div class="mp-start-foot">
        <span class="muted">{isDefault ? `Default: ${formatHms(CLOCK.evaStartLmstH)} LMST (D31).` : `Changed from the default ${formatHms(CLOCK.evaStartLmstH)} LMST, sol of ${CLOCK.evaSolRefUtc.slice(0, 10)}.`}</span>
        {!isDefault && (
          <button type="button" class="mp-clear" onClick={() => onChange(DEFAULT_START_MS)}>
            Reset
          </button>
        )}
      </div>
    </div>
  )
}
