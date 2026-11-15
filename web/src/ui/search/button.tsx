// Top-bar search button + palette host (DESIGN U17, §4.4 Ctrl+K and /; package A8). This is the only part
// in the first load: a button and a `hl:shortcut` listener. The palette, its index and styles load on
// first open (palette.tsx chunk). The shell registers it with one element in its top bar (Shell.tsx).
import type { ComponentType } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { IconButton } from '../components'
import { t } from '../copy'
import { scheduleIndexBuild } from './index/idle'
import type { PaletteProps } from './palette'

type PaletteC = ComponentType<PaletteProps>
let loaded: PaletteC | null = null
export const loadPalette = (): Promise<PaletteC> => import('./palette').then((m) => (loaded = m.Palette))

const defaultNavigate = (hash: string): void => {
  if (location.hash !== hash) location.hash = hash
}
let commandsInstalled: Promise<void> | null = null
/** S2: install the command registry (ui/commands, its own lazy chunk) once per page. The button is always in
 *  the shell's top bar, so this is the one install point; it is never uninstalled (focus mode, re-renders). */
export function installCommandsOnce(win: Window, navigate: (hash: string) => void = defaultNavigate): Promise<void> {
  return (commandsInstalled ??= import('../commands').then(
    (m) => m.installCommands(win, navigate),
    () => void (commandsInstalled = null), // chunk failed to load: the next mount retries
  ))
}

/** Warm the palette chunk when the pointer or focus reaches the button (never on page load: perf test). */
const prefetch = (): void => void (loaded || loadPalette().catch(() => {}))

export interface SearchButtonProps {
  win?: Window
  /** Passed to the palette (tests). */
  palette?: Omit<PaletteProps, 'onClose'>
}

export function SearchButton({ win = typeof window === 'undefined' ? undefined : window, palette }: SearchButtonProps) {
  const [open, setOpen] = useState(false)
  const [P, setP] = useState<PaletteC | null>(() => loaded)
  // L12: the expanded index builds in an idle callback after the intro has started (index/idle.ts), or on first open
  const pl = palette?.loader
  useEffect(() => scheduleIndexBuild({ win, loader: pl && (() => pl) }), [])
  useEffect(() => void (win && installCommandsOnce(win)), [])
  useEffect(() => {
    if (!win) return
    // §4.4: Ctrl+K and / arrive as the shell's cancelable `hl:shortcut` action 'search' (keys.ts).
    const on = (e: Event) => {
      if ((e as CustomEvent<{ action?: string }>).detail?.action !== 'search') return
      e.preventDefault()
      setOpen((o) => !o)
    }
    win.addEventListener('hl:shortcut', on)
    return () => win.removeEventListener('hl:shortcut', on)
  }, [win])
  useEffect(() => {
    if (open && !P) void loadPalette().then((c) => setP(() => c))
  }, [open])
  return (
    <>
      <IconButton icon="search" label={t('nav.search')} title={t('hints.shell.search')} aria-haspopup="dialog" aria-expanded={open ? 'true' : 'false'} aria-keyshortcuts="Control+K Meta+K /" onPointerEnter={prefetch} onFocus={prefetch} onClick={() => setOpen(true)} />
      {open && P && <P {...palette} win={palette?.win ?? win} onClose={() => setOpen(false)} />}
    </>
  )
}
