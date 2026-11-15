// F14: the in-app raw-image viewer (lightbox) for the drive-end card's thumbnails. Portalled to
// document.body so nothing on the map (or the map's own handlers) sits over or under it. Large image,
// caption, "live NASA data", prev/next through the stop's images, Esc/close, focus trapped and handed
// back to the thumbnail. Only request: the full image itself, when opened (L1b's limits stay).
import { createPortal, type ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { t } from '../../../ui/copy'
import type { Camera, RawImage } from './nasa'

const FOCUSABLE = 'button, a[href]'

export function ImageViewer({ images, index, onIndex, onClose, stopSol, cameraName, fmtTaken, live }: {
  images: RawImage[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  stopSol: number
  cameraName: (c: Camera) => string
  fmtTaken: (iso: string) => string
  live: ComponentChildren
}) {
  const closeBtn = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    closeBtn.current?.focus()
  }, [])
  const i = images[index]
  if (!i) return null
  const n = images.length
  const go = (d: number) => onIndex((index + d + n) % n)
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'ArrowRight' && n > 1) {
      e.preventDefault()
      go(1)
    } else if (e.key === 'ArrowLeft' && n > 1) {
      e.preventDefault()
      go(-1)
    } else if (e.key === 'Tab') {
      const els = Array.from(box.current?.querySelectorAll?.(FOCUSABLE) ?? []) as HTMLElement[]
      if (!els.length) return
      const first = els[0]
      const last = els[els.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !box.current?.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !box.current?.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }
  }
  const taken = fmtTaken(i.takenUtc)
  const alt = t('route.layers.curiosity.card.imageAlt', { camera: cameraName(i.camera), instrument: i.instrument, sol: i.sol, taken })
  const label = t('route.layers.curiosity.card.viewer.label', { n: index + 1, total: n })
  return createPortal(
    <div class="hl-curiosity-viewer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} class="hl-curiosity-viewer__box" role="dialog" aria-modal="true" aria-label={label} onKeyDown={onKey}>
        <header class="hl-curiosity-viewer__head">
          <span class="hl-curiosity-viewer__count">{label}</span>
          {live}
          <button ref={closeBtn} type="button" class="hl-curiosity-viewer__btn" data-act="close" aria-label={t('route.layers.curiosity.card.viewer.close')} onClick={onClose}>
            ×
          </button>
        </header>
        <figure class="hl-curiosity-viewer__fig">
          <img src={i.url} decoding="async" referrerpolicy="no-referrer" alt={alt} />
          <figcaption class="hl-curiosity-viewer__cap">
            {t('route.layers.curiosity.card.viewer.caption', { camera: cameraName(i.camera), instrument: i.instrument, sol: i.sol, taken })}
            {i.camera === 'mastcam' && i.sol === stopSol && <span class="hl-curiosity-viewer__note"> {t('route.layers.curiosity.card.viewer.predates')}</span>}
          </figcaption>
        </figure>
        <footer class="hl-curiosity-viewer__foot">
          {n > 1 && (
            <button type="button" class="hl-curiosity-viewer__btn" data-act="prev" aria-label={t('route.layers.curiosity.card.viewer.prev')} onClick={() => go(-1)}>
              ‹
            </button>
          )}
          <a class="hl-curiosity-viewer__open" href={i.url} target="_blank" rel="noopener noreferrer">
            {t('route.layers.curiosity.card.viewer.open')}
          </a>
          {n > 1 && (
            <button type="button" class="hl-curiosity-viewer__btn" data-act="next" aria-label={t('route.layers.curiosity.card.viewer.next')} onClick={() => go(1)}>
              ›
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  )
}
