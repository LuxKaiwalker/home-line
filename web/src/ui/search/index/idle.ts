// Idle build of the expanded search index (spec rule 5, planning-UI L12). In the first load (the top-bar
// button calls it once on mount), so it stays tiny: a signal effect and a timer. The index code and the
// loader are dynamic imports, fetched only after the intro has started (ui.introSeen turns true when the
// intro begins, story/attach.ts) and the browser is idle. Never during the loading screen or before the intro.
import type { Loader } from '../../../data/loader'
import { effect } from '../../../state/signal'
import { ui } from '../../../state/ui'

export type IdleWin = Pick<Window, 'setTimeout'> & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }

export interface IdleBuildOptions {
  win?: IdleWin
  /** Default: the app loader (data()). */
  loader?: () => Loader | Promise<Loader>
}

const appLoader = async (): Promise<Loader> => (await import('../../../data/loader')).data()

/** Build the expanded index in an idle callback once the intro has started. Returns a stop function. */
export function scheduleIndexBuild({ win = typeof window === 'undefined' ? undefined : window, loader = appLoader }: IdleBuildOptions = {}): () => void {
  if (!win) return () => undefined
  let done = false
  let stopped = false
  const build = async (): Promise<void> => {
    if (stopped) return
    const [{ expandedIndex }, L] = await Promise.all([import('./lazy'), loader()])
    if (!stopped) void expandedIndex(L)
  }
  const stop = effect(() => {
    if (done || !ui.introSeen.value) return
    done = true
    const run = () => void build().catch(() => undefined)
    if (typeof win.requestIdleCallback === 'function') win.requestIdleCallback(run, { timeout: 10_000 })
    else win.setTimeout(run, 2_000)
  })
  return () => {
    stopped = true
    stop()
  }
}
