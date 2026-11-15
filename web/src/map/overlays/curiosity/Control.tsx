// L1b: the Curiosity row in Plan's layer popover (registerMapControl slot 'layers-popover'), ported from
// the Mission Planer's LayersControl row: the toggle (off by default), the "live NASA data" label, the
// privacy note naming mars.nasa.gov (always visible next to the toggle, before anything is fetched), and
// the status line: loading, how many drive ends, or "unavailable" with a retry.
import { useSignalValue } from '../../../state/signal'
import { Toggle } from '../../../ui/components'
import { LiveLabel } from './Card'
import { ct } from './copy'
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
        <Toggle label={ct('curiosity.title')} checked={on} onChange={setCuriosityOn} />
        <LiveLabel />
      </div>
      <p class="hl-curiosity__what">{ct('curiosity.what')}</p>
      <p class="hl-curiosity__privacy">{ct('curiosity.privacy')}</p>
      {on && st.kind === 'loading' && (
        <p class="hl-curiosity__muted" role="status">
          {ct('curiosity.loading')}
        </p>
      )}
      {on && st.kind === 'ready' && (
        <p class="hl-curiosity__muted" role="status">
          {st.stops.length ? ct('curiosity.stops', { n: st.stops.length, first: st.stops[0].sol, last: st.stops[st.stops.length - 1].sol }) : ct('curiosity.none')}
        </p>
      )}
      {on && st.kind === 'unavailable' && (
        <div class="hl-curiosity__unavailable" role="status">
          <p>{ct('curiosity.unavailable', { reason: ct(`curiosity.reasons.${st.reason}`) })}</p>
          <button type="button" class="hl-curiosity__more" onClick={retryCuriosity}>
            {ct('curiosity.retry')}
          </button>
        </div>
      )}
    </div>
  )
}
