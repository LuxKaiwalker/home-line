// I2b (D128, instant browser path): the start of the route in the Edit-route drawer = a picker of the four
// pads the browser has fields for (adapter.ts padFields: the official pad + P2–P4, scenarios/pads/index.json
// rank2..rank4, I2). Picking a pad writes mission.plan.pad exactly as the console's parking-option picker
// does (views/console.tsx pickPad), so the H1 plan-edit store records it as one undo step (edit/bind.ts
// followMission), the rover snaps to that pad, and the route store / browser estimate recompute
// (live/route/mount.tsx watches mission.plan). A custom spot (pad tool) shows no pad checked; the
// estimate then says why it is unavailable. Live builds only (imported by live/route/mount.tsx).
import { useSignalValue, type ReadSignal } from '../../../state/signal'
import type { EditCatalog } from '../../options'
import type { RouteStep } from '../store'
import { padFields } from './adapter'

export const PAD_PICK_TEXT = {
  label: 'Start: rover pad',
  official: 'Official pad',
  custom: 'Start: a custom spot. Pick one of the four pads for the browser estimate.',
}

export interface PadPickOption {
  id: string
  label: string
}

/** The four pads with browser fields: the official pad first, then P2–P4 in the pads index order. */
export function padPickOptions(c: Pick<EditCatalog, 'pads' | 'officialPadId'>): PadPickOption[] {
  const rows = c.pads.filter((p) => padFields(p.id, c.officialPadId) !== null)
  rows.sort((a, b) => Number(b.id === c.officialPadId) - Number(a.id === c.officialPadId))
  return rows.map((p) => ({ id: p.id, label: p.id === c.officialPadId ? PAD_PICK_TEXT.official : p.id.replace(/^rank(\d+)$/, 'P$1') }))
}

export interface PadPickViewProps {
  options: readonly PadPickOption[]
  /** the plan's pad: a pad id, or a custom spot (no pad checked) */
  selected: string | { lon: number; lat: number }
  onPick(id: string): void
  disabled?: boolean
}

export function PadPickView(p: PadPickViewProps) {
  const custom = typeof p.selected !== 'string'
  return (
    <div class="hl-route__padpick" data-pad-picker>
      <div class="hl-route__mode" role="radiogroup" aria-label={PAD_PICK_TEXT.label}>
        {p.options.map((o) => (
          <button
            type="button"
            role="radio"
            class="hl-route__modebtn"
            aria-checked={p.selected === o.id ? 'true' : 'false'}
            data-pad={o.id}
            disabled={p.disabled}
            onClick={() => p.selected !== o.id && p.onPick(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {custom ? <p class="hl-route__note">{PAD_PICK_TEXT.custom}</p> : null}
    </div>
  )
}

/** The picker on the route store's plan (re-renders on every step). */
export function RoutePadPick(p: { step: ReadSignal<RouteStep>; catalog: EditCatalog; onPick(id: string): void }) {
  const step = useSignalValue(p.step)
  return <PadPickView options={padPickOptions(p.catalog)} selected={step.plan.pad} onPick={p.onPick} />
}
