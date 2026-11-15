// One answer row in the palette list (search.md §2.2 "Answer" group, §6 keyboard + a11y). A number is
// rendered only from a RowValue: manifest values by <Num> (components/Num.tsx: stored value, manifest key,
// scorecard link, unbacked flag) with the trust chip's mark (ChipMark: the row itself is the button, so
// the chip is not a second control). Estimates (S3b) say "estimate". Unknown stays "unknown".
import { Num } from '../../../components/Num'
import { formatValue } from '../../../prov/provenance'
import { ChipMark, cx, Icon } from '../../components'
import { t } from '../../copy'
import type { QueryRow, RowValue } from './types'

const valueText = (v: RowValue): string =>
  v.kind === 'manifest' ? (v.v === null ? formatValue(null) : `${formatValue(v.v, v.units)} ${t(`chips.${v.chip ?? 'modelled'}.label`)}`) : `${formatValue(v.value, v.unit)} ${t('tags.estimate.label')}`

/** Screen-reader label: title, each value with its trust label (or "estimate"), and the disabled reason. */
export function rowLabel(r: QueryRow): string {
  const parts = [t(r.title, r.vars), ...(r.values ?? []).map(valueText)]
  if (r.disabledReason) parts.push(t('search.disabled', { reason: t(r.disabledReason) }))
  return parts.join(', ')
}

function Value({ v }: { v: RowValue }) {
  if (v.kind === 'estimate') return <span class="num num-derived">{`${formatValue(v.value, v.unit)} · ${t('tags.estimate.label')}`}</span>
  return (
    // the row is the control: a click on the number chooses the row instead of following the scorecard link
    <span onClick={(e) => e.preventDefault()}>
      <Num v={v.v} file={v.file} k={v.key} units={v.units} />
      {v.v !== null && <ChipMark kind={v.chip ?? 'modelled'} />}
    </span>
  )
}

export interface AnswerRowProps {
  row: QueryRow
  id: string
  active: boolean
  onChoose: () => void
  onHover: () => void
}

export function AnswerRow({ row, id, active, onChoose, onHover }: AnswerRowProps) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={active ? 'true' : 'false'}
      aria-disabled={row.disabledReason ? 'true' : undefined}
      aria-label={rowLabel(row)}
      class={cx('hl-search__opt', active && 'is-active')}
      data-id={row.id}
      data-pattern={row.pattern}
      onMouseDown={(e) => e.preventDefault() /* keep focus in the input */}
      onMouseMove={() => !active && onHover()}
      onClick={onChoose}
    >
      <Icon name={row.icon} />
      <span class="hl-search__name">{t(row.title, row.vars)}</span>
      {row.values?.map((v, i) => <Value key={i} v={v} />)}
      <span class="hl-search__kind">{row.disabledReason ? t(row.disabledReason) : t('search.answer')}</span>
    </li>
  )
}
