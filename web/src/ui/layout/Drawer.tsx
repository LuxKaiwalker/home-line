// Right drawer (L1, D111): a side panel over the map with a title and a close button. It is at most
// 40 % of the map width (layout.css), so an open drawer leaves at least 60 % of the map visible, and
// it reports its width to the layout store (layoutInsets.right) so the map can recentre (L2).
// Non-modal by default: the map stays usable while it is open (role="dialog" without aria-modal);
// pass modal for a drawer that must be answered first. Kept mounted while closed (hidden), so the
// content keeps its state and the opener's aria-controls always points at an element.
import type { ComponentChildren } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { useSignalValue } from '../../state/signal'
import { ui } from '../../state/ui'
import { cx, IconButton } from '../components'
import { t } from '../copy'
import { closeContainer, domId, reportInset, useContainer, useLayoutInsets } from './store'
import { Heading, type HeadingLevel } from './Heading'
import './layout.css'

export interface DrawerProps {
  /** Layout store id (one open drawer per side; the open state is remembered per viewer). */
  id: string
  /** Visible title; also the dialog's accessible name. */
  title: string
  children: ComponentChildren
  /** Heading level of the title (default 2). */
  headingLevel?: HeadingLevel
  defaultOpen?: boolean
  /** Remember open/closed per viewer (default true). */
  persist?: boolean
  /** aria-modal (default false: the map stays usable). */
  modal?: boolean
  /** Accessible name of the close button (default copy buttons.close). */
  closeLabel?: string
  /** Extra controls in the header, left of the close button. */
  actions?: ComponentChildren
  class?: string
}

export function Drawer({ id, title, children, headingLevel = 2, defaultOpen, persist, modal = false, closeLabel = t('buttons.close'), actions, class: cls }: DrawerProps) {
  const open = useContainer({ id, kind: 'drawer', side: 'right', defaultOpen, persist })
  const reduced = useSignalValue(ui.reducedMotion)
  // it ends above the bottom drawer, so the two never overlap
  const { bottom } = useLayoutInsets()
  const root = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(open)

  // report the covered width; move focus in when it opens (to the close button: the panel itself is not
  // a tab stop), so Esc and Tab work from the keyboard at once
  useLayoutEffect(() => {
    const el = root.current
    if (!open || !el) return reportInset(id, undefined)
    const measure = () => reportInset(id, { right: el.offsetWidth || 0 })
    measure()
    const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver
    if (!RO) return () => reportInset(id, undefined)
    const ro = new RO(measure)
    ro.observe(el)
    return () => {
      ro.disconnect()
      reportInset(id, undefined)
    }
  }, [open, id])
  useLayoutEffect(() => {
    if (open && !wasOpen.current) closeBtn.current?.focus()
    wasOpen.current = open
  }, [open])

  const titleId = domId(id, 'title')
  return (
    <div
      ref={root}
      id={domId(id)}
      class={cx('hl-lay-drawer', 'hl-lay-drawer--right', cls)}
      role="dialog"
      aria-modal={modal ? 'true' : undefined}
      aria-labelledby={titleId}
      hidden={!open}
      data-motion={reduced ? 'reduce' : undefined}
      style={{ bottom: `${bottom}px` }}
    >
      <header class="hl-lay-drawer__head">
        <Heading level={headingLevel} id={titleId} class="hl-lay-drawer__title">
          {title}
        </Heading>
        {actions}
        <IconButton ref={closeBtn} icon="x" label={closeLabel} class="hl-lay-close" onClick={() => closeContainer(id)} />
      </header>
      <div class="hl-lay-drawer__body">{children}</div>
    </div>
  )
}
