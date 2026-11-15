// Command palette dialog (DESIGN U17, §3.7 "Command palette: empty, results, no results"; package A8).
// Lazy chunk: the top-bar button (button.tsx) imports it on first open. ARIA 1.2 combobox pattern:
// the input is role=combobox and keeps focus; the active option is aria-activedescendant; ↑/↓ move
// (wrapping), Enter chooses, Escape closes. The dialog is modal (native showModal: the page behind is
// inert) and Tab / Shift+Tab cycle between the input and the close button (focus trap). Focus returns to
// the opener on close.
// Keys the palette handles stop propagating, so the shell's window listener (keys.ts) never sees them:
// Escape closes the palette without clearing the selection. Ctrl+K still reaches the shell and toggles.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { data, type Loader } from '../../data/loader'
import { select } from '../../state/selection'
import { useSignalValue } from '../../state/signal'
import { ui } from '../../state/ui'
import { Badge, ChipMark, cx, Icon } from '../components'
import { t } from '../copy'
import { commands, getCommand, liveStatus, reasonFor, runCommand } from '../commands/registry'
import { isMapMode, modeHash, openSidebar, shell } from '../shell/store'
import { expandedIndex, resetExpandedIndex } from './index/lazy'
import { commandItems, GROUP_LABEL, loadObjectIndex, rank, type RunEnv, type SearchItem } from './search'
// S3a: answer rows (search.md §2) above the fuzzy results
import { completePrefix, runQueries, useQueryContext, type QueryContext } from './queries'
import { AnswerRow } from './queries/row'
import './search.css'

/** Shown text of an item: the file's name for objects, copy.json for commands. */
export const labelOf = (i: SearchItem): string => (i.label ? t(i.label) : i.name)

let cached: Promise<SearchItem[]> | null = null
/** Objects (static files, loader-cached) + the expanded index (built here on first open). The palette adds
 *  the registered commands (ui/commands) live, so commands registered later (live layer) and their state show. */
export function searchIndex(L: Loader = data()): Promise<SearchItem[]> {
  return (cached ??= Promise.all([loadObjectIndex(L), expandedIndex(L)]).then(([objs, more]) => [...objs, ...more]))
}

/** Why a command row cannot run now (null for objects and enabled commands). */
export const disabledReason = (i: SearchItem): string | null => {
  const c = i.commandId ? getCommand(i.commandId) : undefined
  const r = c ? reasonFor(c) : null
  return r && t(r)
}
/** Tests: forget the built index. */
export const resetSearchIndex = (): void => void ((cached = null), resetExpandedIndex())

export type { RunEnv }

/** Enter on a result. Objects: select(ref, 'search'), the same call a map or list click makes, so the
 *  sidebar shows the same card; outside PLAN/FLY the sidebar is hidden, so PLAN opens first. Commands:
 *  runCommand (ui/commands), which does nothing while the command is disabled. */
export function runItem(item: SearchItem, env: RunEnv): void {
  if (item.run) return item.run(env) // layers, clock, scenarios, report routes (index/sources.ts)
  if (item.ref) {
    if (!isMapMode(ui.mode.peek() ?? 'plan')) env.navigate(modeHash('plan'))
    select(item.ref, 'search')
    // L2d (D111): a station the Plan map shows in its own card (shell.hosted 'station') keeps the sidebar shut
    if (!(item.ref.kind === 'station' && shell.hosted.peek().includes('station'))) openSidebar()
    return
  }
  if (item.commandId) runCommand(item.commandId, 'palette')
}

export interface PaletteProps {
  onClose: () => void
  /** Default: the app loader (static data tree). */
  loader?: Loader
  navigate?: (hash: string) => void
  win?: Window
  /** Tests: a ready object index instead of loading one (registered commands are always added). */
  items?: SearchItem[]
  /** Tests: a ready query context instead of loading one. */
  queryContext?: QueryContext
}

const defaultNavigate = (hash: string): void => {
  if (location.hash !== hash) location.hash = hash
}

export function Palette({ onClose, loader, navigate = defaultNavigate, win = typeof window === 'undefined' ? undefined : window, items: given, queryContext }: PaletteProps) {
  const [items, setItems] = useState<SearchItem[] | null>(given ?? null)
  const [failed, setFailed] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const dlg = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (given) return
    let alive = true
    searchIndex(loader).then(
      (x) => alive && setItems(x),
      () => alive && setFailed(true),
    )
    return () => void (alive = false)
  }, [])

  // open modal, focus the input; on unmount close and give focus back to the opener
  useEffect(() => {
    const d = dlg.current
    const back = (globalThis.document?.activeElement ?? null) as HTMLElement | null
    if (d) {
      if (typeof d.showModal === 'function' && !d.open) d.showModal()
      else d.setAttribute('open', '')
    }
    input.current?.focus()
    return () => {
      if (d && typeof d.close === 'function' && d.open) d.close()
      back?.focus?.()
    }
  }, [])

  const cmds = useSignalValue(commands)
  const all = useMemo(() => (items ? [...items, ...commandItems(cmds)] : null), [items, cmds])
  const live = useSignalValue(liveStatus).reachable // S3a: live-only answer rows (spec rule 4)
  const qctx = useQueryContext(loader ?? (given ? null : data()), live, queryContext) // S3a (tests: given items, no loader → none)
  const answers = useMemo(() => (qctx ? runQueries(q, qctx) : []), [qctx, q])
  const off = answers.length
  const results = useMemo(() => (all ? rank(all, q, labelOf) : []), [all, q])
  const total = off + results.length
  const cur = Math.min(active, Math.max(total - 1, 0))
  const why = results.map(({ item }) => disabledReason(item)) // read at render: a disabled command row says why
  const optId = (i: number) => `hl-search-opt-${i}`

  const choose = (item: SearchItem | undefined) => {
    if (!item || disabledReason(item)) return // a disabled command row says why and does nothing
    onClose()
    runItem(item, { navigate, win })
  }

  const chooseAt = (i: number) => {
    if (i >= off) return choose(results[i - off]?.item)
    const r = answers[i]
    if (r.disabledReason) return
    onClose()
    r.run({ navigate, win })
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const n = total
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        if (n) setActive((cur + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
        break
      case 'Enter':
        if (e.target === closeBtn.current) return
        chooseAt(cur)
        break
      case 'Escape':
        onClose()
        break
      case 'Tab': {
        const a = globalThis.document?.activeElement
        const done = !e.shiftKey && a === input.current ? completePrefix(q) : null // §2.3 Tab completes a pattern
        if (done) setQ(done), setActive(0)
        else if (!e.shiftKey && a === closeBtn.current) input.current?.focus()
        else if (e.shiftKey && a === input.current) closeBtn.current?.focus()
        else return
        break
      }
      default:
        return
    }
    e.preventDefault()
    e.stopPropagation() // the shell's window listener skips handled keys (Escape must not clear the selection)
  }

  const expanded = total > 0
  return (
    <dialog
      ref={dlg}
      class="hl-ui hl-search"
      aria-label={t('nav.search')}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => e.target === dlg.current && onClose()}
    >
      <div class="hl-search__field">
        <Icon name="search" />
        <input
          ref={input}
          id="hl-search-input"
          class="hl-search__input"
          type="text"
          role="combobox"
          aria-label={t('nav.search')}
          aria-autocomplete="list"
          aria-expanded={expanded ? 'true' : 'false'}
          aria-controls="hl-search-list"
          aria-activedescendant={expanded ? optId(cur) : undefined}
          autocomplete="off"
          spellcheck={false}
          placeholder={t('search.placeholder')}
          value={q}
          onInput={(e) => {
            setQ((e.currentTarget as HTMLInputElement).value)
            setActive(0)
          }}
        />
        <button ref={closeBtn} type="button" class="hl-iconbtn hl-search__close" aria-label={t('buttons.close')} onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <ul id="hl-search-list" class="hl-search__list" role="listbox" aria-label={t('nav.search')}>
        {answers.map((r, i) => (
          <AnswerRow key={r.id} row={r} id={optId(i)} active={i === cur} onChoose={() => chooseAt(i)} onHover={() => setActive(i)} />
        ))}
        {results.map(({ item }, i) => (
          <li
            key={item.id}
            id={optId(off + i)}
            role="option"
            aria-selected={off + i === cur ? 'true' : 'false'}
            aria-disabled={why[i] ? 'true' : undefined}
            aria-describedby={why[i] ? `${optId(off + i)}-why` : undefined}
            aria-keyshortcuts={item.keys?.length ? item.keys.join(' ') : undefined}
            class={cx('hl-search__opt', off + i === cur && 'is-active')}
            data-id={item.id}
            onMouseDown={(e) => e.preventDefault() /* keep focus in the input */}
            onMouseMove={() => off + i !== cur && setActive(off + i)}
            onClick={() => choose(item)}
          >
            <Icon name={item.icon} />
            {item.code && <Badge>{item.code}</Badge>}
            <span class="hl-search__name">
              {labelOf(item)}
              {item.hint && <span class="hl-search__kind"> · {t(item.hint)}</span>}
            </span>
            {why[i] ? (
              <span id={`${optId(off + i)}-why`} class="hl-search__kind">
                {t('search.unavailable', { reason: why[i]! })}
              </span>
            ) : (
              <span class="hl-search__kind">{t(GROUP_LABEL[item.group])}</span>
            )}
            {item.chip && <ChipMark kind={item.chip} />}
            {item.keys?.map((k) => (
              <kbd key={k} aria-hidden="true">
                {k}
              </kbd>
            ))}
          </li>
        ))}
      </ul>
      <p class="hl-search__status" role="status" aria-live="polite">
        {failed
          ? t('states.error.generic', { what: t('nav.search') })
          : !items
            ? t('states.loading.generic', { what: t('nav.search') })
            : q.trim() && !total
              ? t('search.noResults', { query: q.trim() })
              : ''}
      </p>
    </dialog>
  )
}
