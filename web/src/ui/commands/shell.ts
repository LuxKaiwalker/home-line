// Shell commands (search block S2; docs/design/search.md §3): modes, 2D/3D, play/pause, timeline steps,
// help, focus mode, camera presets and selection history. Each one runs the keys.ts action through
// runShortcut(...), so keys.ts keeps its logic and the `hl:shortcut` listeners (camera, sidebar history,
// plan-edit undo) handle a chosen row exactly as they handle the key. Esc is not a command: the layout
// store's closeTopmost() owns it. Owner 'shell' = keys.ts never delegates back here (no recursion).
import { canGoBack, canGoForward } from '../../state/selection'
import { SHOWN_MODES, ui, type Mode } from '../../state/ui'
import type { IconName } from '../components'
import { runShortcut, type ShortcutAction } from '../shell/keys'
import { isMapMode } from '../shell/store'
import { registerCommand, type Command } from './registry'

export interface CommandEnv {
  navigate: (hash: string) => void
  /** Where `hl:shortcut` is announced (the shell's window). */
  win?: Window
}

let env: CommandEnv = { navigate: () => {} }
/** The shell's navigate and window, used by every command that runs a shortcut. */
export const setCommandEnv = (e: CommandEnv): void => void (env = e)

/** Run `a` the way the key does: announce `hl:shortcut` (cancelable), then the shell's own handling. */
export function viaShortcut(a: ShortcutAction): boolean {
  const win = env.win
  const announce = (x: ShortcutAction): boolean => {
    if (!win) return false
    const ev = new CustomEvent('hl:shortcut', { detail: x, cancelable: true })
    win.dispatchEvent(ev)
    return ev.defaultPrevented
  }
  return runShortcut(a, { navigate: env.navigate, announce })
}

export const inMapMode = (): boolean => isMapMode(ui.mode.value ?? 'plan')
const inFly = (): boolean => ui.mode.value === 'fly'

type ShortcutCommand = Omit<Command, 'run' | 'owner' | 'shortcut'> & { shortcut: ShortcutAction }
/** A command that runs its keys.ts action (owner 'shell'). */
export const shortcutCommand = (c: ShortcutCommand): Command => ({ ...c, owner: 'shell', run: () => viaShortcut(c.shortcut) })

const MODE_ICON: Readonly<Record<Mode, IconName>> = { plan: 'map', science: 'flask-conical', fly: 'compass', report: 'file-text', evidence: 'shield-check' }

/** The shell's commands, in palette order. */
export function shellCommands(): Command[] {
  const mapOnly = { enabled: inMapMode, reason: () => 'commands.reason.mapOnly' as const }
  const flyOnly = { enabled: inFly, reason: () => 'commands.reason.flyOnly' as const }
  return [
    ...SHOWN_MODES.map((mode) => // hidden modes (state/ui HIDDEN_MODES) have no command
      shortcutCommand({ id: `mode.${mode}`, label: `modes.${mode}.label`, keywords: ['mode', 'view', 'go', mode], icon: MODE_ICON[mode], group: 'view', shortcut: { action: 'mode', mode } }),
    ),
    shortcutCommand({ id: 'view.toggle3d', label: 'shortcuts.toggle3d', keywords: ['3d', '2d', 'terrain', 'view', 'toggle'], icon: 'rotate-3d', group: 'map', shortcut: { action: 'toggle3d' } }),
    shortcutCommand({ id: 'view.focusMode', label: 'buttons.focusMode', keywords: ['focus', 'hide', 'panels', 'distraction'], icon: 'panel-left', group: 'view', shortcut: { action: 'focusMode' } }),
    shortcutCommand({
      id: 'timeline.playPause',
      label: 'shortcuts.playPause',
      keywords: ['play', 'pause', 'clock', 'timeline'],
      icon: 'play',
      group: 'timeline',
      shortcut: { action: 'playPause' },
      ...flyOnly,
    }),
    shortcutCommand({
      id: 'timeline.back',
      label: 'commands.timeline.back',
      keywords: ['scrub', 'step', 'back', 'rewind', 'timeline'],
      icon: 'skip-back',
      group: 'timeline',
      shortcut: { action: 'scrub', minutes: -1 },
      ...flyOnly,
    }),
    shortcutCommand({
      id: 'timeline.forward',
      label: 'commands.timeline.forward',
      keywords: ['scrub', 'step', 'forward', 'timeline'],
      icon: 'skip-forward',
      group: 'timeline',
      shortcut: { action: 'scrub', minutes: 1 },
      ...flyOnly,
    }),
    shortcutCommand({
      id: 'camera.overhead',
      label: 'commands.camera.overhead',
      keywords: ['camera', 'view', 'top', 'north'],
      icon: 'camera',
      group: 'map',
      shortcut: { action: 'camera', preset: 1 },
      ...mapOnly,
    }),
    shortcutCommand({
      id: 'camera.isometric',
      label: 'commands.camera.isometric',
      keywords: ['camera', 'view', 'tilt'],
      icon: 'camera',
      group: 'map',
      shortcut: { action: 'camera', preset: 2 },
      ...mapOnly,
    }),
    shortcutCommand({
      id: 'camera.low',
      label: 'commands.camera.low',
      keywords: ['camera', 'view', 'tilt', 'low'],
      icon: 'camera',
      group: 'map',
      shortcut: { action: 'camera', preset: 3 },
      ...mapOnly,
    }),
    shortcutCommand({
      id: 'camera.focus',
      label: 'commands.camera.focus',
      keywords: ['camera', 'zoom', 'selection', 'focus'],
      icon: 'crosshair',
      group: 'map',
      shortcut: { action: 'camera', preset: 4 },
      ...mapOnly,
    }),
    // follow crew = M10's flythrough (same button, spec Q1): one command, keyword flythrough.
    // D145 narrowed (F13): the Plan map's Flythrough button stays, so this command and key 5 stay
    shortcutCommand({
      id: 'camera.follow',
      label: 'commands.followCrew',
      keywords: ['flythrough', 'follow', 'crew', 'camera', 'fly'],
      icon: 'locate-fixed',
      group: 'map',
      shortcut: { action: 'camera', preset: 5 },
      ...mapOnly,
    }),
    shortcutCommand({
      id: 'selection.back',
      label: 'commands.selection.back',
      keywords: ['back', 'previous', 'history', 'selection'],
      icon: 'chevron-left',
      group: 'app',
      shortcut: { action: 'history', step: -1 },
      enabled: canGoBack,
      reason: () => 'commands.reason.noHistory',
    }),
    shortcutCommand({
      id: 'selection.forward',
      label: 'commands.selection.forward',
      keywords: ['forward', 'next', 'history', 'selection'],
      icon: 'chevron-right',
      group: 'app',
      shortcut: { action: 'history', step: 1 },
      enabled: canGoForward,
      reason: () => 'commands.reason.noHistory',
    }),
    shortcutCommand({ id: 'app.help', label: 'shortcuts.help', keywords: ['help', 'keys', 'keyboard', 'shortcuts'], icon: 'keyboard', group: 'app', shortcut: { action: 'help' } }),
  ]
}

/** Register the shell commands once; returns dispose. */
export function installShellCommands(): () => void {
  const offs = shellCommands().map(registerCommand)
  return () => offs.forEach((f) => f())
}
