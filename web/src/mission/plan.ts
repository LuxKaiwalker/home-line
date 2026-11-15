// Mission Planer state helpers (pure): waypoints in order, legs between them (pad -> #1 -> #2 ...),
// a leg cache so moving one waypoint re-routes only its two legs, and the boundary options.
import type { BandsFC, EdgesFC, IsochroneFC } from '../data/types'
import type { Leg } from './router'

export type LonLat = [number, number]

export interface Waypoint {
  id: number
  lon: number
  lat: number
  /** cell index on the routing grid */
  cell: number
  /** free-text note: what is to be done there */
  note: string
  /** quick activity tags (labels only; they do not change any number) */
  tags: string[]
  /** planned time at the waypoint (min): station work at the station task rate (budget.ts) */
  stopMin: number
  /** science station id when added from a station */
  station?: string
}

/** Quick tags offered on every waypoint (UI labels, no numbers attached). */
export const WAYPOINT_TAGS = ['Sample', 'Drill', 'Photo', 'Survey', 'Install', 'Inspect', 'Repair', 'Rest'] as const

/** Toggle a tag on or off, keeping WAYPOINT_TAGS order. */
export function toggleTag(tags: string[], tag: string): string[] {
  const on = new Set(tags)
  if (on.has(tag)) on.delete(tag)
  else on.add(tag)
  const known = WAYPOINT_TAGS.filter((t) => on.has(t))
  return [...known, ...[...on].filter((t) => !(WAYPOINT_TAGS as readonly string[]).includes(t))]
}

/** Order list helpers: never mutate. */
export function moveWaypoint<T>(list: T[], i: number, delta: -1 | 1): T[] {
  const j = i + delta
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list
  const out = list.slice()
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}
export function removeWaypoint<T>(list: T[], i: number): T[] {
  return i < 0 || i >= list.length ? list : [...list.slice(0, i), ...list.slice(i + 1)]
}
export function replaceWaypoint<T>(list: T[], i: number, w: T): T[] {
  return i < 0 || i >= list.length ? list : list.map((x, k) => (k === i ? w : x))
}

/** Cell pairs of the legs: pad -> w1, w1 -> w2, ... */
export function legPairs(padCell: number, wps: Pick<Waypoint, 'cell'>[]): [number, number][] {
  const out: [number, number][] = []
  let prev = padCell
  for (const w of wps) {
    out.push([prev, w.cell])
    prev = w.cell
  }
  return out
}

/** Route every leg, reusing cached ones (key "from-to"); the cache is updated in place. */
export function routeLegs(pairs: [number, number][], route: (a: number, b: number) => Leg | null, cache: Map<string, Leg | null>): (Leg | null)[] {
  return pairs.map(([a, b]) => {
    const k = `${a}-${b}`
    if (!cache.has(k)) cache.set(k, route(a, b))
    return cache.get(k)!
  })
}

// ---------------------------------------------------------------- boundary picker

export type BoundaryOption =
  | { kind: 'none'; id: 'none'; label: string }
  | { kind: 'band'; id: string; label: string; budget: number; variant: string }
  | { kind: 'iso'; id: string; label: string; minutes: number }
  | { kind: 'edges'; id: string; label: string; budget: number }

const VARIANT_ORDER = ['conservative', 'nominal', 'optimistic']

/** Every boundary the scenario files hold: homeline bands (budget x variant), edge causes, isochrones. */
export function boundaryOptions(bands: BandsFC | null, isochrones: IsochroneFC | null, edges: EdgesFC | null): BoundaryOption[] {
  const out: BoundaryOption[] = [{ kind: 'none', id: 'none', label: 'No boundary' }]
  const bandKeys = new Map<string, { budget: number; variant: string }>()
  for (const f of bands?.features ?? []) {
    const p = f.properties as { budget?: number; variant?: string } | null
    if (p && typeof p.budget === 'number' && typeof p.variant === 'string') bandKeys.set(`${p.budget}:${p.variant}`, { budget: p.budget, variant: p.variant })
  }
  ;[...bandKeys.values()]
    .sort((a, b) => a.budget - b.budget || VARIANT_ORDER.indexOf(a.variant) - VARIANT_ORDER.indexOf(b.variant))
    .forEach((b) => out.push({ kind: 'band', id: `band:${b.budget}:${b.variant}`, label: `${b.budget}-min walk home, ${b.variant}`, ...b }))
  const edgeBudgets = new Set<number>()
  for (const f of edges?.features ?? []) {
    const b = (f.properties as { budget?: number } | null)?.budget
    if (typeof b === 'number') edgeBudgets.add(b)
  }
  ;[...edgeBudgets].sort((a, b) => a - b).forEach((b) => out.push({ kind: 'edges', id: `edges:${b}`, label: `${b}-min edge, coloured by cause`, budget: b }))
  const mins = new Set<number>()
  for (const f of isochrones?.features ?? []) {
    const m = (f.properties as { minutes?: number } | null)?.minutes
    if (typeof m === 'number') mins.add(m)
  }
  ;[...mins].sort((a, b) => a - b).forEach((m) => out.push({ kind: 'iso', id: `iso:${m}`, label: `${m}-min isochrone`, minutes: m }))
  return out
}

/** The boundary as the Layers panel picks it (user 2026-11-15): on/off, walk-home budget, band or cause edge, estimate. */
export interface BoundarySel {
  on: boolean
  budget: number
  kind: 'band' | 'edges'
  /** band estimate (conservative / nominal / optimistic); edges have one estimate only */
  variant: string
}

/** The chips the Layers panel offers: budgets with a band or an edge, kinds present, estimates of the bands (in order). */
export function boundaryChoices(opts: BoundaryOption[]): { budgets: number[]; kinds: ('band' | 'edges')[]; variants: string[] } {
  const budgets = new Set<number>()
  const kinds = new Set<'band' | 'edges'>()
  const variants = new Set<string>()
  for (const o of opts) {
    if (o.kind === 'band') {
      budgets.add(o.budget)
      kinds.add('band')
      variants.add(o.variant)
    } else if (o.kind === 'edges') {
      budgets.add(o.budget)
      kinds.add('edges')
    }
  }
  return {
    budgets: [...budgets].sort((a, b) => a - b),
    kinds: (['band', 'edges'] as const).filter((k) => kinds.has(k)),
    variants: [...variants].sort((a, b) => VARIANT_ORDER.indexOf(a) - VARIANT_ORDER.indexOf(b)),
  }
}

/** The option to draw for a selection; undefined when off or when the files hold no such boundary. */
export function pickBoundary(opts: BoundaryOption[], sel: BoundarySel): BoundaryOption | undefined {
  if (!sel.on) return undefined
  if (sel.kind === 'edges') return opts.find((o) => o.kind === 'edges' && o.budget === sel.budget)
  return opts.find((o) => o.kind === 'band' && o.budget === sel.budget && o.variant === sel.variant)
}

/** Default: the Plan page's default band (30-min nominal) when present, else the first band, else none. */
export function defaultBoundary(opts: BoundaryOption[], budget: number): string {
  return (opts.find((o) => o.kind === 'band' && o.budget === budget && o.variant === 'nominal') ?? opts.find((o) => o.kind === 'band') ?? opts[0]).id
}
