// Map-edge popover (L1, D111): an icon button at an edge of the map that opens a small non-modal
// dialog beside it (the layer manager, the legend). Esc (layout store) or a press outside closes it;
// focus returns to the icon button. One map-edge popover at a time. Render it inside the map
// container (position: relative). Not the inline <Popover> of ui/components (trust chip details).
import type { ComponentChildren } from 'preact'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'
import { useSignalValue } from '../../state/signal'
import { ui } from '../../state/ui'
import { cx, IconButton, type IconName } from '../components'
import { closeContainer, domId, toggleContainer, useContainer } from './store'
import './layout.css'

/** Map edge and end of that edge: 'top-right' = right end of the top edge. */
export type PopoverEdge = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'left-top' | 'right-top'

export interface PopoverProps {
  /** Layout store id (one map-edge popover at a time). */
  id: string
  icon: IconName
  /** Accessible name of the icon button and of the dialog. */
  label: string
  /** Visible title inside the dialog (default: none; the label still names it). */
  title?: string
  edge?: PopoverEdge
  children: ComponentChildren
  defaultOpen?: boolean
  class?: string
}

const FOCUSABLE = new Set(['button', 'a', 'input', 'select', 'textarea'])
/** First focusable descendant in document order (walks child nodes; no selector engine needed). */
function firstFocusable(el: Node): HTMLElement | null {
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType !== 1) continue
    const h = c as HTMLElement
    if (FOCUSABLE.has(h.localName) && !h.hasAttribute('disabled') && (h.localName !== 'a' || h.hasAttribute('href'))) return h
    const d = firstFocusable(h)
    if (d) return d
  }
  return null
}

export function Popover({ id, icon, label, title, edge = 'top-right', children, defaultOpen, class: cls }: PopoverProps) {
  const open = useContainer({ id, kind: 'popover', defaultOpen })
  const reduced = useSignalValue(ui.reducedMotion)
  const wrap = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const was = useRef(open)

  useEffect(() => {
    if (!open) return
    const onDown = (e: Event) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) closeContainer(id, { restoreFocus: false })
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open, id])

  // focus the first control inside when it opens (not when open at mount)
  useLayoutEffect(() => {
    if (open && !was.current && panel.current) firstFocusable(panel.current)?.focus()
    was.current = open
  }, [open])

  const panelId = domId(id)
  const titleId = domId(id, 'title')
  return (
    <div ref={wrap} class={cx('hl-lay-pop', `hl-lay-pop--${edge}`, cls)} data-motion={reduced ? 'reduce' : undefined}>
      <IconButton
        ref={btn}
        icon={icon}
        label={label}
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={() => toggleContainer(id, btn.current)}
      />
      <div ref={panel} id={panelId} class="hl-lay-pop__panel" role="dialog" aria-label={title ? undefined : label} aria-labelledby={title ? titleId : undefined} hidden={!open}>
        {title && (
          <div id={titleId} class="hl-lay-pop__title">
            {title}
          </div>
        )}
        {open && children}
      </div>
    </div>
  )
}
