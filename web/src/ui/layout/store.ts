// Layout store (planning-UI declutter, package L1, D111): the open state of every layout container
// (Drawer, BottomDrawer, MarkerCard, Popover, Collapsible) in one place, so the rules hold app-wide:
//   - at most one drawer per side (right, bottom) is open; opening a second closes the first;
//   - one MarkerCard at a time, one map-edge Popover at a time;
//   - Esc closes the topmost open container (the one opened last) and returns focus to its opener;
//   - drawers, the bottom drawer (expanded + tab) and collapsible sections remember their state per
//     viewer; cards and popovers are transient (they belong to a selection) and are not remembered;
//   - layoutInsets / onLayoutChange give the map area the open drawers cover (px from the right and
//     bottom edge), so the map can recentre to keep the route visible (L2).
// Persistence goes through bindLayoutStorage(get): until something binds a storage, nothing is read or
// written and the defaults hold. Every storage access (the accessor itself included) is inside try:
// blocked site data, private mode, a full quota or unreadable JSON all fall back to the defaults.
// Binding the browser's storage needs the privacy note and its test to name this file (see the L1 PR).
import { useLayoutEffect, useRef } from 'preact/hooks'
import { computed, signal, useSignalValue, type ReadSignal } from '../../state/signal'

export type ContainerKind = 'drawer' | 'card' | 'popover' | 'section'
export type DrawerSide = 'right' | 'bottom'

export interface ContainerSpec {
  /** Unique id (also the base of DOM ids). */
  id: string
  kind: ContainerKind
  /** Drawers only: the map side it covers (one open drawer per side). */
  side?: DrawerSide
  /** Initial state when nothing is remembered (default false). */
  defaultOpen?: boolean
  /** Remember open/closed per viewer (default: drawers and sections yes, cards and popovers no). */
  persist?: boolean
}

export interface LayoutInsets {
  /** px of the map width covered from the right edge by the open right drawer (0 = none). */
  right: number
  /** px of the map height covered from the bottom edge by the bottom drawer (collapsed bar included). */
  bottom: number
}

/** The parts of Web Storage the store uses. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/** Storage key (versioned: a later layout gets a new key instead of misreading this one). */
export const LAYOUT_KEY = 'hl.layout.v1'

/** Section 4 rules (Notion L0–L9 plan): what an open container may cover of the map. */
export const LAYOUT_LIMITS = {
  /** an open right drawer leaves at least 60 % of the map width */
  drawerMaxWidthShare: 0.4,
  /** the expanded bottom drawer covers at most 40 % of the height */
  bottomMaxHeightShare: 0.4,
} as const

interface Saved {
  open: Record<string, boolean>
  tabs: Record<string, string>
}

const specs = new Map<string, Required<Omit<ContainerSpec, 'side'>> & { side?: DrawerSide }>()
const openers = new Map<string, HTMLElement | null>()
const mounts = new Map<string, number>()
let getStorage: () => StorageLike | null = () => null
let saved: Saved = { open: {}, tabs: {} }

const openSig = signal<Readonly<Record<string, boolean>>>({})
const stackSig = signal<readonly string[]>([])
const tabSig = signal<Readonly<Record<string, string>>>({})
const sizeSig = signal<Readonly<Record<string, Partial<LayoutInsets>>>>({})

/** Read-only views of the store (subscribe, or useSignalValue in components). */
export const layout = {
  /** id → open, for every registered container */
  open: openSig as ReadSignal<Readonly<Record<string, boolean>>>,
  /** open containers that Esc can close, oldest first (the last one is the topmost) */
  stack: stackSig as ReadSignal<readonly string[]>,
  /** bottom drawer id → active tab id */
  tabs: tabSig as ReadSignal<Readonly<Record<string, string>>>,
}

/** Map insets covered by the open, mounted drawers (max per side). */
export const layoutInsets: ReadSignal<LayoutInsets> = computed(() => {
  const open = openSig.value
  const sizes = sizeSig.value
  let right = 0
  let bottom = 0
  for (const [id, s] of Object.entries(sizes)) {
    const spec = specs.get(id)
    // the bottom drawer covers its collapsed bar too, so its inset counts when closed
    if (!open[id] && !(spec?.kind === 'drawer' && spec.side === 'bottom')) continue
    right = Math.max(right, s.right ?? 0)
    bottom = Math.max(bottom, s.bottom ?? 0)
  }
  return { right, bottom }
})

/** Calls fn with the new insets whenever the covered map area changes. Returns unsubscribe. */
export function onLayoutChange(fn: (insets: LayoutInsets) => void): () => void {
  let last = layoutInsets.peek()
  return layoutInsets.subscribe((v) => {
    if (v.right === last.right && v.bottom === last.bottom) return
    last = v
    fn(v)
  })
}

// ---------------------------------------------------------------- persistence

function readSaved(): Saved {
  const empty: Saved = { open: {}, tabs: {} }
  try {
    const s = getStorage()
    const raw = s ? s.getItem(LAYOUT_KEY) : null
    if (!raw) return empty
    const v = JSON.parse(raw) as Partial<Saved> | null
    const open: Record<string, boolean> = {}
    const tabs: Record<string, string> = {}
    if (v && typeof v.open === 'object' && v.open) for (const [k, b] of Object.entries(v.open)) if (typeof b === 'boolean') open[k] = b
    if (v && typeof v.tabs === 'object' && v.tabs) for (const [k, t] of Object.entries(v.tabs)) if (typeof t === 'string') tabs[k] = t
    return { open, tabs }
  } catch {
    return empty
  }
}

function writeSaved(): void {
  try {
    const s = getStorage()
    if (s) s.setItem(LAYOUT_KEY, JSON.stringify(saved))
  } catch {
    // storage blocked or full: the state holds for this page only
  }
}

/**
 * Where the open/closed state is remembered. `get` is called on every access (inside try), so a
 * storage that disappears or starts throwing only loses the memory, never the layout. Re-reads the
 * remembered state (containers registered later start from it). Pass () => null to forget nothing and
 * remember nothing.
 */
export function bindLayoutStorage(get: () => StorageLike | null): void {
  getStorage = get
  saved = readSaved()
}

// ---------------------------------------------------------------- registry

const persists = (s: ContainerSpec): boolean => s.persist ?? (s.kind === 'drawer' || s.kind === 'section')
/** Containers that exclude each other: one per drawer side, one card, one popover. */
const group = (id: string): string | undefined => {
  const s = specs.get(id)
  if (!s) return undefined
  return s.kind === 'drawer' ? `drawer:${s.side ?? 'right'}` : s.kind === 'card' || s.kind === 'popover' ? s.kind : undefined
}

/**
 * Declare a container (idempotent; the components call it on their first render). Its initial state is
 * the remembered one, else defaultOpen; when that would break a one-per-side rule, it starts closed.
 */
export function registerContainer(spec: ContainerSpec): void {
  if (specs.has(spec.id)) return
  const full = { ...spec, defaultOpen: spec.defaultOpen ?? false, persist: persists(spec) }
  specs.set(spec.id, full)
  let open = (full.persist ? saved.open[spec.id] : undefined) ?? full.defaultOpen
  const g = group(spec.id)
  if (open && g && Object.entries(openSig.peek()).some(([id, o]) => o && id !== spec.id && group(id) === g)) open = false
  openSig.value = { ...openSig.peek(), [spec.id]: open }
  if (open && full.kind !== 'section') stackSig.value = [...stackSig.peek(), spec.id]
  if (full.persist && saved.tabs[spec.id] !== undefined) tabSig.value = { ...tabSig.peek(), [spec.id]: saved.tabs[spec.id] }
}

export const isOpen = (id: string): boolean => openSig.peek()[id] ?? false
export const containerSpec = (id: string): ContainerSpec | undefined => specs.get(id)

function setOpen(id: string, open: boolean): void {
  const spec = specs.get(id)
  if (!spec) throw new Error(`layout: no container "${id}" (registerContainer first)`)
  openSig.value = { ...openSig.peek(), [id]: open }
  const rest = stackSig.peek().filter((x) => x !== id)
  stackSig.value = open && spec.kind !== 'section' ? [...rest, id] : rest
  if (spec.persist) {
    saved = { ...saved, open: { ...saved.open, [id]: open } }
    writeSaved()
  }
}

const activeElement = (): HTMLElement | null => {
  try {
    return (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null) ?? null
  } catch {
    return null
  }
}

/**
 * Open a container. `opener` gets the focus back when it closes (default: the focused element). Closes
 * the other drawer on the same side, the other card or the other popover.
 */
export function openContainer(id: string, opener: HTMLElement | null = activeElement()): void {
  const g = group(id)
  if (g) for (const [other, o] of Object.entries(openSig.peek())) if (o && other !== id && group(other) === g) closeContainer(other, { restoreFocus: false })
  openers.set(id, opener)
  if (!isOpen(id)) setOpen(id, true)
  else stackSig.value = [...stackSig.peek().filter((x) => x !== id), id] // reopened: topmost again
}

/** Close a container; by default focus returns to the element that opened it. */
export function closeContainer(id: string, { restoreFocus = true }: { restoreFocus?: boolean } = {}): void {
  if (!isOpen(id)) return
  setOpen(id, false)
  const el = openers.get(id)
  openers.delete(id)
  if (restoreFocus && el && el.isConnected !== false) el.focus()
}

export function toggleContainer(id: string, opener?: HTMLElement | null): void {
  if (isOpen(id)) closeContainer(id)
  else openContainer(id, opener ?? activeElement())
}

/** Esc: close the topmost open container (sections are not in the stack). True when one closed. */
export function closeTopmost(): boolean {
  const stack = stackSig.peek().filter((id) => (mounts.get(id) ?? 0) > 0)
  const top = stack[stack.length - 1]
  if (top === undefined) return false
  closeContainer(top)
  return true
}

/** The bottom drawer's tab (remembered with its open state). */
export function setActiveTab(id: string, tab: string): void {
  tabSig.value = { ...tabSig.peek(), [id]: tab }
  if (specs.get(id)?.persist) {
    saved = { ...saved, tabs: { ...saved.tabs, [id]: tab } }
    writeSaved()
  }
}

/** A drawer reports the px it covers (0 / undefined = nothing). */
export function reportInset(id: string, inset: Partial<LayoutInsets> | undefined): void {
  const cur = sizeSig.peek()
  if (!inset) {
    if (!(id in cur)) return
    const next = { ...cur }
    delete next[id]
    sizeSig.value = next
    return
  }
  const old = cur[id]
  if (old && old.right === inset.right && old.bottom === inset.bottom) return
  sizeSig.value = { ...cur, [id]: { right: inset.right, bottom: inset.bottom } }
}

/** Components count as mounted while rendered: only mounted containers are closed by Esc. */
export function mountContainer(id: string): () => void {
  mounts.set(id, (mounts.get(id) ?? 0) + 1)
  return () => {
    const n = (mounts.get(id) ?? 1) - 1
    if (n > 0) mounts.set(id, n)
    else {
      mounts.delete(id)
      reportInset(id, undefined)
    }
  }
}

export interface LayoutKeyOptions {
  /** Another layer handles Esc first (e.g. the shell's help dialog is open). */
  blocked?: () => boolean
}

/**
 * Esc closes the topmost container. Install once per window (the shell or a page that mounts
 * containers). The handler skips events already handled (defaultPrevented) and marks its own.
 */
export function installLayoutKeys(win: Pick<Window, 'addEventListener' | 'removeEventListener'>, opts: LayoutKeyOptions = {}): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || opts.blocked?.()) return
    if (closeTopmost()) e.preventDefault()
  }
  win.addEventListener('keydown', onKey as EventListener)
  return () => win.removeEventListener('keydown', onKey as EventListener)
}

/** Tests and the style guide: forget every container (as after a page load) and re-read the storage. */
export function resetLayout(): void {
  specs.clear()
  openers.clear()
  mounts.clear()
  saved = readSaved()
  openSig.value = {}
  stackSig.value = []
  tabSig.value = {}
  sizeSig.value = {}
}

// ---------------------------------------------------------------- Preact hooks

/** Register (first render), count as mounted, and return the live open state. */
export function useContainer(spec: ContainerSpec): boolean {
  registerContainer(spec)
  useLayoutEffect(() => mountContainer(spec.id), [spec.id])
  return useSignalValue(openSig)[spec.id] ?? false
}

/** Live insets for components (e.g. a map wrapper that pads its camera). */
export function useLayoutInsets(): LayoutInsets {
  return useSignalValue(layoutInsets)
}

/** Live active tab of a bottom drawer. */
export function useActiveTab(id: string, fallback: string): string {
  return useSignalValue(tabSig)[id] ?? fallback
}

/**
 * Props for any button that opens a container (the opener gets focus back on close):
 * aria-expanded, aria-controls and a click that toggles. `<button {...useOpener('edit-route')}>`.
 */
export function useOpener(id: string): { 'aria-expanded': 'true' | 'false'; 'aria-controls': string; onClick: (e: MouseEvent) => void } {
  const open = useSignalValue(openSig)[id] ?? false
  const ref = useRef(id)
  ref.current = id
  return {
    'aria-expanded': open ? 'true' : 'false',
    'aria-controls': domId(id),
    onClick: (e: MouseEvent) => toggleContainer(ref.current, e.currentTarget as HTMLElement),
  }
}

/** DOM id of a container's element (ids may hold ':' or spaces; DOM ids here keep [A-Za-z0-9_-]). */
export const domId = (id: string, part = ''): string => `hl-lay-${id.replace(/[^A-Za-z0-9_-]/g, '_')}${part ? `-${part}` : ''}`
