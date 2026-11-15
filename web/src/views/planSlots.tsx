// Plan mode mount slots (package L2-shell, D111): the shared seams the declutter packages fill.
//   L2a headline strip  -> #hl-headline-strip in the top bar (ui/shell/Shell.tsx)
//   L2b bottom drawer   -> ctx.el.bottom    L2c layers + legend popovers -> ctx.el.edge
//   L2d station card    -> ctx.el.card      L3 rover card / drawer        -> ctx.el.live
// The console side panel's sections (views/console.tsx ConsolePanel) each render into their own element
// (a portal), in the old order inside the side panel. A package claims the sections it shows
// (ctx.claim): they leave the side panel for a hidden stash INSIDE main.outlet, so every number stays in
// the page (value snapshot unchanged), and <SectionHost> shows one inside a container while mounted.
// No number logic here. ?legacy=1 (no shell frame) mounts none of this: the side panel stays as it was.
import { createContext, createPortal, type ComponentChildren } from 'preact'
import { useContext, useLayoutEffect, useRef } from 'preact/hooks'
import { Num } from '../components/Num'
import type { RouteFC } from '../data/types'
import type { ConsoleMap } from '../map/consoleMap'
import { TrustChip } from '../ui/components'
import { t } from '../ui/copy'
import { layoutInsets, onLayoutChange, type LayoutInsets } from '../ui/layout'
import { TOKENS } from '../ui/tokens'
import { ui } from '../state/ui'
import { routeSummary } from './route'
import './planSlots.css'

// ---------------------------------------------------------------- console sections

/** The side panel's sections in their old order; 'summary' (one-line route summary) is never in the panel. */
export const SECTION_NAMES = ['notes', 'headline', 'padpicker', 'route', 'scenario', 'budget', 'layers', 'legend', 'roverpad', 'siting', 'stations', 'summary'] as const
export type SectionName = (typeof SECTION_NAMES)[number]

export interface Sections {
  readonly el: Readonly<Record<SectionName, HTMLElement>>
  /** hidden, inside main.outlet: claimed sections wait here while no container shows them */
  readonly stash: HTMLElement
  /** the side panel's body: unclaimed sections stay here, in order */
  readonly panel: HTMLElement
  readonly claimed: Set<SectionName>
}

/** One element per section inside the side panel (`panel`), in order; the summary waits in the stash. */
export function makeSections(panel: HTMLElement): Sections {
  const body = panel.appendChild(Object.assign(document.createElement('div'), { className: 'panel-body' }))
  const stash = panel.appendChild(Object.assign(document.createElement('div'), { className: 'plan-stash' }))
  stash.hidden = true
  const el = {} as Record<SectionName, HTMLElement>
  for (const name of SECTION_NAMES) {
    const e = document.createElement('div')
    e.className = 'plan-section'
    e.setAttribute('data-section', name)
    ;(name === 'summary' ? stash : body).appendChild(e)
    el[name] = e
  }
  return { el, stash, panel: body, claimed: new Set<SectionName>(['summary']) }
}

export const SectionsCtx = createContext<Sections | null>(null)

/** Render a console section into its element (used by ConsolePanel only). */
export function S({ name, children }: { name: SectionName; children?: ComponentChildren }) {
  const s = useContext(SectionsCtx)
  if (!s) return <>{children}</>
  return createPortal(<>{children}</>, s.el[name])
}

/** Show a claimed section inside a container while mounted; it goes back to the stash on unmount. */
export function SectionHost({ name, sections, class: cls }: { name: SectionName; sections: Sections; class?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const e = sections.el[name]
    ref.current?.appendChild(e)
    return () => void (sections.claimed.has(name) ? sections.stash : sections.panel).appendChild(e)
  }, [name, sections])
  return <div ref={ref} class={`panel-body plan-sectionhost${cls ? ` ${cls}` : ''}`} />
}

/** The collapsed plan-table line (section 'summary'): the route at a glance, same numbers as the route table. */
export function PlanSummary({ route, label, file, routeKey, loading, stations }: { route: RouteFC | null; label: string; file: string; routeKey: string; loading: boolean; stations: number | null }) {
  const r = routeSummary(route)
  if (loading) return <span>{t('layout.summary.loading', { label })}</span>
  if (!r) return <span>{t('layout.summary.noRoute', { label })}</span>
  const k = `${routeKey}.total_min`
  return (
    <span class="plan-summary">
      {r.stops.map((s) => (s === 'pad' ? 'Pad' : s)).join(' → ')} · {t('layout.summary.total')} <Num v={r.endMin} units="min" file={file} k={k} />
      <TrustChip kind="simulated" prov={{ key: k, file, value: r.endMin }} />
      {stations !== null && <> · {t('layout.summary.stations', { n: stations })}</>}
    </span>
  )
}

// ---------------------------------------------------------------- mounts

export interface PlanSlotElements {
  /** L2b: the bottom drawer ('plan-bottom') */
  bottom: HTMLElement
  /** L2c: map-edge popovers ('layers', 'legend'); its box ends at the bottom drawer (layoutInsets.bottom) */
  edge: HTMLElement
  /** L2d: the station marker card ('station') */
  card: HTMLElement
  /** L3: the rover card / Edit-route drawer */
  live: HTMLElement
  /** L2a: the headline strip host in the top bar (null when the top bar has none) */
  strip: HTMLElement | null
}

export interface PlanMountCtx {
  el: PlanSlotElements
  cmap: ConsoleMap
  mapEl: HTMLElement
  consoleEl: HTMLElement
  sections: Sections
  /** Take sections out of the side panel (into the hidden stash); show them with <SectionHost>. */
  claim(names: readonly SectionName[]): void
  /** Openers to press (in order, each only when present) to make a claimed section visible: read by
   *  tools/values_snapshot.ts before it uses a control in a closed container. */
  reveal(name: SectionName, selectors: readonly string[]): void
  /** A map click on a station selects it and calls `fn` instead of opening #/station/:id (L0 Q1). */
  onStationClick(fn: ((id: string) => void) | null): void
}

export type PlanMount = (ctx: PlanMountCtx) => () => void
const MOUNTS = new Map<string, PlanMount>()
/** Register a Plan mount (at module load; views/console.tsx imports the module for its side effect). */
export function registerPlanMount(id: string, mount: PlanMount): () => void {
  MOUNTS.set(id, mount)
  return () => void MOUNTS.delete(id)
}

export interface PlanSlotsOptions {
  mapEl: HTMLElement
  consoleEl: HTMLElement
  sections: Sections
  cmap: ConsoleMap
  onStationClick(fn: ((id: string) => void) | null): void
}

/**
 * Build the layout host over the map (shell frame only), run every registered mount, and ease the map
 * padding to the layout insets so the route stays in view when a drawer opens. Returns cleanup.
 */
export function mountPlanSlots(o: PlanSlotsOptions): () => void {
  const { mapEl, consoleEl, sections, cmap } = o
  consoleEl.classList.add('console--layout')
  const host = mapEl.appendChild(document.createElement('div'))
  host.className = 'plan-layout hl-ui'
  const slot = (n: string) => {
    const e = host.appendChild(document.createElement('div'))
    e.className = `plan-layout__${n}`
    e.setAttribute('data-plan-slot', n)
    return e
  }
  const el: PlanSlotElements = { edge: slot('edge'), card: slot('card'), live: slot('live'), bottom: slot('bottom'), strip: document.getElementById('hl-headline-strip') }
  const syncPanel = () => consoleEl.classList.toggle('console--panel-empty', sections.panel.childElementCount === 0)
  const ctx: PlanMountCtx = {
    el,
    cmap,
    mapEl,
    consoleEl,
    sections,
    claim(names) {
      for (const n of names) {
        sections.claimed.add(n)
        if (sections.el[n].parentElement === sections.panel) sections.stash.appendChild(sections.el[n])
      }
      syncPanel()
    },
    reveal(n, selectors) {
      sections.el[n].setAttribute('data-hl-reveal', JSON.stringify(selectors))
    },
    onStationClick: o.onStationClick,
  }
  const stops = [...MOUNTS.values()].map((m) => m(ctx))
  syncPanel()
  const pad = (i: LayoutInsets) => {
    mapEl.style.setProperty('--plan-inset-bottom', `${i.bottom}px`)
    mapEl.style.setProperty('--plan-inset-right', `${i.right}px`)
    try {
      cmap.map.easeTo({ padding: { top: 0, left: 0, right: i.right, bottom: i.bottom }, duration: ui.reducedMotion.peek() ? 0 : TOKENS.motion.panelMs[1] })
    } catch {
      /* the map is not ready or already gone */
    }
  }
  const i0 = layoutInsets.peek()
  if (i0.bottom || i0.right) pad(i0)
  const off = onLayoutChange(pad)
  return () => {
    off()
    for (const s of stops.reverse()) s()
    o.onStationClick(null)
    host.remove()
    consoleEl.classList.remove('console--layout', 'console--panel-empty')
  }
}
