// PORT U1: the reach numbers of the active pad, moved here from the removed top-centre headline panel
// (team lead 19:57). Same values, same manifest keys and the same backed <Num> + trust chip as the
// headline strip (views/planStrip.tsx), so the value snapshot sees the same numbers in a new place:
//   official pad   scenarios/index.json  reachable_pct.{scenario}.{budget}   (30 min = headline, 60 = headline_60)
//   picker pad     its summary.json      pads.{id}.headline.{budget}.reachable_pct  (data/pads.ts padKey)
import { useEffect, useState } from 'preact/hooks'
import { Num } from '../../components/Num'
import { CONFIG } from '../../config'
import { headlineFor, padKey } from '../../data/pads'
import { data, type Loader } from '../../data/loader'
import type { ScenarioEntry, ScenariosIndex } from '../../data/types'
import { padLoadState, peekPadEnv, type PadEnv } from '../../pads'
import { resolvePlanScenario, mission } from '../../state/mission'
import { OFFICIAL_PAD_ID, planning, selectPad, usePlanning, type PlanningStore } from '../../state/planning'
import { useSignalValue } from '../../state/signal'
import { headline60 } from '../../views/decisions'
import { TrustChip } from '../components'
import { t } from '../copy'

export interface ReachRow {
  budget: number
  v: number | null
  k: string
  file: string
}

/** Official pad: the scenario's headline (30 min) and headline_60 from scenarios/index.json. */
export function officialReach(s: ScenarioEntry): ReachRow[] {
  const file = 'scenarios/index.json'
  const rows: ReachRow[] = [{ budget: s.headline.budget_min, v: s.headline.reachable_pct, k: `reachable_pct.${s.id}.${s.headline.budget_min}`, file }]
  const h60 = headline60(s)
  if (h60) rows.push({ budget: h60.budget, v: h60.reachablePct, k: `reachable_pct.${s.id}.${h60.budget}`, file })
  return rows
}

/** A picker pad: its summary.json headlines (the strip's rule: 30 min or the first written, 60 min exact). */
export function padReach(env: PadEnv): ReachRow[] {
  const s = env.summary
  const file = env.info.files.summary
  if (!s || !file) return []
  const b30 = CONFIG.walkbackBudgetsMin[0]
  const b60 = CONFIG.walkbackBudgetsMin[1] ?? 60
  const row = (h: { budget: number; reachablePct: number | null }): ReachRow => ({ budget: h.budget, v: h.reachablePct, k: padKey(env.info.sourceId, 'headline', h.budget, 'reachable_pct'), file })
  const a = headlineFor(s, b30)
  const c = s.headlines.find((h) => h.budget === b60) ?? null
  const out = a ? [row(a)] : []
  if (c && c.budget !== a?.budget) out.push(row(c))
  return out
}

export function ReachRows({ rows }: { rows: readonly ReachRow[] }) {
  return (
    <div class="hl-rp__est" data-reach>
      {rows.map((r) => (
        <div class="hl-rp__row" key={r.k}>
          <span>{t('route.panel.estimates.reach', { budget: r.budget })}</span>
          <b>
            <Num v={r.v} units="%" file={r.file} k={r.k} />
            <TrustChip kind="modelled" prov={{ key: r.k, file: r.file, value: r.v }} align="end" />
          </b>
        </div>
      ))}
    </div>
  )
}

/** The scenarios index, once (the app loader caches the file). */
function useScenarios(loader: Pick<Loader, 'scenarios'>): ScenariosIndex | null {
  const [idx, setIdx] = useState<ScenariosIndex | null>(null)
  useEffect(() => {
    let alive = true
    loader.scenarios().then(
      (i) => alive && setIdx(i),
      () => {},
    )
    return () => void (alive = false)
  }, [loader])
  return idx
}

/** The reach block of the Estimates card for the active pad. */
export function PadReach({ store = planning, loader = data() }: { store?: PlanningStore; loader?: Pick<Loader, 'scenarios'> }) {
  const padId = usePlanning(selectPad, store)
  const idx = useScenarios(loader)
  const chosen = useSignalValue(mission.plan.scenario)
  const states = useSignalValue(padLoadState())
  let rows: ReachRow[] | null = null
  if (padId === OFFICIAL_PAD_ID) {
    if (idx && idx.scenarios.length) rows = officialReach(resolvePlanScenario(idx, chosen))
  } else {
    const st = states[padId]
    const env = st?.state === 'ready' ? st.env : peekPadEnv(padId)
    if (env) rows = padReach(env)
    else if (st?.state === 'error') rows = []
  }
  return (
    <section class="hl-rp__sub" aria-label={t('route.panel.estimates.reachTitle')}>
      {rows === null ? (
        <p class="hl-rp__caption">{t('route.panel.estimates.reachLoading')}</p>
      ) : rows.length ? (
        <ReachRows rows={rows} />
      ) : (
        <p class="hl-rp__caption">{t('route.panel.estimates.reachNone')}</p>
      )}
    </section>
  )
}
