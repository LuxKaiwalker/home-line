// PORT P3: slot 'drawer-summary' — the bottom drawer's one-line summary of the active pad. The reach
// numbers that left the top bar (30-min and 60-min reach, or the parking option's reach at the
// walkback budget) come first, each a manifest-backed <Num> with its trust chip, then today's route
// line (views/planSlots.tsx PlanSummary, the slot's fallback: route at a glance, total, stations).
// Value snapshot: only keys the console already renders in the same view state, same formatting.
import type { ComponentChildren } from 'preact'
import { Num } from '../../components/Num'
import { peekPadEnv } from '../../pads'
import { OFFICIAL_PAD_ID, selectPad, usePlanning, type PlanningStore } from '../../state/planning'
import { useSignalValue } from '../../state/signal'
import type { StripProps } from '../../views/planStrip'
import { TrustChip } from '../components'
import { stripData } from './ContextBar'
import { t } from '../copy'
import { reachItems, type ReachItem } from './model'
import './strip.css'

export function ReachLine({ items }: { items: readonly ReachItem[] }) {
  if (items.length === 0) return null
  return (
    <span class="hl-dsum__reach" role="group" aria-label={t('route.strip.summary.label')}>
      {items.map((r, i) => (
        <span class="hl-dsum__item" key={r.k}>
          {i > 0 && (
            <span class="hl-ctx__sep" aria-hidden="true">
              ·
            </span>
          )}
          <span class="hl-dsum__k">{t('route.strip.summary.reach', { budget: r.budget })}</span> <Num v={r.v} units="%" file={r.file} k={r.k} />
          <TrustChip kind="modelled" prov={{ key: r.k, file: r.file, value: r.v }} align="start" />
        </span>
      ))}
    </span>
  )
}

export interface DrawerSummaryProps {
  fallback: ComponentChildren
  /** tests: the console's headline values (default: what the context bar published) */
  strip?: StripProps | null
  store?: PlanningStore
}

export function DrawerSummary({ fallback, strip, store }: DrawerSummaryProps) {
  const published = useSignalValue(stripData)
  const planPad = usePlanning(selectPad, store)
  const s = strip === undefined ? published : strip
  const env = !s?.pad && planPad !== OFFICIAL_PAD_ID ? peekPadEnv(planPad) : undefined
  const items = reachItems(s, env)
  // PORT FX (team lead 22:20): the route chain (fallback) is the official pad's; under any other
  // planning pad it would be wrong data, so it is hidden there
  const chain = planPad === OFFICIAL_PAD_ID ? fallback : null
  return (
    <span class="hl-dsum">
      <ReachLine items={items} />
      {items.length > 0 && chain !== null && (
        <span class="hl-ctx__sep" aria-hidden="true">
          ·
        </span>
      )}
      {chain}
    </span>
  )
}
