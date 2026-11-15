// "EVA start" card on the Mission Planer: pick the start as an Earth date/time (UTC) or as a Mars
// sol + local mean solar time; both set one instant. Everything that depends on it is recomputed
// in the browser with the Mars24 port (marstime.ts): sol, LMST/LTST, Ls, the sun at the pad, sunset
// and the minutes to darkness that feed the margin's daylight term and the mission export.
// The default is WS4's simulated EVA (config clock.eva_start_lmst_h on the sol of eva_sol_ref_utc,
// D31): the same instant as clock.json.
// J1 (D132, waypoint orchestrator): I3's behaviour (#177, edit/route/browser/start.ts): the default is
// clock.json's instant and its data as is (t_dark from clock.json); a moved start is labelled
// CUSTOM_START_LABEL ("custom start · outside the validated scenario"); nothing persists (component state).
// The constants are the same as browser/start.ts's (parity.test.ts pins them); edit/route stays out of
// the static build (live-only, map.test.tsx / route.test.tsx), so they are not imported from there.
import { CUSTOM_START_LABEL } from './export'
import { CLOCK, formatHms, LEAP_VALID_UNTIL_MS, lmstH, utcAtLmst, utcAtSolLmst, type EvaClock } from './marstime'
import { t } from '../ui/copy'

/** Where the sun position comes from (Mars24 algorithm steps), for the tooltip. */
const SUN_REF = 'Mars24 D-5/D-6'

/** Default start: 09:00 LMST (D31) on the local sol of eva_sol_ref_utc, exactly as WS4 computes it (clock.json). */
export const DEFAULT_START_MS = utcAtLmst(Date.parse(CLOCK.evaSolRefUtc), CLOCK.evaStartLmstH, CLOCK.galeLonEastDeg)
/** A start within a second of the default is the default (clock.json rounds start_utc to the second). */
export const isDefaultStart = (ms: number | null): boolean => ms === null || Math.abs(ms - DEFAULT_START_MS) < 1000
/** Earliest pickable start: Curiosity's landing (mission sol 0). */
export const MIN_START_MS = Date.parse(CLOCK.mslLandingUtc)
/** Latest: the end of the leap-second table the Mars24 port trusts. */
export const MAX_START_MS = LEAP_VALID_UNTIL_MS - 24 * 3600 * 1000

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
  const isDefault = isDefaultStart(startMs)
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
          <span>{t('mission.start.earth')}</span>
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
          <span>{t('mission.start.sol')}</span>
          <input type="number" min={0} step={1} value={clock.mslSol} onChange={(e) => setSolLmst(parseInt((e.target as HTMLInputElement).value, 10), clock.lmstH)} />
        </label>
        <label>
          <span>{t('mission.start.lmst')}</span>
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
          <span>{t('mission.start.localTime')}</span>
          <b>{t('mission.start.localTimeValue', { sol: clock.mslSol, lmst: clock.lmst })}</b>
        </div>
        <div class="mp-row" title={t('mission.start.seasonTitle')}>
          <span>{t('mission.start.season')}</span>
          <b>{t('mission.start.seasonValue', { ls: clock.lsDeg.toFixed(1), year: clock.marsYear })}</b>
        </div>
        <div class="mp-row" title={t('mission.start.sunTitle', { site: sunSiteLabel, ref: SUN_REF })}>
          <span>{t('mission.start.sun')}</span>
          <b class={sunDown ? 'mp-bad' : ''}>
            {t('mission.start.sunValue', { elevation: clock.sun.elevationDeg.toFixed(1), azimuth: clock.sun.azimuthDeg.toFixed(0) })}
          </b>
        </div>
        <div class="mp-row" title={t('mission.start.sunsetTitle', { deg: CLOCK.sunHorizonDeg })}>
          <span>{t('mission.start.sunset')}</span>
          <b>
            {clock.sunset !== null
              ? sunsetLmst !== null
                ? t('mission.start.sunsetLmst', { utc: utcHm(clock.sunset), lmst: hm(sunsetLmst) })
                : t('mission.start.sunsetUtc', { utc: utcHm(clock.sunset) })
              : '–'}
          </b>
        </div>
        <div class="mp-row" title={t('mission.start.daylightTitle')}>
          <span>{t('mission.start.daylight')}</span>
          <b class={sunDown ? 'mp-bad' : ''}>{sunDown ? t('mission.start.sunDown') : `${clock.tDarkMin!.toFixed(1)} min`}</b>
        </div>
      </div>
      {sunDown && <p class="mp-notice">{t('mission.start.sunDownNotice')}</p>}
      <div class="mp-start-foot">
        <span class="muted">{t(isDefault ? 'mission.start.isDefault' : 'mission.start.changed', { lmst: formatHms(CLOCK.evaStartLmstH), date: CLOCK.evaSolRefUtc.slice(0, 10) })}</span>
        {!isDefault && <b class="mp-custom-start">{CUSTOM_START_LABEL}</b>}
        {!isDefault && (
          <button type="button" class="mp-clear" onClick={() => onChange(DEFAULT_START_MS)}>
            {t('mission.start.reset')}
          </button>
        )}
      </div>
    </div>
  )
}
