// PORT U1: the Route panel's pad picker, a port of mission/PadPick.tsx onto the pad service (pads/):
// the pads come from listPads() (loadPadIndex() once on mount), the choice goes to the planning store
// (setPad: one undo step), the loading state comes from padLoadState(). A radiogroup in the Mission
// Planer's tag-button style; a pad without walk-home fields stays visible but cannot start a route.
import { useEffect, useState } from 'preact/hooks'
import { listPads, loadPadEnv, loadPadIndex, padLoadState, type PadInfo } from '../../pads'
import { planning, selectPad, usePlanning, type PlanningStore } from '../../state/planning'
import { useSignalValue } from '../../state/signal'
import { t } from '../copy'

type IndexState = 'loading' | 'ready' | 'error'

/** Picker label: the official pad's seed copy, else the index label (P2, P3 …). */
export const padName = (p: PadInfo): string => (p.official ? t('route.pads.official') : p.label)

export function PadPicker({ store = planning }: { store?: PlanningStore }) {
  const padId = usePlanning(selectPad, store)
  const [pads, setPads] = useState<PadInfo[]>(() => listPads())
  const [index, setIndex] = useState<IndexState>(() => (listPads().length ? 'ready' : 'loading'))
  const states = useSignalValue(padLoadState())

  useEffect(() => {
    if (pads.length) return
    let alive = true
    loadPadIndex().then(
      (list) => {
        if (!alive) return
        setPads(list)
        setIndex('ready')
      },
      () => alive && setIndex('error'),
    )
    return () => void (alive = false)
  }, [])

  const pick = (p: PadInfo) => {
    if (p.id === padId) {
      // the active pad again: retry a failed load
      if (states[p.id]?.state === 'error') loadPadEnv(p.id).catch(() => {})
      return
    }
    if (!p.hasRoutingFields) return
    store.setPad(p.id)
    // start the load at once (cached: no refetch); the map layer and the core read the same cache
    loadPadEnv(p.id).catch(() => {})
  }

  // ARIA radio group: one tab stop (the checked pad), arrow keys move the choice over the pads that can
  // be picked (PORT I4 a11y)
  const pickable = pads.filter((p) => p.hasRoutingFields || p.id === padId)
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    const edge = e.key === 'Home' ? 0 : e.key === 'End' ? pickable.length - 1 : -1
    if (!step && edge < 0) return
    e.preventDefault()
    const i = pickable.findIndex((p) => p.id === padId)
    const next = pickable[edge >= 0 ? edge : (i + step + pickable.length) % pickable.length]
    if (!next) return
    pick(next)
    const group = e.currentTarget as HTMLElement | null
    const btn = group?.querySelector?.(`[data-pad="${next.id}"]`) as HTMLElement | null
    btn?.focus?.()
  }

  const active = pads.find((p) => p.id === padId)
  const st = states[padId]
  const labelId = 'hl-rp-pads-label'
  return (
    <section class="hl-rp__card hl-rp__pads" aria-labelledby={labelId} data-pad-picker>
      <h3 id={labelId} class="hl-rp__h">
        {t('route.panel.pads.label')}
      </h3>
      <div role="status" data-live="pad-index">
        {index === 'loading' && !pads.length && <p class="hl-rp__caption">{t('route.panel.pads.indexLoading')}</p>}
        {index === 'error' && !pads.length && <p class="hl-rp__caption">{t('route.panel.pads.indexError')}</p>}
      </div>
      {pads.length > 0 && (
        <div class="hl-rp__tags" role="radiogroup" aria-labelledby={labelId} onKeyDown={onKey}>
          {pads.map((p) => {
            const on = p.id === padId
            return (
              <button
                type="button"
                role="radio"
                key={p.id}
                class={on ? 'on' : ''}
                aria-checked={on ? 'true' : 'false'}
                tabIndex={on ? 0 : -1}
                data-pad={p.id}
                disabled={!p.hasRoutingFields && !on}
                title={p.hasRoutingFields ? undefined : t('route.panel.pads.noFields')}
                onClick={() => pick(p)}
              >
                {padName(p)}
              </button>
            )
          })}
        </div>
      )}
      <div role="status" data-live="pad-load">
        {st?.state === 'loading' ? (
          <p class="hl-rp__caption" data-pad-loading>
            {t('route.panel.pads.loading', { pad: active ? padName(active) : padId })}
          </p>
        ) : st?.state === 'error' ? (
          <p class="hl-rp__caption hl-rp__bad">{t('route.panel.pads.error', { pad: active ? padName(active) : padId })}</p>
        ) : null}
      </div>
      {st?.state !== 'loading' && st?.state !== 'error' && pads.length > 0 && <p class="hl-rp__caption">{t('route.panel.pads.note')}</p>}
    </section>
  )
}
