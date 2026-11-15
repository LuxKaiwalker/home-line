// Plan bottom drawer (package L2b, D111; L0 mapping rows 4 and 5). Mount points only: one BottomDrawer
// 'plan-bottom' along the bottom map edge, in the L2-shell slot `.plan-layout__bottom`. User 22:59 (F7):
// the drawer holds ONLY the replay, one tab:
//   timeline     the timeline dock body (ui/timeline/install.tsx installTimelineDock → dockContent)
// User 23:28 (F7): the Plan table (PlanTableTab: the console's planned route and stations table and the
// sections that explain them, parking options included) lives in the LEFT rail (sheet over the map in
// Plan) as rail section 'plan-table'; its opener is the rail toggle (ctx.reveal, values snapshot). While
// the rail is closed the sections wait in the hidden stash (numbers stay in the page). The D142 "Compare
// plans" link stays removed (ComparePlansLink kept, not mounted; #/trade stays reachable by URL).
// Collapsed it is one line: the plan summary (the route at a glance, from the same files) and the slim
// timeline scrubber (play, scrub, EVA time). Expanded at most 40 % of the map (L1, layout.css).
// While mounted the Plan map view hosts the timeline ('timeline' in shell.hosted), so the shell dock
// stays empty in Plan: one timeline at a time, inside the map box, never squeezed by a side panel
// (RR1 issue 1: a right drawer ends above the bottom drawer; the track keeps a minimum width).
// No number logic here: the sections render the console's own values; the timeline is unchanged.
import { render } from 'preact'
import { useSignalValue } from '../state/signal'
import { controlSignal } from '../state/activity'
import { toggleReplay } from '../state/activityClock'
import { missionClock } from '../state/mission'
import { IconButton, TrustChip } from '../ui/components'
import { t } from '../ui/copy'
import { BottomDrawer, layoutInsets, onLayoutChange, type LayoutInsets } from '../ui/layout'
import { dockContent, hostIn, registerRailSection } from '../ui/shell/store'
import { fmtEva } from '../ui/timeline/model'
import { ReplaySourceBar, UserReplayReadout } from '../ui/timeline/userReplay'
import { userReplay } from '../state/userReplay'
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

/**
 * Collapsed timeline line: play / pause, scrub, EVA time (the full chart is the expanded tab).
 * L7c: Play is the replay player of the activity store, as in the full timeline (Timeline.tsx): it goes
 * through toggleReplay (a running flythrough or intro stops first), is pressed only while the replay
 * runs (not while the flythrough or the intro drives the clock) and is disabled with the store's reason.
 * data-state mirrors .hl-tl[data-state] (the clock playing or paused, whichever player drives it).
 */
export function SlimScrubber() {
  const tNow = useSignalValue(missionClock.s.t)
  const playing = useSignalValue(missionClock.s.playing)
  const tMax = useSignalValue(missionClock.s.tMax)
  const replay = useSignalValue(controlSignal('replay'))
  // the dock ticker (ui/timeline/install.tsx) starts on its own whenever the mission clock plays
  return (
    <span class="plan-scrub" data-state={playing ? 'playing' : 'paused'}>
      {/* PORT F5: "Replaying: your route (estimate)" + the way back, only while the user's route replays */}
      <ReplaySourceBar />
      <IconButton
        class="hl-tl__play"
        icon={replay.running ? 'pause' : 'play'}
        label={t(replay.running ? 'buttons.pause' : 'buttons.play')}
        pressed={replay.running}
        disabled={!replay.enabled}
        title={replay.enabled ? t('hints.timeline.play') : replay.title}
        data-activity-reason={replay.reason ?? undefined}
        aria-keyshortcuts="Space"
        onClick={() => {
          if (replay.enabled) toggleReplay()
        }}
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
  // PORT F5: during the user's replay the official chart (official plan values) is hidden
  if (useSignalValue(userReplay)) return <div class="plan-timeline"><UserReplayReadout /></div>
  return <div class="plan-timeline">{content ? content() : <p class="muted">{t('states.error.notAvailable', { what: t('timeline.marginCurve') })}</p>}</div>
}

/** Rail section id of the Plan table (user 23:28: left rail; it was the drawer's plan-table tab). */
export const RAIL_TABLE = 'plan-table'
/** What tools/values_snapshot.ts presses to show a plan-table control: open the left rail (sheet). */
export const TABLE_REVEAL = ['.hl-rail__toggle[aria-controls="hl-rail-body"][aria-expanded="false"]']

/** The Plan table (left rail section since user 23:28): the claimed console sections in the old order. */
export function PlanTableTab({ ctx }: { ctx: PlanMountCtx }) {
  return (
    <div class="plan-table">
      {TABLE_SECTIONS.map((n) => (
        <SectionHost key={n} name={n} sections={ctx.sections} />
      ))}
    </div>
  )
}

/** D142 "Compare plans" (#/trade; Back returns with the same pad and route, views/planPort.tsx). Not
 *  mounted since user 22:59 (F7): the drawer holds only the replay; #/trade stays reachable by URL. */
export function ComparePlansLink() {
  return (
    <a class="plan-bottom__compare" href="#/trade" data-testid="plan-compare-plans" title={t('planBottom.comparePlansTip')}>
      {t('planBottom.comparePlans')}
    </a>
  )
}

function PlanBottom({ ctx }: { ctx: PlanMountCtx }) {
  return (
    <BottomDrawer
      id={PLAN_BOTTOM}
      class="plan-bottom"
      label={t('planBottom.label')}
      expandLabel={t('planBottom.expand')}
      collapseLabel={t('planBottom.collapse')}
      defaultTab={TAB_TIMELINE}
      // user 22:59 (F7): only the replay; no plan-table tab, no "Compare plans" link
      tabs={[{ id: TAB_TIMELINE, label: t('planBottom.timeline'), render: () => <TimelineTab /> }]}
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
  // user 23:28: the Plan table is a left-rail section; the rail toggle reveals its controls
  for (const n of TABLE_SECTIONS) ctx.reveal(n, TABLE_REVEAL)
  const unrail = registerRailSection({ id: RAIL_TABLE, modes: ['plan'], title: 'planBottom.planTable', icon: 'file-text', render: () => <PlanTableTab ctx={ctx} /> })
  const unhost = hostIn('timeline')
  const host = ctx.el.bottom
  // RR1 issue 1: a side panel that overlays the map (tablet / phone sidebar) ends above the drawer
  const shellEl = ctx.mapEl.closest?.<HTMLElement>('.hl-shell')
  const inset = (i: LayoutInsets) => shellEl?.style.setProperty(INSET_VAR, `${i.bottom}px`)
  inset(layoutInsets.peek())
  const off = onLayoutChange(inset)
  render(<PlanBottom ctx={ctx} />, host)
  return () => {
    unrail()
    off()
    render(null, host)
    shellEl?.style.setProperty(INSET_VAR, '') // '' removes it
    unhost()
  }
}

registerPlanMount(PLAN_BOTTOM, mountPlanBottom)
