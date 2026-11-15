// PORT P3 (team lead 19:57): the slim one-line context bar in the top bar's Plan slot
// (#hl-headline-strip). It replaces the headline strip (views/planStrip.tsx HeadlineStrip, the big
// "23.0 % reachable" numbers): one line, no headline pop-up:
//   [pad] Official pad · Official plan · margin 41.21 min ○ · [scenario chip] [budget chip] [Plan a route]
//   [pad] Pad P2 · Your route · 4 stops · margin 41 min Estimate · Fast route · …
// The reach numbers moved to the bottom-drawer summary (DrawerSummary), the pad pop-up card (P2) and
// the Route panel's estimates card (U1). The scenario and budget chips stay the openers of the console's
// Scenario and Walkback-budget sections (the strip mount in views/planStrip.tsx claims them and names
// these openers for tools/values_snapshot.ts: aria-controls="hl-lay-scenario" / "hl-lay-budget").
import { createPortal } from 'preact'
import { useContext, useLayoutEffect, useRef } from 'preact/hooks'
import { Num } from '../../components/Num'
import { listPads, padLoadState } from '../../pads'
import type { PadInfo } from '../../pads/types'
import { selectPad, selectStops, usePlanning, type PlanningStore } from '../../state/planning'
import { signal, useSignalValue } from '../../state/signal'
import type { StripProps } from '../../views/planStrip'
import { registerPlanMount, SectionHost, SectionsCtx, type Sections } from '../../views/planSlots'
import { Icon, TrustChip } from '../components'
import { copyFrom } from '../copy'
import { layout, Popover, toggleContainer } from '../layout'
import { activePadId, officialMargin, padName, shownFor, stripPropsOf, type Shown } from './model'
import { useRouteResults, type RouteResults } from './routeResults'
import own from './copy.P3.json'
import './strip.css'

export const tp = copyFrom(own)

/** The top-bar host while the Plan layout is mounted (shell frame only; ?legacy=1 has none). */
const barHost = signal<HTMLElement | null>(null)
registerPlanMount('context-bar', (ctx) => {
  if (!ctx.el.strip) return () => {}
  barHost.value = ctx.el.strip
  return () => void (barHost.value = null)
})

/** The console's headline values, published by the bar for the drawer summary (same render pass). */
export const stripData = signal<StripProps | null>(null)

/** "Plan a route": opens the Route panel. Set by I1 (U1's opener); the button is hidden while unset. */
const planRouteAction = signal<(() => void) | null>(null)
export function setPlanRouteAction(fn: (() => void) | null): () => void {
  const prev = planRouteAction.peek()
  planRouteAction.value = fn
  return () => void (planRouteAction.value = prev)
}

const SEP = (
  <span class="hl-ctx__sep" aria-hidden="true">
    ·
  </span>
)

export interface ContextLineProps {
  strip: StripProps | null
  /** the active pad (null = official) and the pad index (labels) */
  padId: string | null
  pads: readonly PadInfo[]
  shown: Shown
  sections: Sections | null
  onPlanRoute: (() => void) | null
}

/** The bar's content (no portal; tests render it directly). */
export function ContextLine({ strip, padId, pads, shown, sections, onPlanRoute }: ContextLineProps) {
  const pad = padId === null ? tp('officialPad') : tp('pad', { pad: padName(padId, pads) })
  return (
    <div class="hl-ctx" role="group" aria-label={tp('label')}>
      <span class="hl-ctx__pad" title={tp('padTitle')}>
        <Icon name="pad" />
        <span class="hl-ctx__padname">{pad}</span>
      </span>
      {SEP}
      <span class="hl-ctx__shown">{shown.kind === 'official' ? <Official strip={strip} /> : <Mine s={shown} />}</span>
      {sections && strip && (
        <span class="hl-ctx__chips">
          <Chip id="scenario" icon="gauge" text={strip.scenarioText} label={tp('scenario')} sections={sections} />
          <Chip id="budget" icon="timer" text={tp('budgetValue', { budget: strip.budget })} label={tp('budget')} sections={sections} />
        </span>
      )}
      {onPlanRoute && shown.kind === 'official' && (
        <button type="button" class="hl-ctx__plan" onClick={onPlanRoute} aria-label={tp('planRoute')} title={tp('planRoute')}>
          <Icon name="plus" />
          <span class="hl-ctx__plantext">{tp('planRoute')}</span>
        </button>
      )}
    </div>
  )
}

function Official({ strip }: { strip: StripProps | null }) {
  const m = officialMargin(strip)
  return (
    <>
      <span class="hl-ctx__what">{tp('officialPlan')}</span>
      {m && (
        <>
          {SEP}
          <span class="hl-ctx__margin" title={`${tp('marginTitle')}: ${m.why}`}>
            <span class="hl-ctx__k">{tp('margin')}</span> <Num v={m.v} units="min" file={m.file} k={m.k} />
            <TrustChip kind="simulated" prov={{ key: m.k, file: m.file, value: m.v }} align="start" />
          </span>
        </>
      )}
    </>
  )
}

function Mine({ s }: { s: Extract<Shown, { kind: 'mine' }> }) {
  return (
    <>
      <span class="hl-ctx__what">{tp('yourRoute')}</span>
      {SEP}
      <span>{tp(s.stops === 1 ? 'stop' : 'stops', { n: s.stops })}</span>
      {SEP}
      {s.unreachable !== null ? (
        <span class="hl-ctx__bad">{s.unreachable === 'home' ? tp('unreachableHome') : tp('unreachable', { n: s.unreachable })}</span>
      ) : s.marginMin !== null ? (
        <span class="hl-ctx__margin">
          {tp('marginValue', { value: s.marginMin })}
          <span class="hl-ctx__est">{tp('estimate')}</span>
        </span>
      ) : (
        <span class="hl-ctx__muted">{tp('marginPending')}</span>
      )}
      {s.fast && (
        <>
          {SEP}
          <span class="hl-ctx__fast" title={tp('fastTitle')}>
            {tp('fast')}
          </span>
        </>
      )}
    </>
  )
}

/** A chip that opens one console section (Scenario, Walkback budget) beside it. */
function Chip({ id, icon, text, label, sections }: { id: 'scenario' | 'budget'; icon: 'gauge' | 'timer'; text: string; label: string; sections: Sections }) {
  const btn = useRef<HTMLButtonElement>(null)
  const open = !!useSignalValue(layout.open)[id]
  return (
    <span class="hl-ctx__choice">
      <button
        ref={btn}
        type="button"
        class={`hl-ctx__chip hl-ctx__chip--${id}`}
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={`hl-lay-${id}`}
        aria-haspopup="dialog"
        aria-label={`${label}: ${text}`}
        title={label}
        // the popover closes on a press outside it; this chip is its opener, so the press stays here
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => toggleContainer(id, btn.current)}
      >
        <Icon name={icon} />
        <span class="hl-ctx__chiptext">{text}</span>
      </button>
      <Popover id={id} icon={icon} label={label} title={label} edge="top-left" class="hl-ctx__pop">
        <SectionHost name={id} sections={sections} />
      </Popover>
    </span>
  )
}

export interface ContextBarProps {
  /** the slot's fallback (<HeadlineStrip …/>): its props are the console's headline values */
  fallback: unknown
  onPlanRoute?: (() => void) | null
  store?: PlanningStore
}

/** Slot 'context-bar': the bar, rendered into the top bar while the Plan layout is mounted. */
export function ContextBar({ fallback, onPlanRoute, store }: ContextBarProps) {
  const host = useSignalValue(barHost)
  const sections = useContext(SectionsCtx)
  const strip = stripPropsOf(fallback as never)
  const planPad = usePlanning(selectPad, store)
  const stops = usePlanning(selectStops, store).length
  useSignalValue(padLoadState()) // pad labels arrive with the pad index
  const results = useRouteResults((r: RouteResults) => r)
  const action = useSignalValue(planRouteAction)
  useLayoutEffect(() => {
    stripData.value = strip
  })
  useLayoutEffect(() => () => void (stripData.value = null), [])
  if (!host) return null
  const padId = activePadId(strip, planPad)
  const shown = shownFor(stops, results, planPad)
  return createPortal(<ContextLine strip={strip} padId={padId} pads={listPads()} shown={shown} sections={sections} onPlanRoute={onPlanRoute ?? action} />, host)
}
