// Bridge from the palette's route builder to the waypoint route store (search.md §4.2 route, Q4).
// The ONLY call is `setRouteDraft(stops, 'ordered')` from web/src/edit/route/store.ts (WP12): one
// validated, undoable step. It may not exist yet, so the module is imported dynamically and the function
// is used only when it is there; never the model.ts helpers (they bypass undo and validation).
// Static builds (VITE_LIVE off) never load the edit code: the import sits behind the build flag.

export type RouteStop = { station: string } | { lon: number; lat: number; label?: string }
export interface RouteDraftResult {
  ok: boolean
  problems: readonly unknown[]
}
type SetRouteDraft = (stops: RouteStop[], mode: 'ordered' | 'auto') => RouteDraftResult | Promise<RouteDraftResult>
type Importer = () => Promise<Record<string, unknown>>

const liveBuild = (): boolean => import.meta.env.VITE_LIVE === '1' || import.meta.env.VITE_LIVE === 'true'
/** The route store module, or an empty module in a static build. */
const defaultImporter: Importer = () => (liveBuild() ? (import('../../../edit/route/store') as Promise<Record<string, unknown>>) : Promise.resolve({}))
let importer: Importer = defaultImporter
/** Tests: replace the module loader (null restores the default). */
export const setRouteImporter = (f: Importer | null): void => void (importer = f ?? defaultImporter)

async function find(): Promise<SetRouteDraft | null> {
  try {
    const mod = await importer()
    return typeof mod.setRouteDraft === 'function' ? (mod.setRouteDraft as SetRouteDraft) : null
  } catch {
    return null
  }
}

/** Whether setRouteDraft is available (the palette probes once, live builds only). */
export async function probeRouteDraft(): Promise<'ready' | 'missing'> {
  return (await find()) ? 'ready' : 'missing'
}

/** Choose: hand the stops to the route store. null = the function is missing (nothing changed). */
export async function runRouteDraft(stops: RouteStop[]): Promise<RouteDraftResult | null> {
  const f = await find()
  return f ? await f(stops, 'ordered') : null
}
