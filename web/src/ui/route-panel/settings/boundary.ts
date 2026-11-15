// PORT U3: the reachable-area boundary list (port of mission/plan.ts boundaryOptions). The Mission tab
// offered every boundary its scenario files held: homeline bands (budget × variant), the edge
// coloured by cause per budget, and isochrones. The Plan port reads the active pad's plan products
// (pads/ PadEnv.planProducts(): bands + edges); isochrones are not part of PlanProducts, so they
// appear only when a caller passes them. The store keeps the id (planning.setBoundary); undefined
// (or 'none') = no boundary. Ids are the Mission tab's: 'band:30:nominal', 'edges:30', 'iso:4'.
import type { BandsFC, EdgesFC } from '../../../data/types'
import { t } from '../../copy'


export type BoundaryOption =
  | { kind: 'none'; id: 'none'; label: string }
  | { kind: 'band'; id: string; label: string; budget: number; variant: string }
  | { kind: 'iso'; id: string; label: string; minutes: number }
  | { kind: 'edges'; id: string; label: string; budget: number }

/** Minimal isochrone collection (scenarios/<id>/isochrones.geojson): only `minutes` is read. */
export interface IsochroneLike {
  features: readonly { properties: unknown }[]
}

const VARIANT_ORDER = ['conservative', 'nominal', 'optimistic']

/** Every boundary the pad's files hold, 'none' first; same order and ids as the Mission tab. */
export function boundaryOptions(bands: BandsFC | null | undefined, edges: EdgesFC | null | undefined, isochrones?: IsochroneLike | null): BoundaryOption[] {
  const out: BoundaryOption[] = [{ kind: 'none', id: 'none', label: t('route.settings.boundary.none') }]
  const bandKeys = new Map<string, { budget: number; variant: string }>()
  for (const f of bands?.features ?? []) {
    const p = f.properties as { budget?: unknown; variant?: unknown } | null
    if (p && typeof p.budget === 'number' && typeof p.variant === 'string') bandKeys.set(`${p.budget}:${p.variant}`, { budget: p.budget, variant: p.variant })
  }
  ;[...bandKeys.values()]
    .sort((a, b) => a.budget - b.budget || VARIANT_ORDER.indexOf(a.variant) - VARIANT_ORDER.indexOf(b.variant))
    .forEach((b) => out.push({ kind: 'band', id: `band:${b.budget}:${b.variant}`, label: t('route.settings.boundary.band', { budget: b.budget, variant: b.variant }), ...b }))
  const edgeBudgets = new Set<number>()
  for (const f of edges?.features ?? []) {
    const b = (f.properties as { budget?: unknown } | null)?.budget
    if (typeof b === 'number') edgeBudgets.add(b)
  }
  ;[...edgeBudgets].sort((a, b) => a - b).forEach((b) => out.push({ kind: 'edges', id: `edges:${b}`, label: t('route.settings.boundary.edges', { budget: b }), budget: b }))
  const mins = new Set<number>()
  for (const f of isochrones?.features ?? []) {
    const m = (f.properties as { minutes?: unknown } | null)?.minutes
    if (typeof m === 'number') mins.add(m)
  }
  ;[...mins].sort((a, b) => a - b).forEach((m) => out.push({ kind: 'iso', id: `iso:${m}`, label: t('route.settings.boundary.iso', { minutes: m }), minutes: m }))
  return out
}

/** The select's value for the store's boundary (unknown ids show as 'none'). */
export const boundaryValue = (opts: readonly BoundaryOption[], id: string | undefined): string => (id && opts.some((o) => o.id === id) ? id : 'none')
/** The select's value back to the store ('none' = undefined). */
export const boundaryFromValue = (v: string): string | undefined => (v === 'none' || v === '' ? undefined : v)
