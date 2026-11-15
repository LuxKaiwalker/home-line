// Lazy build of the expanded index (spec rule 5, planning-UI L12): never during the loading screen or
// the intro. Nothing happens at import. The palette builds it on first open (palette.tsx searchIndex);
// `scheduleIndexBuild` adds the idle build once the intro has started (ui.introSeen turns true when the
// intro begins, story/attach.ts) — the shell's first-load code must call it to opt in (see PR notes).
// Every read goes through the one loader and only names files the app already fetches (scenarios
// index, the official route, the dock's timeline, rad.json and clock.json), so a later read is a cache hit.
import type { Loader } from '../../../data/loader'
import { missionClock } from '../../../state/mission'
import { effect } from '../../../state/signal'
import { ui } from '../../../state/ui'
import type { Rad } from '../../../hud/types'
import { t } from '../../copy'
import { buildTimelineModel, type TimelineFileRow } from '../../timeline/model'
import type { SearchItem } from '../search'
import { areaItems, eventItems, glossaryItems, legItems, legsFromRoute, reportItems, scenarioItems, type Translate } from './sources'

const tr: Translate = (k, vars) => t(k, vars)

/** Build the expanded items from the loader. A missing or failing file drops only its group. */
export async function buildExpandedIndex(L: Loader): Promise<SearchItem[]> {
  const soft = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null)
  const idx = await soft(L.optional(() => L.scenarios()))
  // the official plan = the index default: the leg cards (ui/cards/data.ts) and the dock
  // (ui/timeline/install.tsx) read the same route and timeline files, so these reads are cache hits
  const dockId = idx ? (idx.scenarios.find((s) => s.id === idx.default) ?? idx.scenarios[0])?.id : undefined
  const [route, tl, rad, clock] = await Promise.all([
    dockId ? soft(L.optional(() => L.route(dockId))) : null,
    dockId ? soft(L.optional(() => L.timeline(dockId))) : null,
    soft(L.optional(() => L.rad())),
    soft(L.optional(() => L.clock())),
  ])
  const out: SearchItem[] = [...areaItems(tr), ...legItems(legsFromRoute(route as never), tr)]
  if (tl && dockId) {
    const tDark = (clock as { eva?: { t_dark_min?: number | null } } | null)?.eva?.t_dark_min ?? null
    const m = buildTimelineModel({ scenario: dockId, timeline: tl as unknown as TimelineFileRow[], tMax: missionClock.tMax, rad: rad as unknown as Rad | null, tDarkMin: tDark })
    out.push(...eventItems(m, tr))
  }
  if (idx) out.push(...scenarioItems(idx.scenarios, tr))
  out.push(...reportItems(tr), ...glossaryItems(tr))
  return out
}

let cached: Promise<SearchItem[]> | null = null
/** The expanded items, built once per page load (first caller wins: palette open or idle build). */
export function expandedIndex(L: Loader): Promise<SearchItem[]> {
  return (cached ??= buildExpandedIndex(L).catch(() => []))
}
export const expandedIndexStarted = (): boolean => cached !== null
/** Tests: forget the built index. */
export const resetExpandedIndex = (): void => void (cached = null)

type IdleWin = Pick<Window, 'setTimeout'> & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }

/** Opt-in idle build: after the intro has started, in an idle callback (never before). Returns a stop. */
export function scheduleIndexBuild(L: () => Loader, win: IdleWin | undefined = typeof window === 'undefined' ? undefined : window): () => void {
  if (!win) return () => undefined
  let done = false
  const stop = effect(() => {
    if (done || !ui.introSeen.value) return
    done = true
    const run = () => void expandedIndex(L())
    if (typeof win.requestIdleCallback === 'function') win.requestIdleCallback(run, { timeout: 10_000 })
    else win.setTimeout(run, 2_000)
  })
  return stop
}
