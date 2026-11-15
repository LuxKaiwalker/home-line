// Marker card (L1, D111): a small card anchored to a point on the map (the rover, a station). Give it
// a screen point (x, y in px inside the map container) or a MapLibre lngLat plus the map, which it
// follows while the map moves. It sits above and right of the point and flips left or below to stay
// inside the map container. One card at a time: opening a card closes the open one (layout store).
// Render it inside the map container (position: relative). It renders nothing while closed.
import type { ComponentChildren } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useSignalValue } from '../../state/signal'
import { ui } from '../../state/ui'
import { cx, IconButton } from '../components'
import { t } from '../copy'
import { TOKENS } from '../tokens'
import { Heading, type HeadingLevel } from './Heading'
import { closeContainer, domId, useContainer } from './store'
import './layout.css'

/** The part of a MapLibre map the card uses. */
export interface CardMap {
  project(lngLat: [number, number] | { lng: number; lat: number }): { x: number; y: number }
  on(type: 'move' | 'resize', fn: () => void): unknown
  off(type: 'move' | 'resize', fn: () => void): unknown
}

export type CardAnchor = { x: number; y: number } | { lngLat: [number, number] | { lng: number; lat: number }; map: CardMap }

export interface MarkerCardProps {
  /** Layout store id; open it with openContainer(id, opener). */
  id: string
  title: string
  at: CardAnchor
  children: ComponentChildren
  headingLevel?: HeadingLevel
  closeLabel?: string
  /** Open at first render (style guide; cards normally open from a marker click). */
  defaultOpen?: boolean
  class?: string
}

export interface Placement {
  left: number
  top: number
  /** the card sits left of the point */
  flipX: boolean
  /** the card sits below the point */
  flipY: boolean
}

/**
 * Where a card of size `card` goes for the point `p` inside a box of size `box` (px): above-right of the
 * point by `gap`, flipped left / below when it would leave the box, then clamped inside it.
 */
export function placeCard(p: { x: number; y: number }, card: { w: number; h: number }, box: { w: number; h: number }, gap = TOKENS.space[2]): Placement {
  const flipX = p.x + gap + card.w > box.w && p.x - gap - card.w >= 0
  const flipY = p.y - gap - card.h < 0 && p.y + gap + card.h <= box.h
  const clamp = (v: number, max: number) => Math.max(0, Math.min(v, Math.max(0, max)))
  return {
    left: clamp(flipX ? p.x - gap - card.w : p.x + gap, box.w - card.w),
    top: clamp(flipY ? p.y + gap : p.y - gap - card.h, box.h - card.h),
    flipX,
    flipY,
  }
}

const pointOf = (a: CardAnchor): { x: number; y: number } => ('map' in a ? a.map.project(a.lngLat) : a)

export function MarkerCard({ id, title, at, children, headingLevel = 3, closeLabel = t('buttons.close'), defaultOpen, class: cls }: MarkerCardProps) {
  const open = useContainer({ id, kind: 'card', defaultOpen })
  const reduced = useSignalValue(ui.reducedMotion)
  const root = useRef<HTMLElement>(null)
  const [, bump] = useState(0)
  const [place, setPlace] = useState<Placement | null>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)

  // focus moves to the card when it opens (not when it is already open at mount); the opener gets it
  // back on close (layout store)
  const was = useRef(open)
  useLayoutEffect(() => {
    if (open && !was.current) closeBtn.current?.focus()
    was.current = open
  }, [open])

  // follow the map
  const map = 'map' in at ? at.map : undefined
  useLayoutEffect(() => {
    if (!open || !map) return
    const on = () => bump((n) => n + 1)
    map.on('move', on)
    map.on('resize', on)
    return () => {
      map.off('move', on)
      map.off('resize', on)
    }
  }, [open, map])

  const p = open ? pointOf(at) : null
  useLayoutEffect(() => {
    const el = root.current
    if (!el || !p) return
    const box = (el.offsetParent as HTMLElement | null) ?? el.parentElement
    const next = placeCard(p, { w: el.offsetWidth || 0, h: el.offsetHeight || 0 }, { w: box?.clientWidth ?? 0, h: box?.clientHeight ?? 0 })
    if (!place || next.left !== place.left || next.top !== place.top || next.flipX !== place.flipX || next.flipY !== place.flipY) setPlace(next)
  })

  if (!open || !p) return null
  const titleId = domId(id, 'title')
  return (
    <section
      ref={root}
      id={domId(id)}
      class={cx('hl-lay-card', cls)}
      role="dialog"
      aria-labelledby={titleId}
      data-flip-x={place?.flipX ? 'true' : undefined}
      data-flip-y={place?.flipY ? 'true' : undefined}
      data-motion={reduced ? 'reduce' : undefined}
      style={place ? { left: `${place.left}px`, top: `${place.top}px` } : { left: `${p.x}px`, top: `${p.y}px`, visibility: 'hidden' }}
    >
      <header class="hl-lay-card__head">
        <Heading level={headingLevel} id={titleId} class="hl-lay-card__title">
          {title}
        </Heading>
        <IconButton ref={closeBtn} icon="x" label={closeLabel} class="hl-lay-close" onClick={() => closeContainer(id)} />
      </header>
      <div class="hl-lay-card__body">{children}</div>
    </section>
  )
}
