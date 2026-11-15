// Plan bottom drawer (package L2b, D111; L0 mapping rows 4 and 5). Mount points only: one BottomDrawer
// 'plan-bottom' along the bottom map edge, in the L2-shell slot `.plan-layout__bottom`, with two tabs:
//   plan-table   the console's planned route and stations table (and the sections that explain them:
//                headline, parking options, rover pad, siting), moved out of the old side panel
//   timeline     the timeline dock body (ui/timeline/install.tsx installTimelineDock → dockContent)
// Collapsed it is one line: the plan summary (the route at a glance, from the same files) and the slim
// timeline scrubber (play, scrub, EVA time). Expanded at most 40 % of the map (L1, layout.css).
// While mounted the Plan map view hosts the timeline ('timeline' in shell.hosted), so the shell dock
// stays empty in Plan: one timeline at a time, inside the map box, never squeezed by a side panel
// (RR1 issue 1: a right drawer ends above the bottom drawer; the track keeps a minimum width).
// No number logic here: the sections render the console's own values; the timeline is unchanged.
import { render } from 'preact'
import { useSignalValue } from '../state/signal'
import { missionClock } from '../state/mission'
import { IconButton, TrustChip } from '../ui/components'
import { t } from '../ui/copy'
import { BottomDrawer, layoutInsets, onLayoutChange, type LayoutInsets } from '../ui/layout'
import { dockContent, hostIn } from '../ui/shell/store'
import { fmtEva } from '../ui/timeline/model'
import { registerPlanMount, SectionHost, type PlanMountCtx, type SectionName } from './planSlots'
import './planBottom.css'

/** Layout store ids (L5 selector contract: #hl-lay-plan-bottom, #hl-lay-plan-bottom-tab-<tab>). */
export const PLAN_BOTTOM = 'plan-bottom'
export const TAB_TABLE = 'plan-table'
export const TAB_TIMELINE = 'timeline'

/** Shell-root CSS variable: the bottom drawer's height (planBottom.css keeps overlay side panels above it). */
const INSET_VAR = '--hl-plan-bottom'

/** Console sections shown in the plan table, in the old side-panel order. */
// L2f: 'roverpad' went to the rover card (views/planStation.tsx)
export const TABLE_SECTIONS: readonly SectionName[] = ['headline', 'padpicker', 'route', 'siting', 'stations']

/** What tools/values_snapshot.ts presses to show a plan-table control: expand, then pick the tab. */
const TABLE_REVEAL = [`[aria-controls="hl-lay-${PLAN_BOTTOM}"][aria-expanded="false"]`, `#hl-lay-${PLAN_BOTTOM}-tab-${TAB_TABLE}[aria-selected="false"]`]

/** Collapsed timeline line: play / pause, scrub, EVA time (the full chart is the expanded tab). */
export function SlimScrubber() {
  const tNow = useSignalValue(missionClock.s.t)
  const playing = useSignalValue(missionClock.s.playing)
  const tMax = useSignalValue(missionClock.s.tMax)
  // the dock ticker (ui/timeline/install.tsx) starts on its own whenever the mission clock plays
  return (
    <span class="plan-scrub">
      <IconButton
        class="hl-tl__play"
        icon={playing ? 'pause' : 'play'}
        label={t(playing ? 'buttons.pause' : 'buttons.play')}
        pressed={playing}
        aria-keyshortcuts="Space"
        onClick={() => missionClock.toggle()}
        onKeyDown={(e: KeyboardEvent) => {
          // the native button click toggles; keep the shell's Space shortcut from toggling it again
          if (e.key === ' ' || e.key === 'Enter') e.stopPropagation()
        }}
      />
      <input
        class="hl-slider__input plan-scrub__range"
        style={{ '--fill': `${tMax > 0 ? (100 * Math.min(Math.max(tNow, 0), tMax)) / tMax : 0}%` }}
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

/** Expanded timeline tab: the timeline dock body (the same element the shell dock shows elsewhere). */
function TimelineTab() {
  const content = useSignalValue(dockContent)
  return <div class="plan-timeline">{content ? content() : <p class="muted">{t('states.error.notAvailable', { what: t('timeline.marginCurve') })}</p>}</div>
}

function PlanBottom({ ctx }: { ctx: PlanMountCtx }) {
  return (
    <BottomDrawer
      id={PLAN_BOTTOM}
      class="plan-bottom"
      label={t('planBottom.label')}
      expandLabel={t('planBottom.expand')}
      collapseLabel={t('planBottom.collapse')}
      defaultTab={TAB_TABLE}
      tabs={[
        {
          id: TAB_TABLE,
          label: t('planBottom.planTable'),
          render: () => (
            <div class="plan-table">
              {TABLE_SECTIONS.map((n) => (
                <SectionHost key={n} name={n} sections={ctx.sections} />
              ))}
            </div>
          ),
        },
        { id: TAB_TIMELINE, label: t('planBottom.timeline'), render: () => <TimelineTab /> },
      ]}
      collapsed={() => (
        <span class="plan-bottom__line">
          <span class="plan-bottom__summary">
            <SectionHost name="summary" sections={ctx.sections} />
          </span>
          <SlimScrubber />
        </span>
      )}
    />
  )
}

/** Mount the bottom drawer into the L2-shell slot; returns cleanup. */
export function mountPlanBottom(ctx: PlanMountCtx): () => void {
  ctx.claim([...TABLE_SECTIONS, 'summary'])
  for (const n of TABLE_SECTIONS) ctx.reveal(n, TABLE_REVEAL)
  const unhost = hostIn('timeline')
  const host = ctx.el.bottom
  // RR1 issue 1: a side panel that overlays the map (tablet / phone sidebar) ends above the drawer
  const shellEl = ctx.mapEl.closest?.<HTMLElement>('.hl-shell')
  const inset = (i: LayoutInsets) => shellEl?.style.setProperty(INSET_VAR, `${i.bottom}px`)
  inset(layoutInsets.peek())
  const off = onLayoutChange(inset)
  render(<PlanBottom ctx={ctx} />, host)
  return () => {
    off()
    render(null, host)
    shellEl?.style.setProperty(INSET_VAR, '') // '' removes it
    unhost()
  }
}

registerPlanMount(PLAN_BOTTOM, mountPlanBottom)
