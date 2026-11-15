// Plan headline strip (package L2a, D111; L0 row 3, spec §3): in the top bar's Plan slot
// (#hl-headline-strip, L2-shell), the three headline numbers, each with its trust chip:
//   30-min reach · 60-min reach · tightest margin of the planned route
// and two chips that open the console's Scenario and Walkback-budget sections in a popover (L0 Q2).
// The full headline text stays in the plan table and in Report (cuff card). Values come from the
// console's own state (views/console.tsx passes them); no number logic here.
import { createPortal } from 'preact'
import { useContext, useRef } from 'preact/hooks'
import { CONFIG } from '../config'
import { Num } from '../components/Num'
import { headlineFor, padKey, type PadSummaryView } from '../data/pads'
import type { TimelineEvent } from '../data/types'
import { signal, useSignalValue } from '../state/signal'
import { Icon, TrustChip, type ChipKind } from '../ui/components'
import { t } from '../ui/copy'
import { layout, Popover, toggleContainer } from '../ui/layout'
import { marginLabel, tightestMargin, type Headline60 } from './decisions'
import { registerPlanMount, SectionHost, SectionsCtx, type SectionName, type Sections } from './planSlots'
import './planStrip.css'

/** Popover ids of the strip chips (layout store; DOM ids hl-lay-scenario, hl-lay-budget). */
export const STRIP_POPOVERS = ['scenario', 'budget'] as const satisfies readonly SectionName[]
type StripPopover = (typeof STRIP_POPOVERS)[number]

/** The strip host while the Plan layout is mounted (shell frame only). */
const stripHost = signal<HTMLElement | null>(null)

registerPlanMount('strip', (ctx) => {
  if (!ctx.el.strip) return () => {}
  ctx.claim(STRIP_POPOVERS)
  for (const id of STRIP_POPOVERS) ctx.reveal(id, [`[aria-controls="hl-lay-${id}"][aria-expanded="false"]`])
  stripHost.value = ctx.el.strip
  return () => void (stripHost.value = null)
})

type Value = { v: number | null; k: string; file: string }

export interface StripProps {
  /** headline-budget (30-min) reach of the scenario; null while a parking option is selected */
  h30: (Value & { budget: number }) | null
  h60: Headline60 | null
  sid: string
  /** the selected D21 parking option (its summary.json headlines), else null */
  pad: { id: string; summary: PadSummaryView | null; file: string } | null
  /** the planned route's timeline (tightest margin), with its file and manifest key prefix */
  route: { timeline: TimelineEvent[] | null; file: string; key: string } | null
  scenarioText: string
  budget: number
}

function Item({ label, short, r, units, kind, title }: { label: string; short: string; r: Value | null; units: string; kind: ChipKind; title?: string }) {
  return (
    <div class="hl-strip__item" title={title}>
      <span class="hl-strip__label">
        <span class="hl-strip__long">{label}</span>
        <span class="hl-strip__short" aria-hidden="true">
          {short}
        </span>
      </span>
      {r ? (
        <>
          <Num v={r.v} units={units} file={r.file} k={r.k} />
          <TrustChip kind={kind} prov={{ key: r.k, file: r.file, value: r.v }} align="start" />
        </>
      ) : (
        <span class="hl-strip__none">–</span>
      )}
    </div>
  )
}

/** The headline strip: rendered by the console panel, shown in the top bar while the Plan layout is mounted. */
export function HeadlineStrip(p: StripProps) {
  const host = useSignalValue(stripHost)
  const sections = useContext(SectionsCtx)
  if (!host || !sections) return null
  const b30 = p.h30?.budget ?? CONFIG.walkbackBudgetsMin[0]
  const b60 = p.h60?.budget ?? CONFIG.walkbackBudgetsMin[1] ?? 60
  let r30: Value | null = p.h30
  let r60: Value | null = p.h60 ? { v: p.h60.reachablePct, k: `reachable_pct.${p.sid}.${p.h60.budget}`, file: 'scenarios/index.json' } : null
  if (p.pad) {
    // a parking option: its own summary.json headlines (keys pads.{id}.headline.{budget}.reachable_pct)
    const s = p.pad.summary
    const a = s ? headlineFor(s, b30) : null
    const c = s?.headlines.find((h) => h.budget === b60) ?? null
    r30 = a ? { v: a.reachablePct, k: padKey(p.pad.id, 'headline', a.budget, 'reachable_pct'), file: p.pad.file } : null
    r60 = c ? { v: c.reachablePct, k: padKey(p.pad.id, 'headline', c.budget, 'reachable_pct'), file: p.pad.file } : null
  }
  const tight = p.route ? tightestMargin(p.route.timeline) : null
  const margin = tight && p.route ? { v: tight.e.margin_min ?? null, k: `${p.route.key}.${tight.i}.margin_min`, file: p.route.file } : null
  const why = tight ? `${marginLabel(tight.e.margin_binding)}${tight.e.station ? `, ${tight.e.event} ${tight.e.station}` : ''}` : undefined
  return createPortal(
    <div class="hl-strip__row" role="group" aria-label={t('layout.strip.label')}>
      <div class="hl-strip__nums">
        <Item label={t('layout.strip.reach', { budget: b30 })} short={t('layout.strip.reachShort', { budget: b30 })} r={r30} units="%" kind="modelled" />
        <Item label={t('layout.strip.reach', { budget: b60 })} short={t('layout.strip.reachShort', { budget: b60 })} r={r60} units="%" kind="modelled" />
        <Item label={t('layout.strip.margin')} short={t('layout.strip.marginShort')} r={margin} units="min" kind="simulated" title={why} />
      </div>
      <div class="hl-strip__choices">
        <StripChoice id="scenario" text={p.scenarioText} label={t('layout.strip.scenario')} sections={sections} />
        <StripChoice id="budget" text={t('layout.strip.budgetValue', { budget: p.budget })} label={t('layout.strip.budget')} sections={sections} />
      </div>
    </div>,
    host,
  )
}

/** A text chip that opens a popover holding one console section (Scenario, Walkback budget). */
function StripChoice({ id, text, label, sections }: { id: StripPopover; text: string; label: string; sections: Sections }) {
  const btn = useRef<HTMLButtonElement>(null)
  const open = !!useSignalValue(layout.open)[id]
  return (
    <div class="hl-strip__choice">
      <button
        ref={btn}
        type="button"
        class="hl-strip__chip"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={`hl-lay-${id}`}
        aria-haspopup="dialog"
        aria-label={`${label}: ${text}`}
        title={label}
        // the popover closes on a press outside it; this chip is its opener, so the press stays here
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => toggleContainer(id, btn.current)}
      >
        <Icon name={id === 'scenario' ? 'gauge' : 'timer'} />
        <span class="hl-strip__chiptext">{text}</span>
      </button>
      <Popover id={id} icon={id === 'scenario' ? 'gauge' : 'timer'} label={label} title={label} edge="top-left" class="hl-strip__pop">
        <SectionHost name={id} sections={sections} />
      </Popover>
    </div>
  )
}
