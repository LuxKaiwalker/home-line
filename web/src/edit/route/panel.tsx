// Edit-route panel (R5, D97 §3): Plan rail section in live builds. RoutePanelView is a pure function
// of its props (tests render it without hooks); RoutePanel binds it to the controller's signals.
//   mode       Engine chooses (auto: no route sent) / My order (ordered)
//   stations   the six stations: checkbox + drag handle; checked ones first in route order; Alt+Up/Down
//              moves the focused one (keyboard alternative of the drag); validity per stop
//   compute    Compute plan -> one live job; stages appear as they finish (nominal band and route
//              first); the result carries "Computed live · your route" and a provenance link
//   infeasible the first failing leg, its limit and the time short; that leg is marked in the legs list
//              and on the map; nothing is reordered
// Every edit is one undo step (route store). WP12 (L6 W-5): no panel-local key handler any more: the one
// global Ctrl/Cmd-Z (ui/shell/keys.ts) and the Undo / Redo buttons run the Plan view's one undo
// (undo.ts: route edits and rover / plan edits in the order they were made), from anywhere.
// WP12 (L6 W-4): ticking a station while the engine chooses switches to "My order" (controller); every
// control that stays disabled names its reason (title + aria-describedby on a visible or hidden note).
// WP12 (L6 W-1): the one compute action; the inputs line says which pad and crew go with it.
import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { signal, useSignalValue, type ReadSignal } from '../../state/signal'
import { t } from '../../ui/copy'
import { Button, IconButton } from '../../ui/components/Button'
import { cx, Icon } from '../../ui/components/Icon'
import type { ComputeState, RouteController } from './controller'
import { isStationStop, layoutIds, ROUTE_LIMITS, type PlanRoute, type RouteCheck, type StationGeo, type StopCheck } from './model'
import { failureText, fill, infeasibleText, ROUTE_PROBLEM_TEXT, ROUTE_TEXT as T, STOP_PROBLEM_TEXT } from './text'
import { AddPointButton, GhostSummary, PointRowBody } from './map/rows'
import type { SharedUndo } from './undo'
import type { RouteEstimate } from './instant/estimate'
import { EstimateBox } from './instant/view'
import './route.css'

export interface RouteRow {
  id: string
  name: string
  checked: boolean
  /** index in route.stops, null when unchecked */
  index: number | null
  check: StopCheck | null
  /** WP6: a free point (W1, W2, …) and its label; absent for a station */
  point?: { label: string | undefined }
}

/**
 * Checked stations and free points first, in route order, then the unchecked stations in stations.json
 * order; with a `layout` (W-7: kept since the last explicit reorder) the rows keep those places instead.
 */
export function routeRows(route: PlanRoute, stations: readonly StationGeo[], check: RouteCheck, layout: readonly string[] | null = null): RouteRow[] {
  const rows = routeRowsInOrder(route, stations, check)
  if (!layout) return rows
  const ids = layoutIds(
    rows.map((r) => r.id),
    layout,
    (id) => rows.find((r) => r.id === id)?.checked ?? false,
  )
  return ids.map((id) => rows.find((r) => r.id === id)!)
}

function routeRowsInOrder(route: PlanRoute, stations: readonly StationGeo[], check: RouteCheck): RouteRow[] {
  const name = (id: string) => stations.find((s) => s.id === id)?.name ?? id
  const rows: RouteRow[] = []
  let w = 0
  route.stops.forEach((s, i) => {
    if (isStationStop(s)) rows.push({ id: s.station, name: name(s.station), checked: true, index: i, check: check.stops[i] ?? null })
    else rows.push({ id: `W${++w}`, name: s.label ?? '', checked: true, index: i, check: check.stops[i] ?? null, point: { label: s.label } })
  })
  for (const s of stations) if (!rows.some((r) => r.id === s.id)) rows.push({ id: s.id, name: s.name ?? s.id, checked: false, index: null, check: null })
  return rows
}

function stopStatus(c: StopCheck | null): { text: string; state: 'valid' | 'invalid' | 'unknown' } | null {
  if (!c) return null
  if (c.valid === false)
    return { state: 'invalid', text: c.problems.map((p) => fill(STOP_PROBLEM_TEXT[p], { m: ROUTE_LIMITS.minStopSpacingM, n: ROUTE_LIMITS.maxStops })).join(', ') }
  return c.valid ? { state: 'valid', text: T.stopValid } : { state: 'unknown', text: T.stopUnknown }
}

export interface RoutePanelViewProps {
  ctl: RouteController
  route: PlanRoute
  check: RouteCheck
  compute: ComputeState
  hash: string | undefined
  canUndo: boolean
  canRedo: boolean
  dragging: number | null
  /** live planning can take a job now */
  live: boolean
  /** why it cannot (offline, warming, heavy jobs off); null = the generic reason */
  reason?: string | null
  /** WP12: the one undo of the Plan view (undo.ts); absent = the route store's own */
  undo?: SharedUndo | null
  /** WP12: why the job cannot start although the route is fine (crew panel), or null */
  blocked?: string | null
  /** WP12 (W-7): row layout kept since the last explicit reorder (controller.layout); null = route order */
  layout?: readonly string[] | null
  /** S1 slot in the result box (done and infeasible results; nothing while running or without a result) */
  resultSlot?: ResultSlot | null
  /** WP12: the root element (the panel focuses the progress through it) */
  rootRef?: { current: HTMLDivElement | null }
  /** I1b (D128): the instant browser estimate (recomputed on every edit; Send to simulator); null = none */
  estimate?: RouteEstimate | null
}

/** ids of the reason notes the disabled controls point at (aria-describedby); one panel per page */
export const WHY_ID = {
  locked: 'hl-route-why-locked',
  points: 'hl-route-why-points',
  compute: 'hl-route-why-compute',
  live: 'hl-route-why-live',
  undo: 'hl-route-why-undo',
  redo: 'hl-route-why-redo',
} as const

const fmtDeg = (v: number) => v.toFixed(6) // the user's own click, not a computed number

/** Which rover pad and crew go with Compute plan (W-1: the one job carries pad + crew + route). */
function inputsLine(ctl: RouteController): string {
  const step = ctl.store.step.peek()
  const pad = step.plan.pad
  const padText =
    typeof pad === 'object' ? fill(T.inputsPadCustom, { lon: fmtDeg(pad.lon), lat: fmtDeg(pad.lat) }) : pad === ctl.store.catalog.officialPadId ? T.inputsPadOfficial : fill(T.inputsPad, { pad })
  const crewChanged = Object.keys(step.inputs.crew ?? {}).some((k) => k !== 'suit_kg')
  return `${padText} · ${crewChanged ? T.inputsCrewChanged : T.inputsCrewDefault}`
}


function StageList({ c }: { c: Extract<ComputeState, { kind: 'running' | 'done' | 'failed' }> }) {
  const layers = c.stage?.layers ?? []
  const first = layers.includes('bands') && layers.includes('route')
  const rest = ['isochrones', 'edges', 'partner'].some((l) => layers.includes(l)) && (c.kind !== 'running' || (c.job?.stagesDone.length ?? 0) > 1)
  return (
    <div class="hl-route__stages" data-trust="live">
      <h4 class="hl-route__subtitle">{T.stagesTitle}</h4>
      <ol class="hl-route__stagelist">
        <li class={cx('hl-route__stage', first && 'is-shown')} data-stage="first">
          {T.stageFirst} · {first ? T.stageShown : T.stageWaiting}
        </li>
        <li class={cx('hl-route__stage', rest && 'is-shown')} data-stage="rest">
          {T.stageRest} · {rest ? T.stageShown : T.stageWaiting}
        </li>
      </ol>
      {c.kind === 'running' && c.job ? (
        <p class="hl-route__progress" role="status" tabIndex={-1}>
          {c.job.stage ?? c.job.status} · {Math.round(c.job.progress * 100)} %
        </p>
      ) : null}
      {c.stage?.errors.length ? <p class="hl-route__warn">{c.stage.errors.join('; ')}</p> : null}
    </div>
  )
}

/** Extra content of the result box (S1 "Send to simulator", mounted by the live side); done results only. */
export type ResultSlot = (c: Extract<ComputeState, { kind: 'done' }>) => ComponentChildren

function ResultView({ c, slot }: { c: Extract<ComputeState, { kind: 'done' }>; slot?: ResultSlot | null }) {
  const r = c.result
  const f = r.feasibility
  return (
    <div class="hl-route__result" data-trust="live" data-hash={r.hash}>
      <p class="hl-route__label">
        {T.computedLabel} ·{' '}
        <a class="hl-route__prov" href={r.provenanceHref}>
          {T.provenance} {r.hash}
        </a>
        {r.engineCommit ? <span class="hl-route__commit"> · engine {r.engineCommit.slice(0, 8)}</span> : null}
      </p>
      {r.recordError ? <p class="hl-route__warn">{r.recordError}</p> : null}
      {f === null ? <p class="hl-route__note">{T.feasibilityUnknown}</p> : null}
      {f?.feasible ? <p class="hl-route__ok">{T.feasible}</p> : null}
      {f && !f.feasible ? (
        <div class="hl-route__infeasible" role="alert" data-leg={f.leg} data-limit={f.limit}>
          <p class="hl-route__infeasible-title">
            <Icon name="triangle-alert" /> {T.infeasibleTitle}
          </p>
          {(() => {
            // D117: one sentence per limit; the O₂ shortfall is a departure-time shortfall
            const x = infeasibleText(f, (n) => (n === 'pad' ? T.pad : n))
            return (
              <p class="hl-route__infeasible-leg">
                <span class="hl-route__infeasible-limit">{x.head}</span>:{' '}
                <span class="hl-route__infeasible-short">
                  {f.shortfallMin === null ? (
                    x.short
                  ) : (
                    <span class="num" data-trust="live" title={`${T.computedLabel} · run record ${r.hash}`}>
                      {x.short}
                    </span>
                  )}
                </span>
              </p>
            )
          })()}
          <p class="hl-route__note">{T.infeasibleNote}</p>
        </div>
      ) : null}
      {slot ? <div class="hl-route__result-slot">{slot(c)}</div> : null}
    </div>
  )
}

export function RoutePanelView(p: RoutePanelViewProps) {
  const { ctl, route, check, compute: c } = p
  const ordered = route.mode === 'ordered'
  const rows = routeRows(route, ctl.stations, check, p.layout ?? null)
  const running = c.kind === 'running'
  const failing = c.kind === 'done' && c.result.feasibility && !c.result.feasibility.feasible ? c.result.feasibility.leg : null
  const stopName = (i: number) => {
    const s = route.stops[i]
    return s ? (isStationStop(s) ? s.station : (s.label ?? null)) : null
  }

  const undo = p.undo
  const doUndo = () => (undo ? undo.undo() : ctl.undo())
  const doRedo = () => (undo ? undo.redo() : ctl.redo())
  // W-4: every disabled control names its reason
  const lockedWhy = running ? T.whyLocked : null
  const pointsWhy = running ? T.whyLocked : !ordered ? T.whyPointsAuto : null
  const hasPoints = rows.some((r) => r.point)
  const routeProblems = check.route.map((x) => fill(ROUTE_PROBLEM_TEXT[x], { n: x === 'tooManyFreePoints' ? ROUTE_LIMITS.maxFreePoints : ROUTE_LIMITS.maxStops })).join(' ')
  const computeWhy = running || !p.live ? null : p.dragging !== null ? T.whyDragging : !check.ok ? routeProblems || T.whyStops : (p.blocked ?? null)
  const undoWhy = running ? T.whyLocked : !p.canUndo ? t('edit.undoEmpty') : null
  const redoWhy = running ? T.whyLocked : !p.canRedo ? t('edit.redoEmpty') : null
  const liveWhy = [T.needsLive, p.reason].filter(Boolean).join(' ')
  const onRowKey = (row: RouteRow) => (e: KeyboardEvent) => {
    if (!e.altKey || row.index === null || !ordered) return
    const dir = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
    if (!dir) return
    e.preventDefault()
    e.stopPropagation()
    ctl.move(row.index, row.index + dir)
  }

  return (
    <div class="hl-route" ref={p.rootRef} data-mode={route.mode} data-state={c.kind} data-feasible={c.kind === 'done' && c.result.feasibility ? String(c.result.feasibility.feasible) : undefined}>
      {/* I1b (D128): the instant browser estimate first; the server's answer (R5-C) right below */}
      {p.estimate ? <EstimateBox est={p.estimate} route={route} /> : null}
      {/* the answer first: visible without scrolling the rail (R5-C); details below */}
      {c.kind === 'done' ? <ResultView c={c} slot={p.resultSlot} /> : null}
      {c.kind === 'failed' ? (
        <div class="hl-route__failed" role="alert" data-status={c.failure.status} data-code={c.failure.code}>
          <p class="hl-route__infeasible-title">
            <Icon name="circle-alert" /> {T.failedTitle}
          </p>
          <p>{failureText(c.failure, stopName)}</p>
        </div>
      ) : null}
      {c.kind === 'cancelled' ? <p class="hl-route__note">{T.cancelled}</p> : null}
      {c.kind === 'running' || c.kind === 'done' || c.kind === 'failed' ? <StageList c={c} /> : null}
      <div class="hl-route__mode" role="radiogroup" aria-label={T.modeLabel}>
        {(['auto', 'ordered'] as const).map((m) => (
          <button
            type="button"
            role="radio"
            class="hl-route__modebtn"
            aria-checked={route.mode === m ? 'true' : 'false'}
            data-value={m}
            disabled={running}
            title={lockedWhy ?? undefined}
            aria-describedby={lockedWhy ? WHY_ID.locked : undefined}
            onClick={() => ctl.setMode(m)}
          >
            {m === 'auto' ? T.modeAuto : T.modeOrdered}
          </button>
        ))}
      </div>
      <p class="hl-route__note">{ordered ? T.orderedNote : T.autoNote}</p>
      <p class="hl-route__note hl-route__inputs" data-route-inputs>
        {inputsLine(ctl)}
      </p>
      {lockedWhy ? (
        <p class="hl-route__note hl-route__why" id={WHY_ID.locked} role="status">
          {lockedWhy}
        </p>
      ) : null}

      <ol class="hl-route__stops" aria-label={T.stopsLabel} data-dragging={p.dragging !== null ? 'true' : undefined}>
        {rows.map((row) => {
          const st = stopStatus(row.check)
          const movable = ordered && row.index !== null && !running
          return (
            <li
              key={row.id}
              class={cx('hl-route__stop', row.checked && 'is-checked', p.dragging !== null && p.dragging === row.index && 'is-dragging')}
              data-station={row.point ? undefined : row.id}
              data-point={row.point ? row.id : undefined}
              data-index={row.index ?? undefined}
              data-validity={st?.state}
              tabIndex={movable ? 0 : undefined}
              aria-label={movable ? `${row.index! + 1}. ${row.id} ${row.name}. ${T.moveHint}` : undefined}
              draggable={movable}
              onKeyDown={onRowKey(row)}
              onDragStart={(e) => {
                if (!movable) return
                e.dataTransfer?.setData('text/plain', row.id)
                ctl.dragStart(row.index!)
              }}
              onDragOver={(e) => {
                if (p.dragging !== null && row.index !== null) e.preventDefault()
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (row.index !== null) ctl.dragDrop(row.index)
                else ctl.dragCancel()
              }}
              onDragEnd={() => ctl.dragCancel()}
            >
              <span class="hl-route__handle" aria-hidden="true" title={movable ? fill(T.dragHandle, { station: row.id }) : undefined}>
                {movable ? '⋮⋮' : ''}
              </span>
              {row.point ? (
                <span class="hl-route__check-slot">
                  <Icon name="user-point" />
                </span>
              ) : (
                <input
                  type="checkbox"
                  class="hl-route__check"
                  checked={row.checked}
                  disabled={running}
                  title={lockedWhy ?? undefined}
                  aria-describedby={lockedWhy ? WHY_ID.locked : undefined}
                  aria-label={fill(T.include, { station: `${row.id} ${row.name}` })}
                  onChange={(e) => ctl.toggle(row.id, (e.currentTarget as HTMLInputElement).checked)}
                />
              )}
              <span class="hl-route__order">{row.index !== null && ordered ? row.index + 1 : ''}</span>
              {row.point ? (
                <PointRowBody ctl={ctl} index={row.index!} name={row.id} label={row.point.label} disabled={!!pointsWhy} why={pointsWhy} whyId={running ? WHY_ID.locked : WHY_ID.points} />
              ) : (
                <span class="hl-route__name">
                  <span class="hl-route__id">{row.id}</span> {row.name}
                </span>
              )}
              {ordered && st ? (
                <span class={cx('hl-route__validity', `is-${st.state}`)} data-validity={st.state}>
                  {st.text}
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>
      {hasPoints && !ordered && !running ? (
        <p class="hl-route__note hl-route__why" id={WHY_ID.points}>
          {T.whyPointsAuto}
        </p>
      ) : null}
      {ordered ? <p class="hl-route__hint">{T.moveHint}</p> : null}
      {ordered ? <AddPointButton ctl={ctl} /> : null}
      {check.route.length ? (
        <p class="hl-route__warn" role="status">
          {routeProblems}
        </p>
      ) : null}

      {ordered ? <GhostSummary ctl={ctl} /> : null}

      {ordered && ctl.legs.peek().length ? (
        <ol class="hl-route__legs" aria-label={T.legs}>
          {ctl.legs.peek().map((l) => (
            <li class={cx('hl-route__leg', failing === l.leg && 'is-failing')} data-leg={l.leg} data-state={failing === null ? undefined : l.leg < failing ? 'planned' : l.leg === failing ? 'failing' : 'not-planned'}>
              {l.from === 'pad' ? T.pad : l.from} → {l.to === 'pad' ? T.pad : l.to}
            </li>
          ))}
        </ol>
      ) : null}

      <div class="hl-route__actions">
        <IconButton icon="undo-2" label={T.undo} class="hl-route__undo" disabled={!!undoWhy} title={undoWhy ?? T.undo} aria-describedby={undoWhy ? WHY_ID.undo : undefined} onClick={() => doUndo()} />
        <IconButton icon="redo-2" label={T.redo} class="hl-route__redo" disabled={!!redoWhy} title={redoWhy ?? T.redo} aria-describedby={redoWhy ? WHY_ID.redo : undefined} onClick={() => doRedo()} />
        <span id={WHY_ID.undo} hidden>
          {undoWhy ?? ''}
        </span>
        <span id={WHY_ID.redo} hidden>
          {redoWhy ?? ''}
        </span>
        {running ? (
          <Button variant="secondary" icon="x" onClick={() => ctl.cancel()} class="hl-route__cancel">
            {T.cancel}
          </Button>
        ) : null}
        <Button
          variant="live"
          icon="play"
          busy={running}
          disabled={!running && (!p.live || !!computeWhy)}
          title={!p.live ? liveWhy : (computeWhy ?? undefined)}
          aria-describedby={!running && !p.live ? WHY_ID.live : computeWhy ? WHY_ID.compute : undefined}
          // W-1: one job at a time; a press while it runs only brings the progress into view
          onClickCapture={() => running && ctl.requestFocus()}
          onClick={() => ctl.computePlan()}
          class="hl-route__compute"
        >
          {running ? T.computing : T.compute}
        </Button>
      </div>
      {computeWhy ? (
        <p class="hl-route__note hl-route__why" id={WHY_ID.compute} role="status">
          {computeWhy}
        </p>
      ) : null}
      {!p.live ? (
        <p class="hl-route__note hl-route__reason" id={WHY_ID.live} role="status">
          {T.needsLive}
          {p.reason ? ` ${p.reason}` : ''}
        </p>
      ) : null}
      <p class="hl-route__hash">
        {T.hash}: <code>{p.hash ?? T.hashPending}</code>
      </p>

    </div>
  )
}

const NO_REASON = signal<string | null>(null)

/** The panel bound to the controller (re-renders on every signal it shows). */
export function RoutePanel({
  ctl,
  live,
  reason,
  undo,
  resultSlot,
  estimate,
}: {
  ctl: RouteController
  live: ReadSignal<boolean>
  reason?: ReadSignal<string | null>
  undo?: SharedUndo | null
  resultSlot?: ResultSlot | null
  estimate?: RouteEstimate | null
}) {
  const why = useSignalValue(reason ?? NO_REASON)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const props: RoutePanelViewProps = {
    ctl,
    route: useSignalValue(ctl.store.route),
    check: useSignalValue(ctl.check),
    compute: useSignalValue(ctl.compute),
    hash: useSignalValue(ctl.store.hash),
    canUndo: useSignalValue(undo ? undo.canUndo : ctl.store.canUndo),
    canRedo: useSignalValue(undo ? undo.canRedo : ctl.store.canRedo),
    dragging: useSignalValue(ctl.dragging),
    live: useSignalValue(live),
    reason: why,
    undo,
    blocked: useSignalValue(ctl.blocked ?? NO_REASON),
    rootRef,
    layout: useSignalValue(ctl.layout),
    resultSlot,
    estimate: estimate ?? null,
  }
  useSignalValue(ctl.legs)
  useSignalValue(ctl.store.step) // the inputs line (pad, crew)
  // W-1: "Compute" while a job runs (here or from the Live pad card) focuses the progress
  const focus = useSignalValue(ctl.focusRequest)
  useEffect(() => {
    if (!focus) return
    const root = rootRef.current as (HTMLDivElement & { querySelector?: HTMLDivElement['querySelector'] }) | null
    const el = root?.querySelector?.<HTMLElement>('.hl-route__progress') ?? root?.querySelector?.<HTMLElement>('.hl-route__compute')
    el?.scrollIntoView?.({ block: 'nearest' })
    el?.focus?.()
  }, [focus])
  return <RoutePanelView {...props} />
}
