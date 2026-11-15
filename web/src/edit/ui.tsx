// Drag-the-rover UI (U15): the readout that follows the rover while dragging (exact lookups; planning
// values say which pad they come from on release, L7b) and the delta strip shown on release (what
// changes against the committed plan, from the precomputed pads index only: every number goes through <Num> with its manifest key).
import { Num } from '../components/Num'
import { formatValue } from '../prov/provenance'
import { padKey, PADS_INDEX, type PadOption, type PadsIndexView } from '../data/pads'
import { liveStatus, type LiveStatus } from '../state/live'
import { useSignalValue } from '../state/signal'
import { FieldReadout } from '../ui/cards/cards'
import { Button, TrustChip } from '../ui/components'
import { t, type CopyKey } from '../ui/copy'
import { editButtons } from './bind'
import { dragRows, PAD_VALIDITY, type SpotFail, type SpotValues } from './drag'
import { isCustomPad } from './options'
import type { RoverDrag } from './rover'
import type { DeltaRow, PlanEditStore } from './store'

export const DASH = '—'
const SLOPE_FILE = 'fields/shared/slope.png'

const FAIL_COPY: Record<SpotFail, CopyKey> = { steep: 'cards.pad.invalidSteep', unknown: 'cards.pad.invalidUnknown', outside: 'cards.pad.invalidOutside' }

/** Validity line (copy only; no number). */
export function validityText(v: SpotValues): string {
  if (v.validity === 'valid') return t('cards.pad.validSpot')
  if (v.validity === 'invalid') return t('cards.pad.invalidSpot', { reason: v.failed.map((f) => t(FAIL_COPY[f])).join(', ') })
  return DASH
}

/**
 * A planning value the drag does not compute (D85: no live recompute while dragging). Honest about
 * what happens: on release the rover snaps to `pad` and that pad's precomputed value is shown.
 */
function PendingRow({ label, pad }: { label: string; pad: string | null }) {
  return (
    <div class="hl-readout hl-edit-pending" data-state="pending">
      <div class="hl-readout__label">
        <span>{label}</span>
      </div>
      <div class="hl-readout__value" title={pad ? t('edit.onReleaseTip', { pad_name: pad }) : t('edit.noSnap')}>
        {pad ? t('edit.onRelease', { pad_name: pad }) : DASH}
      </div>
    </div>
  )
}

/** What the readout's snap line says, by live-planner status (seam: state/live.ts). Truthful (L7b, T2). */
export function snapText(status: LiveStatus): CopyKey {
  return status === 'ready' ? 'edit.snapLive' : status === 'checking' || status === 'warming' ? 'edit.snapWaiting' : 'edit.snapStatic'
}

/** The delta strip's note on how the pad was chosen, by live-planner status. */
export function deltaNote(status: LiveStatus): CopyKey {
  return status === 'ready' ? 'edit.liveCustomSpot' : status === 'checking' || status === 'warming' ? 'edit.parkingWaiting' : 'edit.snapStatic'
}

const REFUSED_COPY: Record<SpotFail, CopyKey> = { steep: 'edit.refusedSteep', unknown: 'edit.refusedUnknown', outside: 'cards.pad.invalidOutside' }

/**
 * Why a precomputed pad is skipped as a snap target (the U15 spot rule on its 20 × 20 m block), with
 * the block's max slope when the slope field gave one (a field lookup, like the slope row).
 */
export function refusedText(name: string, failed: readonly SpotFail[], maxSlopeDeg: number | null = null, rule = PAD_VALIDITY): string {
  const vars = { max_slope_deg: rule.maxSlopeDeg, block_m: rule.blockM, slope: formatValue(maxSlopeDeg, 'deg', { dp: 1 }) }
  const reason = failed.map((f) => t(f === 'steep' && maxSlopeDeg === null ? 'edit.refusedSteepNoValue' : REFUSED_COPY[f], vars)).join(', ')
  return t('edit.padRefused', { pad_name: name, reason })
}

export interface DragReadoutProps {
  values: SpotValues
  /** the snap target (pads index row) */
  target: PadOption | null
  /** display name of a pad (map code, e.g. P2); default the pads index label */
  name?: (id: string) => string
  /** the nearest precomputed pad when the spot check refuses it, with the failed checks */
  refused?: { id: string; failed: readonly SpotFail[]; maxSlopeDeg?: number | null } | null
  /** live-planner status (default: the state/live.ts seam) */
  status?: LiveStatus
}

/** While dragging: validity, elevation ("—": no elevation field), slope (field lookup); the rest pending until release. */
export function DragReadout({ values, target, name, refused, status }: DragReadoutProps) {
  const live = useSignalValue(liveStatus)
  const st = status ?? live
  const nameOf = name ?? ((id: string) => (target && target.id === id ? target.label : id))
  const targetName = target ? nameOf(target.id) : null
  const rows = dragRows(values)
  return (
    <div class="hl-edit-drag" role="status" aria-live="polite" data-validity={values.validity} data-live={st}>
      <div class="hl-edit-drag__validity" data-source="field">
        {validityText(values)}
      </div>
      {rows.map((r) =>
        r.key === 'elevation' ? (
          <div class="hl-readout" data-state="unknown" key={r.key}>
            <div class="hl-readout__label">
              <span>{t('cards.pad.elevation')}</span>
            </div>
            <div class="hl-readout__value" title={t('tooltips.elevationNone')}>
              {DASH}
            </div>
          </div>
        ) : r.key === 'slope' ? (
          <FieldReadout key={r.key} label={t('cards.pad.slope')} v={values.slopeDeg} file={SLOPE_FILE} units="deg" />
        ) : r.key === 'feasibleEvas' ? (
          <PendingRow key={r.key} label={t('cards.pad.feasibleEvas')} pad={targetName} />
        ) : r.key === 'reachable' ? (
          <PendingRow key={r.key} label={t('cards.pad.reachable')} pad={targetName} />
        ) : null,
      )}
      {refused && (
        <div class="hl-edit-drag__refused" data-refused={refused.id} data-source="field" data-file={SLOPE_FILE}>
          {refusedText(nameOf(refused.id), refused.failed, refused.maxSlopeDeg ?? null)}
        </div>
      )}
      <div class="hl-edit-drag__snap">
        {target ? t(snapText(st)) : t('edit.noSnap')}
        {targetName ? ` · ${targetName}` : ''}
      </div>
    </div>
  )
}

// ---- delta strip ---------------------------------------------------------------------------------

/** One precomputed fact of a pad: value and manifest key (pads index). */
export interface PadFact {
  key: 'feasibleEvas' | 'reachable' | 'elevation'
  label: CopyKey
  units?: string
  dp?: number
  chip: 'modelled' | 'real'
  v: (o: PadOption) => number | null
  k: (id: string) => string
}

export const PAD_FACTS: readonly PadFact[] = [
  { key: 'feasibleEvas', label: 'cards.pad.feasibleEvas', chip: 'modelled', v: (o) => o.score, k: (id) => padKey(id, 'score') },
  { key: 'reachable', label: 'cards.pad.reachable', units: '%', chip: 'modelled', v: (o) => o.tiebreak.find(([n]) => n === 'reachable_pct_30')?.[1] ?? null, k: (id) => padKey(id, 'tiebreak', 'reachable_pct_30') },
  { key: 'elevation', label: 'cards.pad.elevation', units: 'm', chip: 'real', v: (o) => o.elevM, k: (id) => padKey(id, 'elev_m') },
]

export interface FactRow {
  fact: PadFact
  from: { v: number | null; k: string }
  to: { v: number | null; k: string }
}

/** Precomputed facts of the committed pad and the draft pad (pads index values, never computed). */
export function factRows(pads: PadsIndexView, fromId: string, toId: string): FactRow[] {
  const a = pads.options.find((o) => o.id === fromId)
  const b = pads.options.find((o) => o.id === toId)
  if (!a || !b) return []
  return PAD_FACTS.map((f) => ({ fact: f, from: { v: f.v(a), k: f.k(a.id) }, to: { v: f.v(b), k: f.k(b.id) } }))
}

const padName = (pads: PadsIndexView, id: unknown) => (typeof id === 'string' ? (pads.options.find((o) => o.id === id)?.label ?? id) : DASH)

function InputRow({ row, pads }: { row: DeltaRow; pads: PadsIndexView }) {
  if (row.field === 'pad') {
    return (
      <div class="hl-edit-delta__row" data-field="pad">
        <span class="hl-edit-delta__label">{t('cards.pad.title')}</span>
        <span class="hl-edit-delta__from">{padName(pads, row.from)}</span>
        <span class="hl-edit-delta__arrow" aria-hidden="true">→</span>
        <span class="hl-edit-delta__to">{padName(pads, row.to)}</span>
      </div>
    )
  }
  return (
    <div class="hl-edit-delta__row" data-field={row.field}>
      <span class="hl-edit-delta__label">{row.field === 'budgetMin' ? t('tooltips.budgetSlider') : row.field === 'scenario' ? t('stepper.stages.variants') : row.field}</span>
      <span class="hl-edit-delta__from">{String(row.from ?? DASH)}</span>
      <span class="hl-edit-delta__arrow" aria-hidden="true">→</span>
      <span class="hl-edit-delta__to">{String(row.to ?? DASH)}</span>
    </div>
  )
}

/** The delta strip (DESIGN §5.2 sidebar): what the released draft changes, Keep / Discard. */
export function DeltaStrip({ store, rover, pads }: { store: PlanEditStore; rover: RoverDrag; pads: PadsIndexView }) {
  const d = useSignalValue(store.draft)
  useSignalValue(store.canUndo)
  const live = useSignalValue(liveStatus)
  if (!d || d.phase !== 'released') return null
  const from = store.committed.peek().plan.pad
  const to = d.step.plan.pad
  const facts = !isCustomPad(from) && !isCustomPad(to) ? factRows(pads, from, to) : []
  const buttons = editButtons(store).filter((b) => b.id === 'keep' || b.id === 'discard')
  return (
    <section class="hl-edit-delta" aria-label={t('edit.deltaTitle')} data-ghost={d.ghost.status} data-ghost-source={d.ghost.source}>
      <h3 class="hl-edit-delta__title">
        {t('edit.deltaTitle')} <TrustChip kind="modelled" />
      </h3>
      {d.delta.map((r) => (
        <InputRow key={`${r.field}${r.station ?? ''}`} row={r} pads={pads} />
      ))}
      {facts.map((r) => (
        <div class="hl-edit-delta__row" data-fact={r.fact.key} key={r.fact.key}>
          <span class="hl-edit-delta__label">
            {t(r.fact.label)} <TrustChip kind={r.fact.chip} prov={r.to.v === null ? undefined : { key: r.to.k, file: PADS_INDEX, value: r.to.v }} />
          </span>
          <span class="hl-edit-delta__from">
            <Num v={r.from.v} file={PADS_INDEX} k={r.from.k} units={r.fact.units} />
          </span>
          <span class="hl-edit-delta__arrow" aria-hidden="true">→</span>
          <span class="hl-edit-delta__to">
            <Num v={r.to.v} file={PADS_INDEX} k={r.to.k} units={r.fact.units} />
          </span>
        </div>
      ))}
      {!store.live.value && <p class="hl-edit-delta__note">{t(deltaNote(live))}</p>}
      {!d.availability.ok && <p class="hl-edit-delta__note">{t(d.availability.reason ?? 'states.offline.unavailableHere')}</p>}
      <div class="hl-edit-delta__actions">
        {buttons.map((b) => (
          <Button key={b.id} variant={b.id === 'keep' ? 'primary' : 'secondary'} disabled={!b.enabled} reason={t(b.reason ?? b.hint ?? b.label)} title={t(b.hint ?? b.label)} onClick={() => (b.id === 'keep' ? rover.keep() : rover.discard())}>
            {t(b.label)}
          </Button>
        ))}
      </div>
      <p class="hl-edit-delta__hint">{t('edit.keepOrDiscard')}</p>
    </section>
  )
}
