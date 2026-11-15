// Collapsible section (L1, D111): a heading whose button shows or hides the section body
// (aria-expanded, aria-controls). Its state is remembered per viewer (layout store). Esc does not
// collapse it: it is part of the page, not a layer over the map.
import type { ComponentChildren } from 'preact'
import { useSignalValue } from '../../state/signal'
import { ui } from '../../state/ui'
import { cx, Icon } from '../components'
import { Heading, type HeadingLevel } from './Heading'
import { closeContainer, domId, openContainer, useContainer } from './store'
import './layout.css'

export interface CollapsibleProps {
  /** Layout store id. */
  id: string
  /** Header text, e.g. "Crew: default". */
  title: ComponentChildren
  children: ComponentChildren
  /** Short text right of the title (e.g. "Edit"); part of the button's name. */
  hint?: ComponentChildren
  headingLevel?: HeadingLevel
  defaultOpen?: boolean
  persist?: boolean
  class?: string
}

export function Collapsible({ id, title, children, hint, headingLevel = 3, defaultOpen, persist, class: cls }: CollapsibleProps) {
  const open = useContainer({ id, kind: 'section', defaultOpen, persist })
  const reduced = useSignalValue(ui.reducedMotion)
  const bodyId = domId(id)
  return (
    <section class={cx('hl-lay-sec', cls)} data-open={open ? 'true' : 'false'} data-motion={reduced ? 'reduce' : undefined}>
      <Heading level={headingLevel} class="hl-lay-sec__head">
        <button
          type="button"
          class="hl-lay-sec__btn"
          aria-expanded={open ? 'true' : 'false'}
          aria-controls={bodyId}
          onClick={(e) => (open ? closeContainer(id, { restoreFocus: false }) : openContainer(id, e.currentTarget as HTMLElement))}
        >
          <Icon name={open ? 'chevron-down' : 'chevron-right'} />
          <span class="hl-lay-sec__title">{title}</span>
          {hint && <span class="hl-lay-sec__hint">{hint}</span>}
        </button>
      </Heading>
      <div id={bodyId} class="hl-lay-sec__body" hidden={!open}>
        {children}
      </div>
    </section>
  )
}
