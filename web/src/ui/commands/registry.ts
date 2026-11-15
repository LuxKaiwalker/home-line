// Command registry (search block S2; docs/design/search.md §3, §5): one list for shortcuts, menus and the
// command palette. A command names its copy key, icon, group and the keys.ts action it answers; `run` acts
// through the existing stores only (the registry never computes a number). Pure TS on the app's signal
// store; imports nothing from web/src/live/ or web/src/edit/route/ (design rule 6): the live layer imports
// the registry (registerCommand, setLiveStatus), never the reverse.
import { signal, type ReadSignal } from '../../state/signal'
import type { IconName } from '../components'
import type { CopyKey } from '../copy'
import type { ShortcutAction } from '../shell/keys'

export type CommandGroup = 'view' | 'map' | 'timeline' | 'plan' | 'route' | 'export' | 'story' | 'app'
export type CommandSource = 'palette' | 'shortcut' | 'menu' | 'button'

export interface Command {
  /** Stable dotted id: 'mode.plan', 'view.toggle3d', 'route.compute'. */
  id: string
  /** Copy deck key (never a literal string). */
  label: CopyKey
  /** Extra lowercase search words (synonyms), English. */
  keywords?: readonly string[]
  icon: IconName
  group: CommandGroup
  /** The keys.ts action (with its parameter) this command answers, if any. */
  shortcut?: ShortcutAction
  /** Display only; default keysForAction(shortcut) from HELP_ROWS. */
  keys?: readonly string[]
  /** Live-only (spec rule 4): disabled with liveStatus.reason while the API is not reachable. */
  live?: boolean
  /** Reads signals (reactive); default () => true. */
  enabled?: () => boolean
  /** Why it is disabled (shown in the row and announced). */
  reason?: () => CopyKey | null
  run: (src: CommandSource) => void | boolean | Promise<unknown>
  /** 'shell' = runs through keys.ts runShortcut (keys.ts never delegates back to it: no recursion). */
  owner: 'shell' | 'search' | 'design' | 'edit' | 'waypoint'
}

const list = signal<readonly Command[]>([])
/** Every registered command, in registration order. */
export const commands: ReadSignal<readonly Command[]> = list

const DEV = !import.meta.env.PROD

/** Register `c`; returns dispose. A duplicate id throws in dev and tests; in production the last one wins. */
export function registerCommand(c: Command): () => void {
  const cur = list.peek()
  if (cur.some((x) => x.id === c.id)) {
    if (DEV) throw new Error(`command "${c.id}" is already registered`)
    list.value = cur.filter((x) => x.id !== c.id)
  }
  list.value = [...list.peek(), c]
  return () => {
    if (list.peek().includes(c)) list.value = list.peek().filter((x) => x !== c)
  }
}

export const getCommand = (id: string): Command | undefined => list.peek().find((c) => c.id === id)

// ---- Live reachability (set by the live layer's health watch, read by everyone) -------------------
export interface LiveStatus {
  reachable: boolean
  reason: CopyKey | null
}
const live = signal<LiveStatus>({ reachable: false, reason: 'search.live.unknown' })
export const liveStatus: ReadSignal<LiveStatus> = live
export function setLiveStatus(s: LiveStatus): void {
  const p = live.peek()
  if (p.reachable !== s.reachable || p.reason !== s.reason) live.value = { reachable: s.reachable, reason: s.reason }
}

/** Live-only commands need the API; then the command's own condition. Reactive (reads signals). */
export function isEnabled(c: Command): boolean {
  if (c.live && !live.value.reachable) return false
  return c.enabled ? c.enabled() : true
}

/** Why `c` cannot run now: the live reason first, then the command's own; null when it can run. */
export function reasonFor(c: Command): CopyKey | null {
  if (c.live && !live.value.reachable) return live.value.reason ?? 'search.live.unknown'
  if (c.enabled && !c.enabled()) return c.reason?.() ?? null
  return null
}

/** Run a command by id. A disabled or unknown command does nothing and returns false. */
export function runCommand(id: string, src: CommandSource): boolean {
  const c = getCommand(id)
  if (!c || !isEnabled(c)) return false
  void c.run(src)
  return true
}

const sameAction = (a: ShortcutAction, b: ShortcutAction): boolean => {
  if (a.action !== b.action) return false
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  return Object.keys(x).every((k) => x[k] === y[k]) && Object.keys(y).length === Object.keys(x).length
}

/** The command that answers `a` (action and parameter: mode, camera preset, history step, scrub minutes). */
export const commandForShortcut = (a: ShortcutAction): Command | undefined => list.peek().find((c) => c.shortcut && sameAction(c.shortcut, a))

/** Tests only: forget every registration and reset the live status. */
export function resetCommands(): void {
  list.value = []
  live.value = { reachable: false, reason: 'search.live.unknown' }
}
