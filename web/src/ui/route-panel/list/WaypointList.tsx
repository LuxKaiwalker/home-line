// PORT U2: the Route panel's waypoint list (port of views/mission.tsx WaypointList + WaypointEditor)
// on the ONE planning store (state/planning.ts). Every edit is one store action, so one undo step:
// reorder (drag handle, Alt+Up/Down anywhere in a row, or the up/down buttons), delete, tags, stop time
// (committed on change, clamped to 0…STOP_MIN_MAX) and the note (typing is debounced into one step per
// blur or 600 ms idle). Per-leg estimates and unreachable markers come from the route results
// (interfaces.md §9), matched to stops by id; the walk home is the row after the list.
// A11y: an <ol> of stops, named buttons, aria-keyshortcuts on the handle, and every reorder / delete
// announced in a polite live region. Strings: copy.list.json (I4 merges into route.list).
import './list.css'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { copyFrom } from '../../copy'
import { Icon } from '../../components/Icon'
import { PLAN_TAGS, planning, selectPad, selectRoute, usePlanning, type PlanStop, type PlanningStore, type StopId } from '../../../state/planning'
import { clampStopMin, displayLabels, legsForStops, STOP_MIN_MAX, STOP_MIN_STEP, stopSummary, toggleTag, type LegView } from './model'
import { useRouteResults, type RouteResults } from './routeResults'
import own from './copy.list.json'

export const tl = copyFrom(own)

/** Note typing idle time before it becomes one undo step (blur commits at once). */
export const NOTE_IDLE_MS = 600

export interface WaypointListProps {
  /** default: the app's planning store */
  store?: PlanningStore
  /** default: the app's route results (§9 useRouteResults) */
  results?: RouteResults
  /** station id → display name; default config/stations.yaml names */
  stationName?: (id: string) => string | undefined
  noteIdleMs?: number
}

type Role = 'handle' | 'up' | 'down' | 'remove'

export function WaypointList({ store = planning, results, stationName, noteIdleMs = NOTE_IDLE_MS }: WaypointListProps) {
  const route = usePlanning(selectRoute, store)
  const padId = usePlanning(selectPad, store)
  const live = useRouteResults((r) => r)
  const stops = route.stops
  const labels = displayLabels(stops, stationName)
  const legs = legsForStops(stops, results ?? live, padId)

  const [said, setSaid] = useState('')
  const [over, setOver] = useState<number | null>(null)
  const dragFrom = useRef<number | null>(null)
  const controls = useRef(new Map<string, HTMLElement>())
  const focusNext = useRef<{ id: StopId; role: Role } | { el: HTMLElement } | 'end' | null>(null)
  const listEnd = useRef<HTMLElement | null>(null)

  const reg = (id: StopId, role: Role) => (el: HTMLElement | null) => {
    if (el) controls.current.set(`${id}:${role}`, el)
    else controls.current.delete(`${id}:${role}`)
  }

  // Keyboard users keep their place: after a reorder / delete, focus goes back to the same control.
  useLayoutEffect(() => {
    const f = focusNext.current
    focusNext.current = null
    if (!f) return
    if (f === 'end') return listEnd.current?.focus()
    if ('el' in f) return f.el.focus()
    const el = controls.current.get(`${f.id}:${f.role}`)
    const usable = el && !el.hasAttribute('disabled') ? el : controls.current.get(`${f.id}:handle`)
    usable?.focus()
  })

  function move(from: number, to: number, keep?: { role: Role } | { el: HTMLElement }) {
    const s = stops[from]
    if (!s) return
    const name = labels[from]
    if (to < 0) return setSaid(tl('announce.first', { name }))
    if (to >= stops.length) return setSaid(tl('announce.last', { name }))
    if (!store.reorderStops(from, to)) return
    if (keep) focusNext.current = 'el' in keep ? keep : { id: s.id, role: keep.role }
    setSaid(tl('announce.moved', { name, n: to + 1, total: stops.length }))
  }

  function remove(i: number) {
    const s = stops[i]
    if (!s || !store.removeStop(s.id)) return
    const next = stops[i + 1] ?? stops[i - 1]
    if (next) focusNext.current = { id: next.id, role: 'handle' }
    else focusNext.current = 'end'
    setSaid(tl('announce.removed', { name: labels[i] }))
  }

  function onRowKey(i: number, e: KeyboardEvent) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    const t = e.target as HTMLElement
    const role = t.getAttribute?.('data-role') as Role | null
    move(i, i + (e.key === 'ArrowUp' ? -1 : 1), role ? { role } : { el: t })
  }

  const live_ = (
    <p class="rpl-sr" role="status" aria-live="polite" aria-atomic="true">
      {said}
    </p>
  )

  if (!stops.length)
    return (
      <section class="rpl" aria-label={tl('title')}>
        <p class="rpl-empty" tabIndex={-1} ref={(el) => void (listEnd.current = el)}>
          {tl('empty')}
        </p>
        {live_}
      </section>
    )

  return (
    <section class="rpl" aria-label={tl('title')}>
      <ol class="rpl-list" aria-label={tl('listLabel')}>
        {stops.map((s, i) => {
          const name = labels[i]
          const leg = legs.into[i]
          const bad = leg.kind === 'infeasible'
          return (
            <li
              key={s.id}
              class={['rpl-row', bad && 'is-infeasible', over === i && dragFrom.current !== i && 'is-over'].filter(Boolean).join(' ')}
              data-stop-id={s.id}
              onKeyDown={(e) => onRowKey(i, e)}
              onDragOver={(e) => {
                if (dragFrom.current === null) return
                e.preventDefault()
                if (over !== i) setOver(i)
              }}
              onDragLeave={() => over === i && setOver(null)}
              onDrop={(e) => {
                e.preventDefault()
                const from = dragFrom.current
                dragFrom.current = null
                setOver(null)
                if (from !== null && from !== i) move(from, i)
              }}
            >
              <div class="rpl-head">
                <button
                  type="button"
                  class="rpl-handle"
                  data-role="handle"
                  draggable
                  ref={reg(s.id, 'handle')}
                  aria-label={tl('handle', { name })}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  title={tl('handle', { name })}
                  onDragStart={(e) => {
                    dragFrom.current = i
                    if (e.dataTransfer) {
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', s.id)
                    }
                  }}
                  onDragEnd={() => {
                    dragFrom.current = null
                    setOver(null)
                  }}
                >
                  <Icon name="menu" />
                </button>
                <span class="rpl-num" aria-hidden="true">
                  {i + 1}
                </span>
                <span class="rpl-name">
                  <span class="rpl-label">{name}</span>
                  <span class="rpl-kind">{tl(s.kind === 'station' ? 'kind.station' : 'kind.point')}</span>
                </span>
                <span class="rpl-actions">
                  <button type="button" class="rpl-btn" data-role="up" ref={reg(s.id, 'up')} aria-label={tl('moveUp', { name })} title={tl('moveUp', { name })} disabled={i === 0} onClick={() => move(i, i - 1, { role: 'up' })}>
                    <Icon name="chevron-up" />
                  </button>
                  <button type="button" class="rpl-btn" data-role="down" ref={reg(s.id, 'down')} aria-label={tl('moveDown', { name })} title={tl('moveDown', { name })} disabled={i === stops.length - 1} onClick={() => move(i, i + 1, { role: 'down' })}>
                    <Icon name="chevron-down" />
                  </button>
                  <button type="button" class="rpl-btn rpl-btn--remove" data-role="remove" ref={reg(s.id, 'remove')} aria-label={tl('remove', { name })} title={tl('remove', { name })} onClick={() => remove(i)}>
                    <Icon name="x" />
                  </button>
                </span>
              </div>
              <LegLine leg={leg} from={i === 0 ? tl('pad') : labels[i - 1]} />
              <StopEditor stop={s} name={name} store={store} noteIdleMs={noteIdleMs} />
            </li>
          )
        })}
      </ol>
      <div class={['rpl-home', legs.home.kind === 'infeasible' && 'is-infeasible'].filter(Boolean).join(' ')}>
        <span class="rpl-home-label">{tl('home')}</span>
        <LegLine leg={legs.home} from={labels[labels.length - 1]} />
      </div>
      <button
        type="button"
        class="rpl-clear"
        ref={(el) => void (listEnd.current = el)}
        onClick={() => {
          if (!store.replaceRoute({ ...route, stops: [] })) return
          focusNext.current = 'end'
          setSaid(tl('announce.cleared'))
        }}
      >
        {tl('clearAll')}
      </button>
      {live_}
    </section>
  )
}

/** "From Pad · Estimate 18.5 min", "computing…", or the unreachable marker. */
function LegLine({ leg, from }: { leg: LegView; from: string }) {
  if (leg.kind === 'infeasible') {
    const key = (['unreachable', 'budget', 'slope'] as const).find((k) => k === leg.reason) ?? 'other'
    return (
      <p class="rpl-leg rpl-leg--bad" title={tl('unreachableTitle')} data-reason={leg.reason}>
        <Icon name="triangle-alert" />
        <span>{tl(`unreachable.${key}`)}</span>
      </p>
    )
  }
  return (
    <p class="rpl-leg">
      <span>{tl('legFrom', { from })}</span>
      {leg.kind === 'ok' && leg.minutes !== null && <span class="rpl-est">{tl('estimate', { minutes: leg.minutes.toFixed(1) })}</span>}
      {leg.kind === 'computing' && <span class="rpl-muted">{tl('computing')}</span>}
    </p>
  )
}

function StopEditor({ stop, name, store, noteIdleMs }: { stop: PlanStop; name: string; store: PlanningStore; noteIdleMs: number }) {
  const summary = stopSummary(stop, (minutes) => tl('summaryStop', { minutes }))
  return (
    <details class="rpl-edit">
      <summary>{summary || <span class="rpl-muted">{tl('details')}</span>}</summary>
      <label class="rpl-stop">
        <span>{tl('stopTime')}</span>
        <input
          type="number"
          min={0}
          max={STOP_MIN_MAX}
          step={STOP_MIN_STEP}
          inputMode="numeric"
          aria-label={tl('stopTimeLabel', { name, max: STOP_MIN_MAX })}
          value={stop.stopMin}
          onChange={(e) => {
            const el = e.currentTarget
            const v = clampStopMin(parseFloat(el.value))
            el.value = String(v) // show the clamped value even when the store does not change
            store.updateStop(stop.id, { stopMin: v })
          }}
        />
        <span>{tl('unit')}</span>
      </label>
      <div class="rpl-tags" role="group" aria-label={tl('tagsLabel', { name })}>
        {PLAN_TAGS.map((tag) => {
          const on = stop.tags.includes(tag)
          return (
            <button type="button" key={tag} class={on ? 'rpl-tag is-on' : 'rpl-tag'} aria-pressed={on ? 'true' : 'false'} onClick={() => store.updateStop(stop.id, { tags: toggleTag(stop.tags, tag) })}>
              {tag}
            </button>
          )
        })}
      </div>
      <NoteField stop={stop} name={name} store={store} idleMs={noteIdleMs} />
    </details>
  )
}

/** The note: local draft while typing; one updateStop per blur or idle pause (one undo step). */
function NoteField({ stop, name, store, idleMs }: { stop: PlanStop; name: string; store: PlanningStore; idleMs: number }) {
  const [draft, setDraft] = useState(stop.note)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<string | null>(null)
  const commit = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const v = pending.current
    pending.current = null
    if (v !== null) store.updateStop(stop.id, { note: v })
  }
  // An outside change (undo, link load) shows up unless the user is mid-typing.
  useEffect(() => {
    if (pending.current === null) setDraft(stop.note)
  }, [stop.note])
  // Leaving the row (delete, panel closed) never loses typed text.
  useEffect(() => () => commit(), [])
  return (
    <textarea
      class="rpl-note"
      rows={2}
      placeholder={tl('notePlaceholder')}
      aria-label={tl('noteLabel', { name })}
      value={draft}
      onInput={(e) => {
        const v = e.currentTarget.value
        setDraft(v)
        pending.current = v
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(commit, idleMs)
      }}
      onBlur={commit}
    />
  )
}
