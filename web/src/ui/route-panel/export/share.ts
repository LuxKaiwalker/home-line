// PORT U4: the share link (#/?route=…, state/planningUrl.ts planningHref) and copying it.
import { planningHref, type PlanningDoc } from '../../../state/planning'

/** The full share URL of a doc: this page's address with the plan hash ('#/?route=…', '#/' for the default plan). */
export function shareUrl(doc: PlanningDoc, loc: Pick<Location, 'origin' | 'pathname' | 'search'> | null = typeof location === 'undefined' ? null : location): string {
  const hash = planningHref(doc)
  return loc ? `${loc.origin}${loc.pathname}${loc.search}${hash}` : hash
}

export type CopyOutcome = 'copied' | 'select'

export interface ClipboardLike {
  writeText(text: string): Promise<void>
}

const defaultClipboard = (): ClipboardLike | null => {
  const nav = (globalThis as { navigator?: { clipboard?: ClipboardLike } }).navigator
  return nav?.clipboard && typeof nav.clipboard.writeText === 'function' ? nav.clipboard : null
}

/** Copy `text`; 'select' = no clipboard here (or it refused): the panel shows the link selected instead. */
export async function copyText(text: string, clipboard: ClipboardLike | null = defaultClipboard()): Promise<CopyOutcome> {
  if (!clipboard) return 'select'
  try {
    await clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'select'
  }
}
