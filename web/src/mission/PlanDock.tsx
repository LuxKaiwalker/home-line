// "EVA time" strip under the Mission Planer map (user 2026-11-15): the plan being built, drawn like the
// timeline dock (ui/timeline/Timeline.tsx, same lanes and classes) but with no playback. Hovering the
// strip reads the margin at that minute; otherwise the side shows the lowest margin and the time back.
// Lanes: stop labels | margin curve with stop bands and daylight end | binding term | axis.
import { useState } from 'preact/hooks'
import { FIELD_LAYER } from '../map/field/constants'
import { marginClass } from '../map/field/margin'
import { areaPath, linePath, linear, pct, splitByClass, stepTicks, type Pt } from '../ui/charts'
import { cx } from '../ui/components'
import { t } from '../ui/copy'
import { BINDING_COPY, dwellAt, fmtEva, rowAt } from '../ui/timeline/model'
import '../ui/timeline/timeline.css'
import type { PlanTimeline } from './planTimeline'

const W = 1000
const H = 100
/** axis ticks every 30 EVA minutes, labelled every hour (as the dock) */
const AXIS_STEP_MIN = 30
/** phases where the plan changes (the only curve points marked with a dot) */
const KEY_EVENTS = new Set(['arrive', 'leave', 'return'])

export type PlanDockState = { kind: 'empty' } | { kind: 'unrouted' } | { kind: 'ready'; tl: PlanTimeline }

export function PlanDock({ state, amberMin = FIELD_LAYER.amberMin }: { state: PlanDockState; amberMin?: number }) {
  const [open, setOpen] = useState(true)
  const [hoverT, setHoverT] = useState<number | null>(null)

  return (
    <div class={cx('mp-dock', !open && 'is-collapsed')}>
      <div class="mp-dock__head">
        <button type="button" class="mp-dock__toggle" aria-expanded={open} onClick={() => setOpen(!open)} title={open ? 'Hide the EVA time strip' : 'Show the EVA time strip'}>
          {open ? '▾' : '▴'}
        </button>
        <span class="mp-dock__title">{t('timeline.evaTime')} · planned</span>
      </div>
      {open && (
        <div class="mp-dock__body">
          {state.kind === 'ready' ? (
            <Strip tl={state.tl} amberMin={amberMin} hoverT={hoverT} setHoverT={setHoverT} />
          ) : (
            <p class="hl-tl__status">{state.kind === 'empty' ? 'Add a waypoint to see the planned EVA over time.' : 'A leg could not be routed: no timeline for this plan.'}</p>
          )}
        </div>
      )}
    </div>
  )
}

function Strip({ tl, amberMin, hoverT, setHoverT }: { tl: PlanTimeline; amberMin: number; hoverT: number | null; setHoverT: (t: number | null) => void }) {
  const m = tl.model
  const tMax = m.tMax
  const x = linear([0, tMax], [0, W])
  const y = linear([m.yMin, m.yMax], [H, 0])
  const P = (v: number) => pct(Math.min(Math.max(v, 0), tMax), 0, tMax)
  const cls = (v: number) => marginClass(v, amberMin)
  const pts: Pt[] = m.curve.map((r) => [r.t, r.margin as number])
  const runs = splitByClass(pts, [0, amberMin], cls)
  const lowest = m.curve.reduce<(typeof m.curve)[number] | null>((lo, r) => (lo === null || (r.margin as number) < (lo.margin as number) ? r : lo), null)

  const at = hoverT === null ? null : rowAt(m, hoverT)
  const dwell = hoverT === null ? null : dwellAt(m, hoverT)
  const read = at ?? lowest
  const bind = (b: typeof m.curve[number]['binding']) => (b ? t(BINDING_COPY[b]) : '')

  const tAt = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (!(r.width > 0)) return null
    return Math.min(Math.max(((e.clientX - r.left) / r.width) * tMax, 0), tMax)
  }

  return (
    <div class="hl-tl mp-tl">
      <div
        class="hl-tl__track mp-tl__track"
        onPointerMove={(e: PointerEvent) => setHoverT(tAt(e))}
        onPointerDown={(e: PointerEvent) => setHoverT(tAt(e))}
        onPointerLeave={() => setHoverT(null)}
        role="img"
        aria-label={`Planned EVA: ${fmtEva(tl.tReturn)} back at the pad${lowest ? `, lowest margin ${(lowest.margin as number).toFixed(1)} min` : ''}`}
      >
        <div class="hl-tl__labels" aria-hidden="true">
          {tl.stops.map((s, k) => (
            <span key={`s${k}`} class={cx('hl-tl__dwelllabel', dwell?.station === s.label && 'is-current')} style={{ left: `${P(s.t)}%` }}>
              {s.label}
            </span>
          ))}
        </div>

        <div class="hl-tl__plot">
          {m.dwells.map((d) => (
            <div key={`d${d.i0}`} class={cx('hl-tl__dwell', dwell === d && 'is-current')} style={{ left: `${P(d.t0)}%`, width: `${P(d.t1) - P(d.t0)}%` }} title={`Stop at ${d.station}: ${fmtEva(d.t0)}–${fmtEva(d.t1)}`} />
          ))}
          <svg class="hl-tl__chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
            {runs.map((r, k) => (
              <path key={`a${k}`} class={`hl-tl__area hl-tl__area--${r.cls}`} d={areaPath(r.pts, x, y, Math.max(0, m.yMin))} />
            ))}
            {m.yMin < 0 && <line class="hl-tl__zero" x1={0} x2={W} y1={y(0)} y2={y(0)} vector-effect="non-scaling-stroke" />}
            {runs.map((r, k) => (
              <path key={`l${k}`} class={`hl-tl__line hl-tl__line--${r.cls}`} d={linePath(r.pts, x, y)} vector-effect="non-scaling-stroke" />
            ))}
          </svg>
          {m.curve
            .filter((r) => KEY_EVENTS.has(r.event))
            .map((r) => (
              <span key={`v${r.i}`} class="hl-tl__vertex" style={{ left: `${P(r.t)}%`, top: `${(y(r.margin as number) / H) * 100}%` }} />
            ))}
          {m.daylightEnd !== null && m.daylightEnd <= tMax && <span class="hl-tl__daylight" style={{ left: `${P(m.daylightEnd)}%` }} title={t('timeline.daylightEnd')} />}
          {hoverT !== null && <span class="hl-tl__head" style={{ left: `${P(hoverT)}%` }} aria-hidden="true" />}
        </div>

        <div class="hl-tl__binding" aria-hidden="true">
          {m.bindingRuns.map((b, k) => (
            <span key={`b${k}`} class="hl-tl__bindingrun" style={{ left: `${P(b.t0)}%`, width: `${Math.max(0, P(b.t1) - P(b.t0))}%` }}>
              {bind(b.binding)}
            </span>
          ))}
        </div>

        <div class="hl-tl__axis" aria-hidden="true">
          {stepTicks(0, tMax, AXIS_STEP_MIN).map((v) => (
            <span key={`x${v}`} class="hl-tl__tick" style={{ left: `${P(v)}%` }}>
              {v % 60 === 0 ? fmtEva(v) : ''}
            </span>
          ))}
        </div>
      </div>

      <div class="hl-tl__side mp-tl__side">
        <div class="mp-tl__read">
          <span class="mp-tl__k">{at ? `At ${fmtEva(hoverT!)}${dwell ? ` · stop ${dwell.station}` : ''}` : 'Lowest margin'}</span>
          <b class={read ? `mp-tl__v--${cls(read.margin as number)}` : undefined}>{read ? `${(read.margin as number).toFixed(1)} min` : '–'}</b>
          {read?.binding && <span class="mp-tl__k">{bind(read.binding)}{!at ? ` at ${fmtEva(read.t)}` : ''}</span>}
        </div>
        <div class="mp-tl__read">
          <span class="mp-tl__k">Back at pad (EVA h:mm)</span>
          <b>{fmtEva(tl.tReturn)}</b>
          {m.daylightEnd !== null && <span class="mp-tl__k">dark at EVA {fmtEva(m.daylightEnd)}</span>}
        </div>
      </div>
    </div>
  )
}
