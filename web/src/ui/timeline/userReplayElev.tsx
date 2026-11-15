// PORT F15: elevation in the user-route replay (user 23:30: "the main branch solves it"). Main's
// Mission Planer timeline dock (origin/main web/src/mission/PlanDock.tsx) has a Margin / Elevation
// switch and the height along the route; this is the same for the user's replay (state/userReplay.ts):
// the height along the core's leg paths on the replay clock, the line coloured by the along-route grade
// in the Slope layer's classes (slopeRuns), and the current position marker following the replay clock.
// Heights: fp3d/far.f32.gz, loaded lazily on the first user replay (elevationData.ts). Derived, so
// every number is labelled "Estimate". The official replay is unchanged.
import { useEffect, useMemo, useState } from 'preact/hooks'
import { stopLabels, type PlanningStop } from '../../state/planning'
import { signal, useSignalValue } from '../../state/signal'
import type { UserReplay } from '../../state/userReplay'
import { areaPath, linear, linePath, pct, stepTicks, type Pt } from '../charts'
import { copyFrom } from '../copy'
import '../../map/overlays/slope/slope.css'
import { slopeColorVar } from '../../map/overlays/slope/classes'
import own from './copy.F15.json'
import { heightAtT, replayElevation, SLOPE_CLASSES, slopeRuns, type ElevProfile } from './elevation'
import { loadHeightSampler, type HeightSampler } from './elevationData'
import { fmtEva } from './model'
import './userReplayElev.css'

export const tr = copyFrom(own)

const W = 1000
const H = 100
const AXIS_STEP_MIN = 30

/** undefined = not asked yet, 'loading', null = no heights (files missing) */
const sampler = signal<HeightSampler | null | 'loading' | undefined>(undefined)
let source: () => Promise<HeightSampler | null> = loadHeightSampler

/** Tests: where the heights come from (and forget the loaded ones). */
export function setHeightSource(fn: () => Promise<HeightSampler | null>): void {
  source = fn
  sampler.value = undefined
}

function ensureSampler(): void {
  if (sampler.peek() !== undefined) return
  sampler.value = 'loading'
  void source().then((s) => {
    sampler.value = s
  })
}

const profiles = new WeakMap<UserReplay, ElevProfile | null>()

/** The elevation profile of the loaded user replay: 'loading', the profile, or null (no height known). */
export function useReplayElevation(u: UserReplay | null): ElevProfile | null | 'loading' {
  const s = useSignalValue(sampler)
  useEffect(() => {
    if (u) ensureSampler()
  }, [u])
  if (!u || s === undefined || s === 'loading') return 'loading'
  if (s === null) return null
  if (!profiles.has(u)) profiles.set(u, replayElevation(u, s.heightAt))
  return profiles.get(u) ?? null
}

const fmtZ = (z: number) => `${Math.round(z).toLocaleString('en-US')} m`

/** The height at the replay minute, "Estimate"-labelled (an <li> for the readout's number list). */
export function ReplayHeight({ e, tNow }: { e: ElevProfile | null | 'loading'; tNow: number }) {
  const z = e && e !== 'loading' ? heightAtT(e, tNow) : null
  return (
    <li data-estimate data-replay-height>
      <span class="plan-replay__tag">{tr('estimate')}</span> {z === null ? tr('heightUnknown') : tr('height', { v: Math.round(z).toLocaleString('en-US') })}
    </li>
  )
}

export type ReplayView = 'margin' | 'elevation'

/** Main's Margin / Elevation switch. */
export function ReplayViewTabs({ view, setView }: { view: ReplayView; setView: (v: ReplayView) => void }) {
  return (
    <div class="plan-replay__tabs" role="tablist" aria-label={tr('viewLabel')}>
      {(['margin', 'elevation'] as const).map((v) => (
        <button key={v} type="button" role="tab" aria-selected={view === v} class="plan-replay__chip" onClick={() => setView(v)}>
          {tr(v)}
        </button>
      ))}
    </div>
  )
}

const LEGEND_KEY = { padFlat: 'padFlat', walkable: 'walkable', beyondTested: 'beyondTested', nogoNominal: 'nogoNominal', nogoAlways: 'nogoAlways' } as const

function legendLabel(i: number): string {
  const c = SLOPE_CLASSES[i]
  const v = c.id === 'nogoAlways' ? c.minDeg : c.maxDeg
  return tr(LEGEND_KEY[c.id], { v: String(v) })
}

/** The Elevation view: main's ElevStrip on the replay's axis, plus the replay-clock marker. */
export function ReplayElevation({ u, e, tNow, stops, resM }: { u: UserReplay; e: ElevProfile | null | 'loading'; tNow: number; stops: readonly PlanningStop[]; resM?: number }) {
  if (e === 'loading') return <p class="hl-tl__status">{tr('heightLoading')}</p>
  if (!e) return <p class="hl-tl__status" data-no-height>{tr('noHeight')}</p>
  return <ElevStrip u={u} e={e} tNow={tNow} stops={stops} resM={resM} />
}

function ElevStrip({ u, e, tNow, stops, resM }: { u: UserReplay; e: ElevProfile; tNow: number; stops: readonly PlanningStop[]; resM?: number }) {
  const tMax = Math.max(u.totalMin, e.tEnd, 1e-6)
  const pad = Math.max(1, (e.zMax - e.zMin) * 0.08)
  const z0 = e.zMin - pad
  const z1 = e.zMax + pad
  const x = linear([0, tMax], [0, W])
  const y = linear([z0, z1], [H, 0])
  const P = (v: number) => pct(Math.min(Math.max(v, 0), tMax), 0, tMax)
  const all: Pt[] = useMemo(() => e.points.map((p) => [p.t, p.z]), [e])
  const runs = useMemo(() => slopeRuns(e.points), [e])
  const used = new Set(runs.filter((r) => r.cls >= 0).map((r) => r.cls))
  const labels = stopLabels(stops as PlanningStop[])
  const name = (id: string | null) => {
    const i = id === null ? -1 : stops.findIndex((s) => s.id === id)
    return i >= 0 ? labels[i] : ''
  }
  const dwells = u.segments.filter((s) => s.kind === 'dwell')
  const arrivals = u.segments.filter((s) => s.kind === 'walk' && s.stopId !== null)
  const tC = Math.min(Math.max(tNow, 0), u.totalMin)
  const zC = heightAtT(e, tC)
  return (
    <div class="hl-tl plan-elev" data-elev-strip>
      <div class="hl-tl__track plan-elev__track" role="img" aria-label={tr('aria', { lo: fmtZ(e.zMin), hi: fmtZ(e.zMax) })}>
        <div class="hl-tl__labels" aria-hidden="true">
          {arrivals.map((s, k) => (
            <span key={`s${k}`} class="hl-tl__dwelllabel" style={{ left: `${P(s.t1)}%` }}>
              {name(s.stopId)}
            </span>
          ))}
        </div>
        <div class="hl-tl__plot">
          {dwells.map((d, k) => (
            <div key={`d${k}`} class="hl-tl__dwell" style={{ left: `${P(d.t0)}%`, width: `${P(d.t1) - P(d.t0)}%` }} title={tr('stopAt', { name: name(d.stopId), t0: fmtEva(d.t0), t1: fmtEva(d.t1) })} />
          ))}
          <svg class="hl-tl__chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path class="plan-elev__area" d={areaPath(all, x, y, z0)} />
            {runs.map((r, k) => (
              <path
                key={`r${k}`}
                class="plan-elev__line"
                data-slope-class={r.cls}
                style={{ stroke: r.cls < 0 ? undefined : slopeColorVar(SLOPE_CLASSES[r.cls].id) }}
                d={linePath(r.pts.map((p) => [p.t, p.z] as Pt), x, y)}
                vector-effect="non-scaling-stroke"
              />
            ))}
          </svg>
          <span class="plan-elev__cursor" data-elev-cursor style={{ left: `${P(tC)}%` }} />
          <span class="plan-elev__dot" style={{ left: `${P(tC)}%`, top: `${(y(zC) / H) * 100}%` }} />
          <span class="plan-elev__ylab plan-elev__ylab--top">{fmtZ(e.zMax)}</span>
          <span class="plan-elev__ylab plan-elev__ylab--bot">{fmtZ(e.zMin)}</span>
        </div>
        <div class="hl-tl__axis" aria-hidden="true">
          {stepTicks(0, tMax, AXIS_STEP_MIN).map((v) => (
            <span key={`x${v}`} class="hl-tl__tick" style={{ left: `${P(v)}%` }}>
              {v % 60 === 0 ? fmtEva(v) : ''}
            </span>
          ))}
        </div>
      </div>
      <div class="hl-tl__side plan-elev__side">
        <ul class="plan-elev__legend" title={tr('legendTitle', { res: String(resM ?? 8) })}>
          {SLOPE_CLASSES.map((c, i) =>
            used.has(i) ? (
              <li key={c.id}>
                <span class="plan-elev__swatch" style={{ background: slopeColorVar(c.id) }} />
                {legendLabel(i)}
              </li>
            ) : null,
          )}
        </ul>
      </div>
    </div>
  )
}

/** The switch + view for the readout; `margin` renders the given children (the core's numbers). */
export function useReplayView(): [ReplayView, (v: ReplayView) => void] {
  return useState<ReplayView>('margin')
}

/** Resolution of the loaded heights (m), for the legend. */
export function useHeightRes(): number | undefined {
  const s = useSignalValue(sampler)
  return s && s !== 'loading' ? s.resM : undefined
}
