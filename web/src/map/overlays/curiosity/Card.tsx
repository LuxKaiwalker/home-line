// L1b: the drive-end pop-up card (ui/layout MarkerCard, L2e pattern), ported from the Mission Planer's
// StopPhotos (mission/LayersControl.tsx). Navcam frames by site/drive, Mastcam by parked sol with the
// "may predate the drive" note; thumbnails lazy-loaded, alt text from the image metadata.
import { useEffect, useState } from 'preact/hooks'
import { useSignalValue } from '../../../state/signal'
import { ChipMark } from '../../../ui/components'
import { MarkerCard, type CardMap } from '../../../ui/layout'
import { t } from '../../../ui/copy'
import { loadStopImages, RAW_IMAGE_PAGE, unavailableReason, type Camera, type DriveEnd, type StopImages } from './nasa'
import { CURIOSITY_CARD, curiositySelected, curiosityStatus, curiosityStop } from './store'
import './curiosity.css'

/** thumbnails per camera before "Show all" */
export const SHOW = 12

const fmtM = (v: number | null) => (v === null ? '–' : v >= 1000 ? `${(v / 1000).toFixed(2)} km` : `${Math.round(v)} m`)
/** 2024-05-30T12:00:00.000Z -> 2024-05-30 12:00:00 UTC */
export const fmtTaken = (iso: string) => (iso ? iso.replace('T', ' ').replace(/\.\d+Z$|Z$/, '') + ' UTC' : '–')
const cameraName = (c: Camera) => (c === 'mastcam' ? t('route.layers.curiosity.card.mastcam') : t('route.layers.curiosity.card.navcam'))

/** The live label: the live mark (purple, DESIGN §3.1) + "live NASA data". */
export function LiveLabel() {
  return (
    <span class="hl-curiosity__live">
      <ChipMark kind="live" />
      {t('route.layers.curiosity.live')}
    </span>
  )
}

export function CuriosityCard({ map }: { map: CardMap }) {
  const sel = useSignalValue(curiositySelected)
  useSignalValue(curiosityStatus)
  const at = curiosityStop(sel)
  if (!at) return null
  const { stop } = at
  return (
    <MarkerCard id={CURIOSITY_CARD} title={t('route.layers.curiosity.card.title', { rmc: stop.rmc, sol: stop.sol })} at={{ lngLat: [stop.lon, stop.lat], map }} class="hl-curiosity-card">
      <StopPhotos key={stop.rmc} stop={stop} next={at.next} />
    </MarkerCard>
  )
}

type Load = { kind: 'loading' } | { kind: 'ready'; res: StopImages } | { kind: 'unavailable'; reason: string }

export function StopPhotos({ stop, next }: { stop: DriveEnd; next: DriveEnd | null }) {
  const [st, setSt] = useState<Load>({ kind: 'loading' })
  const [more, setMore] = useState<Partial<Record<Camera, boolean>>>({})

  useEffect(() => {
    const ac = new AbortController()
    setSt({ kind: 'loading' })
    loadStopImages(stop, next, ac.signal).then(
      (res) => !ac.signal.aborted && setSt({ kind: 'ready', res }),
      (e) => !ac.signal.aborted && setSt({ kind: 'unavailable', reason: t(`route.layers.curiosity.reasons.${unavailableReason(e)}`) }),
    )
    return () => ac.abort()
  }, [stop.rmc, next?.rmc])

  const sols = st.kind === 'ready' ? st.res.sols : [stop.sol]
  const solTxt = sols.length > 1 ? t('route.layers.curiosity.card.sols', { first: sols[0], last: sols[sols.length - 1] }) : t('route.layers.curiosity.card.sol', { sol: sols[0] })
  return (
    <div class="hl-curiosity__photos">
      <p class="hl-curiosity__meta">
        {t('route.layers.curiosity.card.meta', { distance: fmtM(stop.distM), odometer: fmtM(stop.totalM), lat: stop.lat.toFixed(5), lon: stop.lon.toFixed(5) })}
      </p>
      <LiveLabel />
      <div role="status" data-live="curiosity-photos">
        {st.kind === 'loading' && <p class="hl-curiosity__muted">{t('route.layers.curiosity.card.loading')}</p>}
        {st.kind === 'unavailable' && <p class="hl-curiosity__unavailable">{t('route.layers.curiosity.card.unavailable', { reason: st.reason })}</p>}
      </div>
      {st.kind === 'ready' &&
        (['mastcam', 'navcam'] as const).map((cam) => {
          const list = st.res.images.filter((i) => i.camera === cam)
          const shown = more[cam] ? list : list.slice(0, SHOW)
          return (
            <section key={cam} class="hl-curiosity__cam" data-camera={cam}>
              <h4 class="hl-curiosity__cam-title">
                {cameraName(cam)} <span class="hl-curiosity__muted">{t('route.layers.curiosity.card.count', { n: list.length })}</span>
              </h4>
              <p class="hl-curiosity__rule">{cam === 'navcam' ? t('route.layers.curiosity.card.navcamRule') : t('route.layers.curiosity.card.mastcamRule', { sols: solTxt, sol: stop.sol })}</p>
              {list.length === 0 ? (
                <p class="hl-curiosity__muted">{cam === 'navcam' ? t('route.layers.curiosity.card.noneAtStop') : t('route.layers.curiosity.card.noneOn', { sols: solTxt })}</p>
              ) : (
                <ul class="hl-curiosity__grid" role="list">
                  {shown.map((i) => {
                    const taken = fmtTaken(i.takenUtc)
                    return (
                      <li key={i.id}>
                        <a href={i.url} target="_blank" rel="noopener noreferrer" title={t('route.layers.curiosity.card.imageTitle', { instrument: i.instrument, sol: i.sol, taken })}>
                          <img src={i.thumbUrl} loading="lazy" decoding="async" referrerpolicy="no-referrer" alt={t('route.layers.curiosity.card.imageAlt', { camera: cameraName(i.camera), instrument: i.instrument, sol: i.sol, taken })} />
                        </a>
                      </li>
                    )
                  })}
                </ul>
              )}
              {list.length > SHOW && !more[cam] && (
                <button type="button" class="hl-curiosity__more" onClick={() => setMore((m) => ({ ...m, [cam]: true }))}>
                  {t('route.layers.curiosity.card.showAll', { n: list.length })}
                </button>
              )}
            </section>
          )
        })}
      {st.kind === 'ready' && (
        <p class="hl-curiosity__note">
          {st.res.truncated ? `${t('route.layers.curiosity.card.truncated')} ` : ''}
          {t('route.layers.curiosity.card.credit')}{' '}
          <a href={RAW_IMAGE_PAGE} target="_blank" rel="noopener noreferrer">
            {t('route.layers.curiosity.card.archive')}
          </a>
        </p>
      )}
    </div>
  )
}
