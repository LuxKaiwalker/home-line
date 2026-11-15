// Plan mode layout (package L2, D111; L0 mapping rows 3–7, 12–17, 19–21). Mount points only: the console
// sections (views/console.tsx ConsolePanel) render through portals into "slots", and the L1 layout
// containers over the map show those slots:
//   headline strip (#hl-topbar-plan)  30-min reach, 60-min reach, tightest margin + trust chips;
//                                      scenario and budget chips that open a popover
//   bottom drawer "plan-bottom"       tab "plan-table" (headline, parking options, route, rover pad,
//                                      F8, stations; collapsed = one-line summary), tab "timeline"
//                                      (the timeline dock; collapsed = the slim scrubber)
//   popover "layers"                  console layer list + U7 layer manager + 3D exaggeration + collapse toggle
//   popover "legend"                  the legend (corner chip)
//   marker card "station"             station card on selection; the full page via "Open station" (L0 Q1)
// A slot that no container shows waits in a hidden stash inside the outlet, so every number stays in the
// page (value snapshot: unchanged; tools/values_snapshot.ts opens the container named by data-hl-reveal
// before it uses a control). No number logic here: values come from the console's own state.
import { createContext, createPortal, render, type ComponentChildren } from 'preact'
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { CONFIG } from '../config'
import { Num } from '../components/Num'
import { data } from '../data/loader'
import { headlineFor, padKey, type PadSummaryView } from '../data/pads'
import type { RouteFC, Station, TimelineEvent } from '../data/types'
import type { ConsoleMap } from '../map/consoleMap'
import { LayerPanel } from '../map/overlays/LayerPanel'
import { href } from '../router'
import { missionClock } from '../state/mission'
import { clearSelection, selection } from '../state/selection'
import { effect, useSignalValue } from '../state/signal'
import { ui } from '../state/ui'
import { TOKENS } from '../ui/tokens'
import { IconButton, TrustChip } from '../ui/components'
import { t } from '../ui/copy'
import { BottomDrawer, MarkerCard, Popover, closeContainer, layout, layoutInsets, onLayoutChange, openContainer, toggleContainer } from '../ui/layout'
import { dockContent, shell } from '../ui/shell/store'
import { fmtEva } from '../ui/timeline/model'
import { marginLabel, tightestMargin, type Headline60 } from './decisions'
import { routeSummary } from './route'
import './planLayout.css'

// ---------------------------------------------------------------- slots

/** Console sections, in the order of the old side panel (?legacy=1 keeps that order). */
export const SLOT_NAMES = ['notes', 'headline', 'padpicker', 'route', 'scenario', 'budget', 'layers', 'legend', 'roverpad', 'siting', 'stations', 'summary'] as const
export type SlotName = (typeof SLOT_NAMES)[number]
export type Slots = Record<SlotName, HTMLElement> & { stash: HTMLElement; host: 'layout' | 'legacy' }

/** Container ids (L5 selector contract: DOM id hl-lay-<id>). */
export const PLAN_BOTTOM = 'plan-bottom'
export const TAB_TABLE = 'plan-table'
export const TAB_TIMELINE = 'timeline'

const opener = (id: string, open: 'false' | 'true' = 'false') => `[aria-controls="hl-lay-${id}"][aria-expanded="${open}"]`
const TABLE_REVEAL = [opener(PLAN_BOTTOM), `#hl-lay-${PLAN_BOTTOM}-tab-${TAB_TABLE}[aria-selected="false"]`]
/** What to click (in order, each only if present) to show a slot: read by tools/values_snapshot.ts. */
const REVEAL: Partial<Record<SlotName, string[]>> = {
  headline: TABLE_REVEAL,
  padpicker: TABLE_REVEAL,
  route: TABLE_REVEAL,
  roverpad: TABLE_REVEAL,
  siting: TABLE_REVEAL,
  stations: TABLE_REVEAL,
  scenario: [opener('scenario')],
  budget: [opener('budget')],
  layers: [opener('layers')],
  legend: [opener('legend')],
}
const TABLE_SLOTS: readonly SlotName[] = ['headline', 'padpicker', 'route', 'roverpad', 'siting', 'stations']

/** One element per slot. Legacy: in the old side panel, in order. Layout: in the hidden stash (the aside). */
export function makeSlots(panel: HTMLElement, host: 'layout' | 'legacy'): Slots {
  const body = host === 'legacy' ? panel.appendChild(Object.assign(document.createElement('div'), { className: 'panel-body' })) : panel
  const out = { stash: panel, host } as Slots
  for (const name of SLOT_NAMES) {
    const el = document.createElement('div')
    el.className = host === 'legacy' ? 'plan-slot plan-slot--inline' : 'plan-slot panel-body'
    el.setAttribute('data-slot', name)
    const r = REVEAL[name]
    if (r && host === 'layout') el.setAttribute('data-hl-reveal', JSON.stringify(r))
    if (name === 'summary' && host === 'legacy') el.hidden = true // the old panel has no summary line
    ;(name === 'summary' && host === 'legacy' ? panel : body).appendChild(el)
    out[name] = el
  }
  return out
}

export const SlotsCtx = createContext<Slots | null>(null)

/** Render a console section into its slot. */
export function S({ name, children }: { name: SlotName; children?: ComponentChildren }) {
  const s = useContext(SlotsCtx)
  if (!s) return <>{children}</>
  return createPortal(<>{children}</>, s[name])
}

/** Shows a slot while mounted; puts it back into the stash on unmount. */
function SlotHost({ name, slots }: { name: SlotName; slots: Slots }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = slots[name]
    ref.current?.appendChild(el)
    return () => void slots.stash.appendChild(el)
  }, [name, slots])
  return <div ref={ref} class="plan-slothost" />
}

/** Borrows a map control element (by selector, inside the map) while mounted; returns it on unmount. */
function Borrow({ root, sel }: { root: HTMLElement; sel: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = root.querySelector<HTMLElement>(sel)
    if (!el || !ref.current) return
    const parent = el.parentElement
    const next = el.nextSibling
    ref.current.appendChild(el)
    return () => {
      if (parent?.isConnected && el.parentElement === ref.current) parent.insertBefore(el, next && next.parentNode === parent ? next : null)
    }
  }, [root, sel])
  return <div ref={ref} class="plan-borrow" />
}

// ---------------------------------------------------------------- headline strip

export interface StripProps {
  /** 30-min (headline budget) reach of the scenario; null while a parking option is selected */
  h30: { v: number | null; k: string; file: string; budget: number } | null
  h60: Headline60 | null
  sid: string
  pad: { id: string; summary: PadSummaryView | null; file: string } | null
  route: { timeline: TimelineEvent[] | null; file: string; key: string } | null
  scenarioText: string
  budget: number
}

function Chip({ kind, k, file, v }: { kind: 'modelled' | 'simulated'; k: string; file: string; v: unknown }) {
  return <TrustChip kind={kind} prov={{ key: k, file, value: v }} align="end" />
}

/** The headline strip: in the top bar's Plan slot. Nothing outside the shell (no host element). */
export function HeadlineStrip(p: StripProps) {
  const slots = useContext(SlotsCtx)
  const host = typeof document === 'undefined' ? null : document.getElementById('hl-headline-strip')
  if (!slots || slots.host !== 'layout' || !host) return null
  const b30 = CONFIG.walkbackBudgetsMin[0]
  const b60 = CONFIG.walkbackBudgetsMin[1] ?? 60
  let r30: { v: number | null; k: string; file: string } | null = p.h30
  let r60: { v: number | null; k: string; file: string } | null = p.h60 ? { v: p.h60.reachablePct, k: `reachable_pct.${p.sid}.${p.h60.budget}`, file: 'scenarios/index.json' } : null
  if (p.pad) {
    const s = p.pad.summary
    const at = (b: number) => s?.headlines.find((h) => h.budget === b) ?? null
    const a = s ? at(b30) ?? headlineFor(s, b30) : null
    const c = s ? at(b60) : null
    r30 = a ? { v: a.reachablePct, k: padKey(p.pad.id, 'headline', a.budget, 'reachable_pct'), file: p.pad.file } : null
    r60 = c ? { v: c.reachablePct, k: padKey(p.pad.id, 'headline', c.budget, 'reachable_pct'), file: p.pad.file } : null
  }
  const tight = p.route ? tightestMargin(p.route.timeline) : null
  const item = (label: string, r: { v: number | null; k: string; file: string } | null, units: string, kind: 'modelled' | 'simulated', title?: string) => (
    <div class="hl-strip__item" title={title}>
      <span class="hl-strip__label">{label}</span>
      {r ? (
        <>
          <Num v={r.v} units={units} file={r.file} k={r.k} />
          <Chip kind={kind} k={r.k} file={r.file} v={r.v} />
        </>
      ) : (
        <span class="hl-strip__none">–</span>
      )}
    </div>
  )
  return createPortal(
    <div class="hl-strip__row" role="group" aria-label={t('layout.strip.label')}>
      {item(t('layout.strip.reach', { budget: p.h30?.budget ?? b30 }), r30, '%', 'modelled')}
      {item(t('layout.strip.reach', { budget: b60 }), r60, '%', 'modelled')}
      {item(
        t('layout.strip.margin'),
        tight && p.route ? { v: tight.e.margin_min ?? null, k: `${p.route.key}.${tight.i}.margin_min`, file: p.route.file } : null,
        'min',
        'simulated',
        tight ? `${marginLabel(tight.e.margin_binding)}${tight.e.station ? `, ${tight.e.event} ${tight.e.station}` : ''}` : undefined,
      )}
      <StripChoice id="scenario" icon="gauge" text={p.scenarioText} label={t('layout.strip.scenario')} slots={slots} />
      <StripChoice id="budget" icon="timer" text={t('layout.strip.budgetValue', { budget: p.budget })} label={t('layout.strip.budget')} slots={slots} />
    </div>,
    host,
  )
}

/** A strip chip (text) that opens a popover holding one console section. */
function StripChoice({ id, icon, text, label, slots }: { id: 'scenario' | 'budget'; icon: 'gauge' | 'timer'; text: string; label: string; slots: Slots }) {
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
        title={label}
        // the popover closes on a press outside it; this chip is its opener, so keep that press here
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => toggleContainer(id, btn.current)}
      >
        <span class="hl-strip__label">{label}</span> {text}
      </button>
      <Popover id={id} icon={icon} label={label} title={label} edge="top-left" class="hl-strip__pop">
        <SlotHost name={id} slots={slots} />
      </Popover>
    </div>
  )
}


// ---------------------------------------------------------------- bottom drawer lines

/** Collapsed plan-table line: the route at a glance (same numbers as the route table). */
export function PlanSummary({ route, label, file, routeKey, loading, stations }: { route: RouteFC | null; label: string; file: string; routeKey: string; loading: boolean; stations: number | null }) {
  const r = routeSummary(route)
  if (loading) return <span>{t('layout.bottom.routeLoading', { label })}</span>
  if (!r) return <span>{t('layout.bottom.noRoute', { label })}</span>
  return (
    <span class="plan-summary">
      <b>{t('layout.bottom.planTable')}</b> · {r.stops.map((s) => (s === 'pad' ? 'Pad' : s)).join(' → ')} · {t('layout.bottom.total')} <Num v={r.endMin} units="min" file={file} k={`${routeKey}.total_min`} />
      <TrustChip kind="simulated" prov={{ key: `${routeKey}.total_min`, file, value: r.endMin }} />
      {stations !== null && <> · {t('layout.bottom.stations', { n: stations })}</>}
    </span>
  )
}

/** Collapsed timeline line: play, scrub, time (the full chart is in the expanded tab). */
function SlimScrubber() {
  const tNow = useSignalValue(missionClock.s.t)
  const playing = useSignalValue(missionClock.s.playing)
  const tMax = useSignalValue(missionClock.s.tMax)
  // the dock ticker (ui/timeline/install.tsx) starts on its own whenever the mission clock plays
  const play = () => missionClock.toggle()
  return (
    <span class="plan-scrub">
      <IconButton class="hl-tl__play" icon={playing ? 'pause' : 'play'} label={t(playing ? 'buttons.pause' : 'buttons.play')} pressed={playing} onClick={play} />
      <input
        type="range"
        min={0}
        max={tMax}
        step={0.5}
        value={tNow}
        aria-label={t('timeline.title')}
        aria-valuetext={`${fmtEva(tNow)} EVA`}
        onInput={(e) => missionClock.seek(Number((e.target as HTMLInputElement).value))}
      />
      <span class="plan-scrub__time hl-tl__clockvalue">{fmtEva(tNow)} EVA</span>
      <TrustChip kind="simulated" />
    </span>
  )
}

function TimelineTab() {
  const content = useSignalValue(dockContent)
  return <div class="plan-timeline">{content ? content() : <p class="muted">{t('states.error.notAvailable', { what: t('timeline.marginCurve') })}</p>}</div>
}

// ---------------------------------------------------------------- station card

function StationCardBody({ id }: { id: string }) {
  const [Panel, setPanel] = useState<null | ((p: { L: ReturnType<typeof data> }) => ComponentChildren)>(null)
  useEffect(() => {
    let live = true
    void import('../ui/cards/sidebar').then((m) => live && setPanel(() => m.SelectionPanel as never))
    return () => void (live = false)
  }, [])
  return (
    <>
      {Panel ? <Panel L={data()} /> : <p class="muted">{t('layout.station.loading')}</p>}
      <p class="plan-card__open">
        <a class="hl-btn hl-btn--secondary" href={href({ name: 'station', id })}>
          {t('layout.station.open')}
        </a>
      </p>
    </>
  )
}

// ---------------------------------------------------------------- the layout over the map

function PlanLayout({ slots, cmap, mapEl, setOpenCard }: { slots: Slots; cmap: ConsoleMap; mapEl: HTMLElement; setOpenCard: (f: (id: string) => void) => void }) {
  const [stations, setStations] = useState<Station[] | null>(null)
  const [card, setCard] = useState<string | null>(null)
  const insets = useSignalValue(layoutInsets)
  useEffect(() => {
    let live = true
    data()
      .stations()
      .then((s) => live && setStations(s))
      .catch(() => undefined)
    return () => void (live = false)
  }, [])
  // a station selection (map, list, search) opens its card; a map click on the selected one reopens it
  useEffect(() => {
    const show = (id: string) => {
      setCard(id)
      openContainer('station', document.activeElement as HTMLElement | null)
    }
    setOpenCard(show)
    return effect(() => {
      const s = selection.selected.value
      if (s?.kind === 'station') show(s.id)
    })
  }, [])
  // closing the station card (its button, Esc) dismisses the station selection too, as Esc did in the sidebar
  useEffect(() => {
    let was = false
    return effect(() => {
      const open = !!layout.open.value.station
      const s = selection.selected.peek()
      if (was && !open && s?.kind === 'station') clearSelection()
      was = open
    })
  }, [])
  const st = card ? stations?.find((s) => s.id === card) : undefined
  return (
    <>
      <div class="plan-notes">
        <SlotHost name="notes" slots={slots} />
      </div>
      <div class="plan-edge" style={{ bottom: `${insets.bottom}px` }}>
        <Popover id="layers" icon="layers" label={t('layout.layers.label')} title={t('layout.layers.label')} edge="right-top" class="plan-pop plan-pop--layers">
          <SlotHost name="layers" slots={slots} />
          <Borrow root={mapEl} sel=".maplibregl-ctrl-top-left .hl-terrain-exag" />
          <Borrow root={mapEl} sel=".maplibregl-ctrl-top-right .collapse-toggle" />
          <LayerPanel />
        </Popover>
        <Popover id="legend" icon="info" label={t('layout.legend.label')} title={t('layout.legend.label')} edge="bottom-left" class="plan-pop plan-pop--legend">
          <SlotHost name="legend" slots={slots} />
        </Popover>
      </div>
      {card && st && (
        <MarkerCard id="station" title={`${st.id} ${st.name}`} at={{ lngLat: [st.lon, st.lat], map: cmap.map }} class="plan-card">
          <StationCardBody id={st.id} />
        </MarkerCard>
      )}
      <BottomDrawer
        id={PLAN_BOTTOM}
        label={t('layout.bottom.label')}
        expandLabel={t('layout.bottom.expand')}
        collapseLabel={t('layout.bottom.collapse')}
        defaultTab={TAB_TABLE}
        tabs={[
          {
            id: TAB_TABLE,
            label: t('layout.bottom.planTable'),
            render: () => (
              <div class="plan-table">
                {TABLE_SLOTS.map((n) => (
                  <SlotHost key={n} name={n} slots={slots} />
                ))}
              </div>
            ),
          },
          { id: TAB_TIMELINE, label: t('layout.bottom.timeline'), render: () => <TimelineTab /> },
        ]}
        collapsed={({ tab }) => (tab === TAB_TIMELINE ? <SlimScrubber /> : <SlotHost name="summary" slots={slots} />)}
      />
    </>
  )
}

/**
 * Mount the Plan layout over the console map (shell frame only). Marks the shell as hosting the
 * timeline, the layer manager and the station card; eases the map padding to the drawer insets so the
 * route stays in view. Returns cleanup.
 */
export function mountPlanLayout(mapEl: HTMLElement, consoleEl: HTMLElement, slots: Slots, cmap: ConsoleMap, setOpenCard: (f: (id: string) => void) => void): () => void {
  consoleEl.classList.add('console--layout')
  const host = mapEl.appendChild(document.createElement('div'))
  host.className = 'plan-layout hl-ui'
  shell.planHost.value = true
  shell.hostedSections.value = ['layers']
  render(<PlanLayout slots={slots} cmap={cmap} mapEl={mapEl} setOpenCard={setOpenCard} />, host)
  const pad = (i: { right: number; bottom: number }) => {
    mapEl.style.setProperty('--plan-inset-bottom', `${i.bottom}px`)
    try {
      cmap.map.easeTo({ padding: { top: 0, left: 0, right: i.right, bottom: i.bottom }, duration: ui.reducedMotion.peek() ? 0 : TOKENS.motion.panelMs[1] })
    } catch {
      /* map not ready or destroyed */
    }
  }
  pad(layoutInsets.peek())
  const off = onLayoutChange(pad)
  return () => {
    off()
    closeContainer('station', { restoreFocus: false })
    render(null, host)
    host.remove()
    shell.planHost.value = false
    shell.hostedSections.value = []
    consoleEl.classList.remove('console--layout')
  }
}
