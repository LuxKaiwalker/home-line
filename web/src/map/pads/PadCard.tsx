// PORT P2: the pad pop-up card (ui/layout MarkerCard, the L2e card pattern) and the 'pad-layer' slot.
// The card shows the pad's precomputed headline (30/60-min reach with range, feasible EVAs) and
// "Plan from here" -> planning.setPad(id). The numbers come through <Num> with the headline's own files
// and manifest keys (numbers.ts) and carry the Modelled trust chip as the strip did.
import { createPortal } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { Num } from '../../components/Num'
import { data, type Loader } from '../../data/loader'
import { loadPadsIndex, parsePadSummary } from '../../data/pads'
import { peekPadEnv } from '../../pads'
import { OFFICIAL_PAD_ID, type PadInfo } from '../../pads/types'
import { mission, resolvePlanScenario } from '../../state/mission'
import { planning, selectPad, usePlanning, type PlanningStore } from '../../state/planning'
import { useSignalValue } from '../../state/signal'
import { Button, TrustChip } from '../../ui/components'
import { t } from '../../ui/copy'
import { MarkerCard, type CardMap } from '../../ui/layout'
import { officialCardNumbers, padCardNumbers, type CardNumbers, type NumRef } from './numbers'
import { PAD_CARD_ID, padLayer } from './padLayer'
import { syncPadEnvironment, type PadEnvTarget } from './sync'
import './pads.css'

export type CardLoad = { state: 'loading' } | { state: 'ok'; n: CardNumbers } | { state: 'none' } | { state: 'error' }

/** The card numbers of a pad: its summary.json (cached env first), or the official plan's numbers. */
export function useCardNumbers(info: PadInfo | null, L: Loader = data()): CardLoad {
  const [load, setLoad] = useState<CardLoad>({ state: 'loading' })
  const sid = useSignalValue(mission.plan.scenario)
  useEffect(() => {
    if (!info) return
    let live = true
    const done = (l: CardLoad) => live && setLoad(l)
    setLoad({ state: 'loading' })
    if (info.official || info.id === OFFICIAL_PAD_ID) {
      Promise.all([L.scenarios(), loadPadsIndex(L)]).then(
        ([idx, pads]) => done({ state: 'ok', n: officialCardNumbers(resolvePlanScenario(idx, sid), pads.state === 'ok' ? pads.index.official : null) }),
        () => done({ state: 'error' }),
      )
    } else {
      const file = info.files.summary
      const cached = peekPadEnv(info.id)?.summary
      if (cached && file) done({ state: 'ok', n: padCardNumbers(info.sourceId, cached, file) })
      else if (!file) done({ state: 'none' })
      else
        L.json<unknown>(file).then(
          (raw) => done({ state: 'ok', n: padCardNumbers(info.sourceId, parsePadSummary(raw, info.sourceId), file) }),
          () => done({ state: 'error' }),
        )
    }
    return () => void (live = false)
  }, [info?.id, sid])
  return info ? load : { state: 'none' }
}

function N({ r, units }: { r: NumRef; units?: string }) {
  return <Num v={r.v} units={units} file={r.file} k={r.k} />
}

/** The card body (pure: tests render it with fixed numbers). */
export function PadCardBody({ info, load, active, onPlan }: { info: PadInfo; load: CardLoad; active: boolean; onPlan: () => void }) {
  return (
    <div class="hl-padcard" data-pad-card={info.id}>
      <p class="hl-padcard__kind">{info.official ? t('route.padmap.card.official') : t('route.padmap.card.precomputed')}</p>
      {/* one live region that stays mounted (PORT I4 a11y): loading, then none / error are announced */}
      <div role="status" data-live="pad-card">
        {load.state === 'loading' && <p class="hl-padcard__muted">{t('route.padmap.card.loading')}</p>}
        {load.state === 'none' && <p class="hl-padcard__muted">{t('route.padmap.card.none')}</p>}
        {load.state === 'error' && <p class="hl-padcard__muted">{t('route.padmap.card.error')}</p>}
      </div>
      {load.state === 'ok' && (
        <dl class="hl-padcard__nums">
          {load.n.reach.map((r) => (
            <div class="hl-padcard__row" key={r.budget} data-budget={r.budget}>
              <dt>{t('layout.strip.reach', { budget: r.budget })}</dt>
              <dd>
                <span class="hl-padcard__value">
                  <N r={r.value} units="%" />
                  <TrustChip kind="modelled" prov={{ key: r.value.k, file: r.value.file, value: r.value.v }} align="start" />
                </span>
                {r.range && (
                  <span class="hl-padcard__range">
                    <N r={r.range[0]} units="%" /> – <N r={r.range[1]} units="%" />
                  </span>
                )}
              </dd>
            </div>
          ))}
          {load.n.feasible && (
            <div class="hl-padcard__row">
              <dt>{t('route.padmap.card.feasible')}</dt>
              <dd>
                <N r={load.n.feasible} />
              </dd>
            </div>
          )}
        </dl>
      )}
      {load.state === 'ok' && load.n.reach.some((r) => r.range) && <p class="hl-padcard__muted">{t('route.padmap.card.rangeNote')}</p>}
      {active ? (
        <p class="hl-padcard__shown">{t('route.padmap.card.shown')}</p>
      ) : info.hasRoutingFields || info.official ? (
        <Button variant="primary" icon="pad" onClick={onPlan} class="hl-padcard__plan">
          {t('route.pads.planFromHere')}
        </Button>
      ) : (
        <p class="hl-padcard__muted">{t('route.padmap.card.noFields')}</p>
      )}
    </div>
  )
}

/** The open pad card: anchored at the pad on the map (MarkerCard follows the map). */
export function PadCard({ map, store = planning }: { map: CardMap; store?: PlanningStore }) {
  const id = useSignalValue(padLayer.card)
  const pads = useSignalValue(padLayer.pads)
  const active = usePlanning(selectPad, store)
  const info = pads.find((p) => p.id === id) ?? null
  const load = useCardNumbers(info)
  if (!info) return null
  return (
    <MarkerCard id={PAD_CARD_ID} title={info.label} at={{ lngLat: [info.lon, info.lat], map }} class="plan-card hl-padcard-card">
      <PadCardBody info={info} load={load} active={active === info.id} onPlan={() => store.setPad(info.id)} />
    </MarkerCard>
  )
}

/** "Loading pad P3…" / error line over the map while a pad's environment is on its way. */
export function PadStatus() {
  const shown = useSignalValue(padLayer.shown)
  const pads = useSignalValue(padLayer.pads)
  const label = pads.find((p) => p.id === shown.id)?.label ?? shown.id
  // the live region stays mounted (PORT I4 a11y); only the pill inside comes and goes
  return (
    <div role="status" aria-live="polite" data-live="pad-status">
      {shown.status !== 'ready' && (
        <p class={`hl-padstatus hl-padstatus--${shown.status}`}>
          {shown.status === 'loading' ? t('route.pads.loading', { pad: label }) : t('route.padmap.status.error', { pad: label })}
        </p>
      )}
    </div>
  )
}

/**
 * The 'pad-layer' slot (views/planPortSlots.tsx): follows planning.padId into the map
 * (cmap.setPadEnvironment) and renders the pad card + status over the map container.
 */
export function PadLayerSlot({ cmap, store = planning, host }: { cmap: PadEnvTarget & { map: CardMap & { getContainer(): HTMLElement } }; store?: PlanningStore; host?: HTMLElement }) {
  useEffect(() => syncPadEnvironment(cmap, store), [cmap, store])
  const target = host ?? cmap.map.getContainer()
  return createPortal(
    <>
      <PadStatus />
      <PadCard map={cmap.map} store={store} />
    </>,
    target,
  )
}
