// L1b: the Curiosity row in Plan's layer popover (registerMapControl slot 'layers-popover'), ported from
// the Mission Planer's LayersControl row: the toggle (off by default), the "live NASA data" label, the
// privacy note naming mars.nasa.gov (always visible next to the toggle, before anything is fetched), and
// the status line: loading, how many drive ends, or "unavailable" with a retry.
import { useSignalValue } from '../../../state/signal'
import { Toggle } from '../../../ui/components'
import { LiveLabel } from './Card'
import { t } from '../../../ui/copy'
import { curiosityEnabled, curiosityOn, curiosityStatus, retryCuriosity, setCuriosityOn } from './store'
import './curiosity.css'

export function CuriosityControl() {
  const enabled = useSignalValue(curiosityEnabled)
  const on = useSignalValue(curiosityOn)
  const st = useSignalValue(curiosityStatus)
  if (!enabled) return null
  return (
    <div class="hl-curiosity" data-overlay="curiosity" data-status={on ? st.kind : 'off'}>
      <div class="hl-curiosity__head">
        <Toggle label={t('route.layers.curiosity.title')} checked={on} onChange={setCuriosityOn} />
        <LiveLabel />
      </div>
      <p class="hl-curiosity__what">{t('route.layers.curiosity.what')}</p>
      <p class="hl-curiosity__privacy">{t('route.layers.curiosity.privacy')}</p>
      {/* one live region that stays mounted (PORT I4 a11y); the retry button sits outside it */}
      <div role="status" data-live="curiosity">
        {on && st.kind === 'loading' && <p class="hl-curiosity__muted">{t('route.layers.curiosity.loading')}</p>}
        {on && st.kind === 'ready' && (
          <p class="hl-curiosity__muted">
            {st.stops.length ? t('route.layers.curiosity.stops', { n: st.stops.length, first: st.stops[0].sol, last: st.stops[st.stops.length - 1].sol }) : t('route.layers.curiosity.none')}
          </p>
        )}
        {on && st.kind === 'unavailable' && (
          <p class="hl-curiosity__unavailable">{t('route.layers.curiosity.unavailable', { reason: t(`route.layers.curiosity.reasons.${st.reason}`) })}</p>
        )}
      </div>
      {on && st.kind === 'unavailable' && (
        <button type="button" class="hl-curiosity__more" onClick={retryCuriosity}>
          {t('route.layers.curiosity.retry')}
        </button>
      )}
    </div>
  )
}
