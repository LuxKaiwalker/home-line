// Command registry (search block S2; docs/design/search.md §3, §5). One list for shortcuts, menus and the
// command palette. The shell installs it once (Shell.tsx); the live layer registers its own commands and
// calls setLiveStatus (waypoint WP17).
import { installAppCommands } from './app'
import { setCommandEnv, installShellCommands, type CommandEnv } from './shell'

export {
  commandForShortcut,
  commands,
  getCommand,
  isEnabled,
  liveStatus,
  reasonFor,
  registerCommand,
  runCommand,
  setLiveStatus,
  type Command,
  type CommandGroup,
  type CommandSource,
  type LiveStatus,
} from './registry'
export { setCommandEnv, viaShortcut, type CommandEnv } from './shell'

let installed = false
/** Register the shell and app commands (once per page; later calls only update navigate / window). */
export function installCommands(win: Window, navigate: (hash: string) => void): void {
  setCommandEnv({ win, navigate } satisfies CommandEnv)
  if (installed) return
  installed = true
  installShellCommands()
  installAppCommands()
}
