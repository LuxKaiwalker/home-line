// PORT U3: the Route panel's settings section: EVA start (port of mission/StartTime.tsx), "Include
// storm in the margin" and the reachable-area boundary (port of the Mission tab's picker). Every
// control writes the planning store (one undo step each: setStartUtc, setStorm, setBoundary) and
// reads it back, so undo, links and the core's recompute see the same values. Nothing here imports
// mission/ (deleted in wave 2) or edit/route/** (§7b): the Mars clock is a local copy (marstime.ts).
// Mounted by U1's registerRoutePanelSection('settings', RouteSettings) via register() below.
import type { ComponentType } from 'preact'
import { useEffect, useId, useMemo, useState } from 'preact/hooks'
import { listPads, padLoadState, peekPadEnv, loadPadEnv, type PadInfo } from '../../../pads'
import { OFFICIAL_PAD_ID, planning as appPlanning, usePlanning, type PlanningStore } from '../../../state/planning'
import { useSignalValue } from '../../../state/signal'
import { Select, Toggle } from '../../components'
import { copyFrom } from '../../copy'
import { boundaryFromValue, boundaryOptions, boundaryValue, type BoundaryOption } from './boundary'
import copy from './copy.U3.json'
import { CLOCK, evaClock, formatHms, lmstH, mslSol, type EvaClock } from './marstime'
import { DEFAULT_START_MS, fromUtcInput, hoursOf, isDefaultStart, MAX_START_MS, MIN_START_MS, startMsOf, startUtcFor, startUtcForSolLmst, toUtcInput } from './startTime'
import './settings.css'

const tr = copyFrom(copy)

/** Where the sun position comes from (Mars24 algorithm steps), for the tooltip. */
const SUN_REF = 'Mars24 D-5/D-6'
/** The replayed storm (D39: the RAD series of 20 May 2024, rad.json storm_2024; label wording D143). */
export const STORM_REPLAY_DATE = '20 May 2024'
const hm = (h: number) => formatHms(h).slice(0, 5)
const utcHm = (ms: number) => new Date(ms).toISOString().slice(11, 16)

export interface SettingsProps {
  /** the planning store (tests pass their own; default = the app's) */
  store?: PlanningStore
}

/** Sun site (D21: the pad the fields are computed for): the active pad, else the official one; null until pads are listed. */
export function sunSiteFor(padId: string, pads: readonly PadInfo[]): { lat: number; lon: number } | null {
  const p = pads.find((x) => x.id === padId) ?? pads.find((x) => x.id === OFFICIAL_PAD_ID || x.official)
  return p ? { lat: p.lat, lon: p.lon } : null
}

// ---- EVA start ------------------------------------------------------------------------------------

export function StartTimeSettings({ store = appPlanning }: SettingsProps) {
  const startUtc = usePlanning((s) => s.route.startUtc, store)
  const padId = usePlanning((s) => s.padId, store)
  useSignalValue(padLoadState()) // re-read the pad list when pads load
  const site = sunSiteFor(padId, listPads())
  const startMs = startMsOf(startUtc)
  const clock: EvaClock | null = useMemo(() => (site ? evaClock(startMs, site) : null), [startMs, site?.lat, site?.lon])
  const lmstNow = lmstH(startMs, CLOCK.galeLonEastDeg)
  const sol = mslSol(startMs, CLOCK.galeLonEastDeg)
  const isDefault = isDefaultStart(startMs)
  const set = (iso: string | null | undefined) => void (iso !== undefined && store.setStartUtc(iso))
  const ids = { earth: useId(), sol: useId(), lmst: useId() }
  const sunDown = clock !== null && clock.tDarkMin === null
  const sunsetLmst = clock?.sunset != null ? lmstH(clock.sunset, CLOCK.galeLonEastDeg) : null

  return (
    <div class="rp-start" data-testid="rp-start">
      <h4 class="rp-set-title">{tr('start.title')}</h4>
      <div class="rp-start-grid">
        <label for={ids.earth}>
          <span>{tr('start.earth')}</span>
          <input
            id={ids.earth}
            type="datetime-local"
            value={toUtcInput(startMs)}
            min={toUtcInput(MIN_START_MS)}
            max={toUtcInput(MAX_START_MS)}
            onChange={(e) => {
              const v = fromUtcInput((e.target as HTMLInputElement).value)
              if (Number.isFinite(v)) set(startUtcFor(v))
            }}
          />
        </label>
        <label for={ids.sol}>
          <span>{tr('start.sol')}</span>
          <input id={ids.sol} type="number" min={0} step={1} value={sol} onChange={(e) => set(startUtcForSolLmst(Number((e.target as HTMLInputElement).value), lmstNow))} />
        </label>
        <label for={ids.lmst}>
          <span>{tr('start.lmst')}</span>
          <input id={ids.lmst} type="time" value={hm(lmstNow)} onChange={(e) => set(startUtcForSolLmst(sol, hoursOf((e.target as HTMLInputElement).value)))} />
        </label>
      </div>
      <div class="rp-est">
        <Row k={tr('start.localTime')} v={tr('start.localTimeValue', { sol, lmst: formatHms(lmstNow) })} />
        <Row k={tr('start.utc')} v={tr('start.utcValue', { utc: new Date(Math.round(startMs / 1000) * 1000).toISOString().slice(0, 19).replace('T', ' ') })} />
        {clock && (
          <>
            <Row k={tr('start.season')} title={tr('start.seasonTitle')} v={tr('start.seasonValue', { ls: clock.lsDeg.toFixed(1), year: clock.marsYear })} />
            <Row
              k={tr('start.sun')}
              title={tr('start.sunTitle', { site: tr('start.sunSite', { lat: site!.lat.toFixed(5), lon: site!.lon.toFixed(5) }), ref: SUN_REF })}
              v={tr('start.sunValue', { elevation: clock.sun.elevationDeg.toFixed(1), azimuth: clock.sun.azimuthDeg.toFixed(0) })}
              bad={sunDown}
            />
            <Row
              k={tr('start.sunset')}
              title={tr('start.sunsetTitle', { deg: CLOCK.sunHorizonDeg })}
              v={clock.sunset !== null ? (sunsetLmst !== null ? tr('start.sunsetLmst', { utc: utcHm(clock.sunset), lmst: hm(sunsetLmst) }) : tr('start.sunsetUtc', { utc: utcHm(clock.sunset) })) : '–'}
            />
            <Row k={tr('start.daylight')} title={tr('start.daylightTitle')} v={sunDown ? tr('start.sunDown') : tr('start.daylightValue', { min: clock.tDarkMin!.toFixed(1) })} bad={sunDown} />
          </>
        )}
      </div>
      {sunDown && <p class="rp-notice">{tr('start.sunDownNotice')}</p>}
      <div class="rp-start-foot">
        <span class="rp-muted">{tr(isDefault ? 'start.isDefault' : 'start.changed', { lmst: formatHms(CLOCK.evaStartLmstH), date: CLOCK.evaSolRefUtc.slice(0, 10) })}</span>
        {!isDefault && <b class="rp-custom-start">{tr('start.custom')}</b>}
        {!isDefault && (
          <button type="button" class="rp-reset" onClick={() => store.setStartUtc(null)}>
            {tr('start.reset')}
          </button>
        )}
      </div>
    </div>
  )
}

function Row({ k, v, title, bad }: { k: string; v: string; title?: string; bad?: boolean }) {
  return (
    <div class="rp-row" title={title}>
      <span>{k}</span>
      <b class={bad ? 'rp-bad' : undefined}>{v}</b>
    </div>
  )
}

// ---- storm ----------------------------------------------------------------------------------------

export function StormSettings({ store = appPlanning }: SettingsProps) {
  const storm = usePlanning((s) => s.route.storm, store)
  return (
    <div class="rp-storm">
      <Toggle label={tr('storm', { date: STORM_REPLAY_DATE })} checked={storm} onChange={(on) => void store.setStorm(on)} />
      <p class="rp-hint">{tr(storm ? 'stormOn' : 'stormOff')}</p>
    </div>
  )
}

// ---- boundary -------------------------------------------------------------------------------------

/** The active pad's boundary options from its plan products; [] while loading or when the pad service has none. */
export function useBoundaryOptions(padId: string): BoundaryOption[] {
  const [opts, setOpts] = useState<{ padId: string; opts: BoundaryOption[] } | null>(null)
  useEffect(() => {
    let live = true
    const env = peekPadEnv(padId)
    const envP = env ? Promise.resolve(env) : loadPadEnv(padId)
    envP
      .then((e) => e.planProducts())
      .then((p) => live && setOpts({ padId, opts: boundaryOptions(p.bands, p.edges) }))
      .catch(() => live && setOpts({ padId, opts: [] }))
    return () => void (live = false)
  }, [padId])
  return opts && opts.padId === padId ? opts.opts : []
}

export function BoundarySettings({ store = appPlanning, options }: SettingsProps & { options?: BoundaryOption[] }) {
  const padId = usePlanning((s) => s.padId, store)
  const boundary = usePlanning((s) => s.route.boundary, store)
  const loaded = useBoundaryOptions(padId)
  const opts = options ?? loaded
  // Only 'none' (or nothing) in the data: no selector at all.
  if (opts.length <= 1) return null
  return (
    <div class="rp-boundary">
      <Select label={tr('boundary.selectLabel')} options={opts.map((o) => ({ value: o.id, label: o.label }))} value={boundaryValue(opts, boundary)} onChange={(v) => void store.setBoundary(boundaryFromValue(v))} />
      <p class="rp-hint">{tr('boundary.caption')}</p>
    </div>
  )
}

// ---- section --------------------------------------------------------------------------------------

/** The whole settings section of the Route panel. */
export function RouteSettings({ store = appPlanning }: SettingsProps) {
  return (
    <section class="rp-settings" aria-label={tr('title')}>
      <StartTimeSettings store={store} />
      <StormSettings store={store} />
      <BoundarySettings store={store} />
    </section>
  )
}

/** U1's registerRoutePanelSection (passed in, so this folder does not depend on U1's module). */
export type RegisterSection = (name: 'settings', component: ComponentType) => (() => void) | void

/** Wire the section into the Route panel: `register(registerRoutePanelSection)`. */
export function register(registerSection: RegisterSection): (() => void) | void {
  return registerSection('settings', RouteSettings as ComponentType)
}

export { DEFAULT_START_MS }
