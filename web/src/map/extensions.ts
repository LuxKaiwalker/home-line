// PORT W0a: ConsoleMap extension points (Notion "Port Mission Planer into Plan" §3 "Map adapters").
// Packages plug into the Plan map from their OWN folders by registering here; nobody but W0a / I1 edits
// consoleMap.ts. ConsoleMap installs every registered extension once its style is loaded (and every one
// registered later at once), forwards setPadEnvironment and the waypoint pointer events, and disposes
// everything on destroy. Nothing registered = behaviour unchanged.
//
//   registerPadEnvironment   P2  map/pads/                 pad markers + env swap (field, bands, edges)
//   registerRouteLayer       R4  map/routes/               'official' | 'mine'
//   registerEditHandlers     R3  edit/route/map/           click = free point, drag, hover
//   registerOverlay          L1a map/overlays/slope/, L1b map/overlays/curiosity/
//   registerBasemap          L1c map/basemaps/
//   registerMapControl       L1a/L1b/L1c/R4: UI in the layer popover or the map-edge toolbar
//
// Registration is usually a side-effect import made by I1 in views/console.tsx
// (`import '../map/routes'`), so wave-1 packages register at module top level or from an exported
// `install()` function I1 calls.
import type { Map as MlMap, Marker } from 'maplibre-gl'
import type { ComponentChildren } from 'preact'
import { signal, type ReadSignal } from '../state/signal'
import type { PadEnv } from '../pads/types'

export type Dispose = () => void

/** Where a layer goes in the style stack (bottom to top). ConsoleMap answers with a beforeId. */
export type MapLayerSlot = 'basemap' | 'overlay' | 'plan' | 'route' | 'edit'

export interface MapExtensionContext {
  map: MlMap
  /** layer id to pass as `beforeId` to map.addLayer so the layer lands in `slot` (undefined = top) */
  beforeId(slot: MapLayerSlot): string | undefined
  /** an HTML marker (pins, labels, drag handles); same factory the overlays use */
  marker(el: HTMLElement): Marker
  /** true inside the app shell (Plan view); false in ?legacy=1 / tests */
  inShell: boolean
}

// ---- pad environment (P2) ----------------------------------------------------------------------

export interface PadEnvironmentHandler {
  id: string
  install(ctx: MapExtensionContext): Dispose
  /** the active pad's env (null = official as loaded by ConsoleMap today); called after install */
  setPadEnvironment(env: PadEnv | null): void
}

// ---- route layers (R4) -------------------------------------------------------------------------

export type RouteLayerKind = 'official' | 'mine'
export interface RouteLayerHandle {
  setVisible(on: boolean): void
  destroy(): void
}
export interface RouteLayerSpec {
  kind: RouteLayerKind
  install(ctx: MapExtensionContext): RouteLayerHandle
}

// ---- waypoint editing (R3) ---------------------------------------------------------------------

export interface MapPointer {
  lon: number
  lat: number
  /** screen px in the map container */
  x: number
  y: number
  originalEvent: MouseEvent | PointerEvent | TouchEvent
}
export interface EditHandlers {
  id: string
  /** higher runs first (default 0); the first handler that returns true consumes the event */
  priority?: number
  /** left click on the map; true = consumed (the free point was added) */
  click?(p: MapPointer): boolean
  /** pointer move without a button down (hover highlight, cursor) */
  hover?(p: MapPointer): void
  /** left button down; true = this handler owns a drag now (map panning is not started) */
  dragStart?(p: MapPointer): boolean
  drag?(p: MapPointer): void
  dragEnd?(p: MapPointer): void
  /** CSS cursor while hovering the map (null = leave it) */
  cursor?(): string | null
}

// ---- overlays and base maps (L1a, L1b, L1c) ----------------------------------------------------

export interface OverlayHandle {
  setVisible(on: boolean): void
  /** 0..1 */
  setOpacity?(v: number): void
  destroy(): void
}
export interface OverlaySpec {
  /** unique id; also the layer popover row id */
  id: string
  /** copy key (route.layers.*) of the row label */
  titleKey: string
  defaultOn: boolean
  /** false = not offered (feature flag; e.g. Curiosity is behind a flag) */
  enabled?: () => boolean
  /** replaces a built-in overlay (map/overlays/catalog.ts id, e.g. 'slopeClass'): that one is hidden */
  replaces?: string
  install(ctx: MapExtensionContext): OverlayHandle
}

export interface BasemapHandle {
  activate(): void
  deactivate(): void
  destroy(): void
}
export interface BasemapSpec {
  id: string
  titleKey: string
  /** the base map shown when nothing else is chosen (the existing satellite basemap: none registered) */
  isDefault?: boolean
  install(ctx: MapExtensionContext): BasemapHandle
}

// ---- UI controls (layer popover / map-edge toolbar) ---------------------------------------------

export type MapControlSlot = 'layers-popover' | 'map-edge'
export interface MapControlSpec {
  id: string
  slot: MapControlSlot
  /** lower first */
  order: number
  render(): ComponentChildren
}

// ---- registry ----------------------------------------------------------------------------------

type Registered = { pad: PadEnvironmentHandler[]; routes: RouteLayerSpec[]; edit: EditHandlers[]; overlays: OverlaySpec[]; basemaps: BasemapSpec[] }
const reg: Registered = { pad: [], routes: [], edit: [], overlays: [], basemaps: [] }
const controls = signal<readonly MapControlSpec[]>([])
/** maps currently installed (ConsoleMap instances): a late registration installs on them at once */
const hosts = new Set<MapHost>()

function add<K extends keyof Registered>(k: K, v: Registered[K][number]): Dispose {
  ;(reg[k] as unknown[]).push(v)
  for (const h of hosts) h.added(k, v)
  return () => {
    const i = (reg[k] as unknown[]).indexOf(v)
    if (i >= 0) (reg[k] as unknown[]).splice(i, 1)
    for (const h of hosts) h.removed(v)
  }
}

export const registerPadEnvironment = (h: PadEnvironmentHandler): Dispose => add('pad', h)
export const registerRouteLayer = (s: RouteLayerSpec): Dispose => add('routes', s)
export const registerEditHandlers = (h: EditHandlers): Dispose => add('edit', h)
const replaced = signal<ReadonlySet<string>>(new Set())
const syncReplaced = () => void (replaced.value = new Set(reg.overlays.flatMap((o) => (o.replaces ? [o.replaces] : []))))
export function registerOverlay(s: OverlaySpec): Dispose {
  const off = add('overlays', s)
  syncReplaced()
  return () => {
    off()
    syncReplaced()
  }
}
/** PORT I1: the built-in overlay ids (map/overlays/catalog.ts) replaced by a registered overlay (`replaces`,
 *  e.g. L1a's slope → 'slopeClass'): the layer manager hides their rows and keeps them off. */
export const replacedOverlays: ReadSignal<ReadonlySet<string>> = replaced
export const registerBasemap = (s: BasemapSpec): Dispose => add('basemaps', s)
export function registerMapControl(c: MapControlSpec): Dispose {
  controls.value = [...controls.peek().filter((x) => x.id !== c.id), c].sort((a, b) => a.order - b.order)
  return () => void (controls.value = controls.peek().filter((x) => x !== c))
}
/** The registered controls (I1 renders them in the layer popover / map-edge toolbar). */
export const mapControls: ReadSignal<readonly MapControlSpec[]> = controls
export const mapControlsIn = (slot: MapControlSlot): MapControlSpec[] => controls.peek().filter((c) => c.slot === slot)

/** Test helper: forget every registration. */
export function resetMapExtensions(): void {
  for (const k of Object.keys(reg) as (keyof Registered)[]) reg[k].length = 0
  controls.value = []
  replaced.value = new Set()
}

// ---- host (used by ConsoleMap only) ------------------------------------------------------------

export interface MapHost {
  /** forward the active pad env to every pad handler */
  setPadEnvironment(env: PadEnv | null): void
  /** route layer handles by kind (R4's toggles; planning view.showOfficial / showMine) */
  routeLayer(kind: RouteLayerKind): RouteLayerHandle | undefined
  overlay(id: string): OverlayHandle | undefined
  basemap(id: string): BasemapHandle | undefined
  /** @internal registry callbacks */
  added<K extends keyof Registered>(k: K, v: Registered[K][number]): void
  removed(v: unknown): void
  destroy(): void
}

const toPointer = (e: { lngLat: { lng: number; lat: number }; point: { x: number; y: number }; originalEvent: MouseEvent | TouchEvent }): MapPointer => ({ lon: e.lngLat.lng, lat: e.lngLat.lat, x: e.point.x, y: e.point.y, originalEvent: e.originalEvent })

/** Install every registered extension on `ctx.map`; ConsoleMap calls this once the style is loaded. */
export function installMapExtensions(ctx: MapExtensionContext): MapHost {
  const disposers = new Map<unknown, Dispose>()
  const routeHandles = new Map<RouteLayerKind, RouteLayerHandle>()
  const overlayHandles = new Map<string, OverlayHandle>()
  const basemapHandles = new Map<string, BasemapHandle>()
  let env: PadEnv | null = null
  let dragging: EditHandlers | null = null

  const installOne = (k: keyof Registered, v: unknown) => {
    if (k === 'pad') {
      const h = v as PadEnvironmentHandler
      disposers.set(h, h.install(ctx))
      if (env) h.setPadEnvironment(env)
    } else if (k === 'routes') {
      const s = v as RouteLayerSpec
      const handle = s.install(ctx)
      routeHandles.set(s.kind, handle)
      disposers.set(s, () => {
        handle.destroy()
        if (routeHandles.get(s.kind) === handle) routeHandles.delete(s.kind)
      })
    } else if (k === 'overlays') {
      const s = v as OverlaySpec
      if (s.enabled && !s.enabled()) return
      const handle = s.install(ctx)
      handle.setVisible(s.defaultOn)
      overlayHandles.set(s.id, handle)
      disposers.set(s, () => {
        handle.destroy()
        overlayHandles.delete(s.id)
      })
    } else if (k === 'basemaps') {
      const s = v as BasemapSpec
      const handle = s.install(ctx)
      basemapHandles.set(s.id, handle)
      disposers.set(s, () => {
        handle.destroy()
        basemapHandles.delete(s.id)
      })
    }
    // 'edit' handlers need no install: the pointer listeners below read the registry
  }

  const edits = () => [...reg.edit].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
  type Ev = Parameters<typeof toPointer>[0]
  const onClick = (e: Ev) => void edits().some((h) => h.click?.(toPointer(e)))
  const onMove = (e: Ev) => {
    const p = toPointer(e)
    if (dragging) return dragging.drag?.(p)
    let cursor: string | null = null
    for (const h of edits()) {
      h.hover?.(p)
      cursor ??= h.cursor?.() ?? null
    }
    if (reg.edit.length) ctx.map.getCanvas().style.cursor = cursor ?? ''
  }
  const onDown = (e: Ev) => {
    if ((e.originalEvent as MouseEvent).button !== 0 && !('touches' in e.originalEvent)) return
    dragging = edits().find((h) => h.dragStart?.(toPointer(e))) ?? null
  }
  const onUp = (e: Ev) => {
    if (!dragging) return
    dragging.dragEnd?.(toPointer(e))
    dragging = null
  }
  const m = ctx.map as unknown as { on(t: string, f: (e: Ev) => void): void; off(t: string, f: (e: Ev) => void): void }
  const listeners: [string, (e: Ev) => void][] = [['click', onClick], ['mousemove', onMove], ['mousedown', onDown], ['mouseup', onUp], ['touchstart', onDown], ['touchmove', onMove], ['touchend', onUp]]
  for (const [t, f] of listeners) m.on(t, f)

  for (const k of Object.keys(reg) as (keyof Registered)[]) for (const v of reg[k]) installOne(k, v)

  const host: MapHost = {
    setPadEnvironment(next) {
      env = next
      for (const h of reg.pad) if (disposers.has(h)) h.setPadEnvironment(next)
    },
    routeLayer: (kind) => routeHandles.get(kind),
    overlay: (id) => overlayHandles.get(id),
    basemap: (id) => basemapHandles.get(id),
    added: (k, v) => installOne(k, v),
    removed(v) {
      disposers.get(v)?.()
      disposers.delete(v)
      if (dragging === v) dragging = null
    },
    destroy() {
      hosts.delete(host)
      for (const [t, f] of listeners) m.off(t, f)
      for (const d of disposers.values()) d()
      disposers.clear()
    },
  }
  hosts.add(host)
  return host
}
