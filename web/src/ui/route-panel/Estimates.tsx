// PORT U1: the Estimates card. Numbers come only from the route core (§9 route results: total time,
// the four-term margin, O₂ per leg); nothing is recomputed here. Every number is labelled "Estimate"
// (browser-computed, no manifest entry), the fast heuristic says "Fast route · may not be the fastest",
// and the first leg that cannot be walked is called out by name. The pad's precomputed reach numbers
// (backed <Num>s, Reach.tsx) close the card.
import type { ComponentChildren } from 'preact'
import { CONFIG } from '../../config'
import { planning, selectPad, selectStops, stopLabels, usePlanning, type PlanStop, type PlanningStore } from '../../state/planning'
import { t } from '../copy'
import { useRouteResults, type LegResult, type RouteResults } from './results'

const fmt = (v: number | null, key: 'minutes' | 'litres'): string => (v === null || !Number.isFinite(v) ? t('route.panel.estimates.unknown') : t(`route.panel.estimates.${key}`, { v: v.toFixed(1) }))

/** Margin colour (DESIGN §3.1: green / orange / red = margin states); unknown stays neutral. */
export function marginTone(v: number | null): 'safe' | 'caution' | 'limit' | null {
  if (v === null || !Number.isFinite(v)) return null
  if (v < 0) return 'limit'
  return v < CONFIG.marginAmberMin ? 'caution' : 'safe'
}

/** O₂ over the legs as the core gives them: null unless every leg has a value. */
export function legsO2(legs: readonly LegResult[]): number | null {
  if (!legs.length || legs.some((l) => l.o2L === null)) return null
  return legs.reduce((s, l) => s + (l.o2L ?? 0), 0)
}

/** "pad" for the pad end of a leg, else the stop's label (name, station id, W1 …). */
export function legEnds(leg: LegResult, stops: readonly PlanStop[]): { from: string; to: string } {
  const labels = stopLabels(stops)
  const name = (id: string) => {
    const i = stops.findIndex((s) => s.id === id)
    return i >= 0 ? labels[i] : t('route.panel.estimates.pad')
  }
  return { from: name(leg.fromStopId), to: name(leg.toStopId) }
}

const reasonText = (r: string | undefined): string | null => {
  if (!r) return null
  return r === 'unreachable' || r === 'budget' || r === 'slope' ? t(`route.panel.estimates.reasons.${r}`) : r
}

/** The words for a margin tone, so the colour is never the only cue (PORT I4 a11y). */
export function marginToneText(tone: ReturnType<typeof marginTone>): string | null {
  if (tone === 'limit') return t('margin.limit')
  if (tone === 'caution') return t('margin.caution', { amber_min: CONFIG.marginAmberMin })
  return null
}

function Row({ k, v, tone, title }: { k: string; v: string; tone?: ReturnType<typeof marginTone>; title?: string }) {
  const toneText = marginToneText(tone ?? null)
  return (
    <div class={`hl-rp__row${tone ? ` hl-rp__row--${tone}` : ''}`} title={title}>
      <span>{k}</span>
      <b>
        {v}
        <span class="hl-rp__estlabel" title={t('route.panel.estimates.estimateTitle')}>
          {t('route.panel.estimates.estimate')}
        </span>
        {toneText && (
          <span class="hl-rp__tone" data-margin-tone={tone}>
            {toneText}
          </span>
        )}
      </b>
    </div>
  )
}

/** Status line for the current results (null = ready, nothing to say). */
function statusLine(r: RouteResults, stale: boolean, nLegs: number): ComponentChildren {
  if (r.status === 'error') return t('route.panel.estimates.error', { error: r.error ?? '' })
  if (r.status === 'idle') return t('route.panel.estimates.idle')
  if (stale || r.status === 'computing') return t('route.panel.estimates.computing')
  if (r.status === 'partial') return t('route.panel.estimates.partial', { done: r.legs.length, n: Math.max(nLegs, r.legs.length) })
  return null
}

export function EstimatesBody({ results: r, stops, padId }: { results: RouteResults; stops: readonly PlanStop[]; padId: string }) {
  // results for another pad are on their way out: say so instead of showing their numbers as this pad's
  const stale = r.status !== 'idle' && r.padId !== padId
  const shown = stale ? null : r
  const status = statusLine(r, stale, stops.length + 1)
  const bad = shown && shown.firstInfeasibleLeg !== null ? (shown.legs.find((l) => l.index === shown.firstInfeasibleLeg) ?? null) : null
  const ends = bad ? legEnds(bad, stops) : null
  const why = bad ? reasonText(bad.reason) : null
  return (
    <>
      {/* live regions stay mounted (an inserted region is often not announced); only their text changes */}
      <div role="status" data-live="route-status">
        {status && (
          <p class="hl-rp__notice" data-status={stale ? 'computing' : r.status}>
            {status}
          </p>
        )}
      </div>
      {shown?.fastRoute && (
        <p class="hl-rp__caption" data-fast-route>
          {t('route.panel.fast')}
        </p>
      )}
      <div role="alert" data-live="route-infeasible">
        {bad && ends && (
          <p class="hl-rp__notice hl-rp__notice--bad" data-infeasible-leg={bad.index}>
            {why ? t('route.panel.estimates.infeasible', { n: bad.index + 1, from: ends.from, to: ends.to, reason: why }) : t('route.panel.estimates.infeasibleBare', { n: bad.index + 1, from: ends.from, to: ends.to })}
          </p>
        )}
      </div>
      {/* PORT I1 (Q1): data-status / data-pad let the e2e wait for "ready" instead of sleeping */}
      <div class="hl-rp__est" data-estimates data-status={r.status} data-pad={r.padId}>
        <Row k={t('route.panel.estimates.total')} v={fmt(shown?.totalMinutes ?? null, 'minutes')} />
        <Row k={t('route.panel.estimates.margin')} v={fmt(shown?.marginMin ?? null, 'minutes')} tone={marginTone(shown?.marginMin ?? null)} title={t('route.panel.estimates.marginTitle')} />
        <Row k={t('route.panel.estimates.o2')} v={fmt(shown ? legsO2(shown.legs) : null, 'litres')} title={t('route.panel.estimates.o2Title')} />
      </div>
    </>
  )
}

/** The route part of the Estimates card, live on the planning store and the route results. */
export function RouteEstimates({ store = planning }: { store?: PlanningStore }) {
  const stops = usePlanning(selectStops, store)
  const padId = usePlanning(selectPad, store)
  const results = useRouteResults((r) => r)
  return <EstimatesBody results={results} stops={stops} padId={padId} />
}
