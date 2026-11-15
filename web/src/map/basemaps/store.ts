// L1c: which base map the Plan map shows. Satellite (the HiRISE basemap ConsoleMap already loads) stays
// the default, so nothing changes until the user picks Topography or Material. Kept in memory only.
import { signal, type ReadSignal } from '../../state/signal'
import type { ReliefMode, Relief, Unit } from './relief'

export const BASEMAP_IDS = ['satellite', 'topo', 'material'] as const
export type BasemapId = (typeof BASEMAP_IDS)[number]
export const DEFAULT_BASEMAP: BasemapId = 'satellite'

export type ReliefStatus =
  | { kind: 'idle' }
  | { kind: 'rendering' }
  | { kind: 'ready'; relief: Relief; units: Unit[]; elevationResM: number }
  | { kind: 'error'; message: string }

const active = signal<BasemapId>(DEFAULT_BASEMAP)
const status = signal<Record<ReliefMode, ReliefStatus>>({ topo: { kind: 'idle' }, material: { kind: 'idle' } })

export const activeBasemap: ReadSignal<BasemapId> = active
export const reliefStatus: ReadSignal<Record<ReliefMode, ReliefStatus>> = status

export function setBasemap(id: BasemapId): void {
  active.value = id
}
export function setReliefStatus(mode: ReliefMode, s: ReliefStatus): void {
  status.value = { ...status.peek(), [mode]: s }
}
/** Tests: back to satellite, nothing rendered. */
export function resetBasemaps(): void {
  active.value = DEFAULT_BASEMAP
  status.value = { topo: { kind: 'idle' }, material: { kind: 'idle' } }
}
