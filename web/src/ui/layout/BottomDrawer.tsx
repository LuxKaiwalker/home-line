// Bottom drawer (L1, D111): tabs over the bottom map edge. Collapsed it is one line: the `collapsed`
// render prop (a one-line summary, or the slim timeline scrubber) and the expand button. Expanded it
// shows the tab list and the active tab, at most 40 % of the map and of the viewport height
// (layout.css). Expand or collapse by click, by keyboard (the button), or by dragging the grip up or
// down. The open (expanded) state and the active tab are remembered per viewer; Esc collapses it when
// it is the topmost container. Its height (collapsed bar included) is reported as layoutInsets.bottom.
import type { ComponentChildren } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { useSignalValue } from '../../state/signal'
import { ui } from '../../state/ui'
import { cx, Icon } from '../components'
import { closeContainer, domId, openContainer, reportInset, setActiveTab, useActiveTab, useContainer } from './store'
import './layout.css'

export interface BottomTab {
  id: string
  label: string
  render: () => ComponentChildren
}

export interface BottomDrawerProps {
  /** Layout store id (the bottom side holds one drawer). */
  id: string
  /** Accessible name of the drawer region and its tab list. */
  label: string
  tabs: readonly BottomTab[]
  /** The collapsed line: a summary of the active tab or the slim scrubber. `expand` opens the drawer. */
  collapsed: (ctx: { tab: string; expand: () => void }) => ComponentChildren
  /** Names of the expand / collapse button (state is also on aria-expanded). */
  expandLabel: string
  collapseLabel: string
  defaultTab?: string
  defaultOpen?: boolean
  persist?: boolean
  class?: string
}

/** Pointer travel (px) that counts as a drag rather than a click. */
const DRAG_PX = 8

export function BottomDrawer({ id, label, tabs, collapsed, expandLabel, collapseLabel, defaultTab, defaultOpen, persist, class: cls }: BottomDrawerProps) {
  const open = useContainer({ id, kind: 'drawer', side: 'bottom', defaultOpen, persist })
  const reduced = useSignalValue(ui.reducedMotion)
  const fallback = defaultTab ?? tabs[0]?.id ?? ''
  const stored = useActiveTab(id, fallback)
  const tab = tabs.some((x) => x.id === stored) ? stored : fallback
  const root = useRef<HTMLElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const drag = useRef<{ y: number; moved: boolean } | null>(null)

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const measure = () => reportInset(id, { bottom: el.offsetHeight || 0 })
    measure()
    const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver
    if (!RO) return () => reportInset(id, undefined)
    const ro = new RO(measure)
    ro.observe(el)
    return () => {
      ro.disconnect()
      reportInset(id, undefined)
    }
  }, [id, open])

  const expand = () => openContainer(id, toggle.current)
  const collapse = () => closeContainer(id, { restoreFocus: false })
  const onToggle = () => (open ? collapse() : expand())

  const onPointerDown = (e: PointerEvent) => {
    drag.current = { y: e.clientY, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d || d.moved) return
    const dy = e.clientY - d.y
    if (Math.abs(dy) < DRAG_PX) return
    d.moved = true
    if (dy < 0 && !open) expand()
    else if (dy > 0 && open) collapse()
  }
  const onClick = () => {
    const moved = drag.current?.moved
    drag.current = null
    if (!moved) onToggle()
  }

  const onTabKey = (i: number) => (e: KeyboardEvent) => {
    const n = tabs.length
    const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
    if (j < 0) return
    e.preventDefault()
    setActiveTab(id, tabs[j].id)
    tabRefs.current[j]?.focus()
  }

  const bodyId = domId(id)
  const active = tabs.find((x) => x.id === tab)
  return (
    <section ref={root} class={cx('hl-lay-bottom', cls)} aria-label={label} data-open={open ? 'true' : 'false'} data-motion={reduced ? 'reduce' : undefined}>
      <div class="hl-lay-bottom__bar">
        <button
          ref={toggle}
          type="button"
          class="hl-iconbtn hl-lay-bottom__grip"
          aria-label={open ? collapseLabel : expandLabel}
          aria-expanded={open ? 'true' : 'false'}
          aria-controls={bodyId}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerCancel={() => (drag.current = null)}
          onClick={onClick}
        >
          <Icon name={open ? 'chevron-down' : 'chevron-up'} />
        </button>
        {open ? (
          <div class="hl-tabs hl-lay-bottom__tabs" role="tablist" aria-label={label}>
            {tabs.map((x, i) => (
              <button
                type="button"
                role="tab"
                ref={(el) => void (tabRefs.current[i] = el)}
                id={domId(id, `tab-${x.id}`)}
                class="hl-tabs__tab"
                aria-selected={x.id === tab ? 'true' : 'false'}
                aria-controls={domId(id, 'panel')}
                tabIndex={x.id === tab ? 0 : -1}
                onClick={() => setActiveTab(id, x.id)}
                onKeyDown={onTabKey(i)}
              >
                {x.label}
              </button>
            ))}
          </div>
        ) : (
          <div class="hl-lay-bottom__summary">{collapsed({ tab, expand })}</div>
        )}
      </div>
      <div id={bodyId} class="hl-lay-bottom__body" hidden={!open}>
        {open && active && (
          <div role="tabpanel" id={domId(id, 'panel')} aria-labelledby={domId(id, `tab-${active.id}`)} class="hl-lay-bottom__panel">
            {active.render()}
          </div>
        )}
      </div>
    </section>
  )
}
