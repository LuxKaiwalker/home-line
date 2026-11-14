// Ellipse size over the EVA (F21): r95 and the 95% semi-axes per minute from the Monte Carlo
// file, fix events as vertical lines by type, the playback time as a cursor. Click to seek.
import { linear, niceTicks, polyline } from '../chart/scale'
import { NAV_THEME } from './theme'
import type { Fix, MonteCarlo } from './types'

export function EllipseChart({ mc, fixes, t, onSeek }: { mc: MonteCarlo; fixes: Fix[]; t: number; onSeek: (t: number) => void }) {
  const rows = [...mc.per_minute].sort((a, b) => a.t_eva_min - b.t_eva_min)
  if (!rows.length) return <p class="muted">No per-minute rows.</p>
  const W = 320
  const H = 180
  const m = { l: 40, r: 8, t: 10, b: 26 }
  const t0 = rows[0].t_eva_min
  const t1 = Math.max(rows[rows.length - 1].t_eva_min, t0 + 1)
  const ymax = Math.max(1, ...rows.map((r) => Math.max(r.r95_m, r.ellipse.a_m)))
  const yt = niceTicks(0, ymax, 4)
  const top = Math.max(ymax, yt[yt.length - 1] ?? ymax)
  const x = linear([t0, t1], [m.l, W - m.r])
  const y = linear([0, top], [H - m.b, m.t])
  const xt = niceTicks(t0, t1, 5)
  const series = (f: (r: (typeof rows)[number]) => number) => polyline(rows.map((r) => [r.t_eva_min, f(r)] as [number, number]), x, y)
  const click = (e: MouseEvent) => {
    const svg = e.currentTarget as SVGSVGElement
    const box = svg.getBoundingClientRect()
    const px = ((e.clientX - box.left) / box.width) * W
    const tt = t0 + ((px - m.l) / (W - m.l - m.r)) * (t1 - t0)
    onSeek(Math.min(t1, Math.max(t0, tt)))
  }
  return (
    <svg class="chart nav-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="95% error ellipse size over EVA time" onClick={click}>
      {yt.map((v) => (
        <g class="tick">
          <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} />
          <text x={m.l - 4} y={y(v) + 4} text-anchor="end">
            {v}
          </text>
        </g>
      ))}
      {xt.map((v) => (
        <g class="tick">
          <line x1={x(v)} x2={x(v)} y1={H - m.b} y2={H - m.b + 4} />
          <text x={x(v)} y={H - m.b + 16} text-anchor="middle">
            {v}
          </text>
        </g>
      ))}
      <text class="axis-label" x={W - m.r} y={H - 2} text-anchor="end">
        EVA min
      </text>
      <text class="axis-label" x={4} y={m.t + 2} text-anchor="start">
        m
      </text>
      {fixes.map((f) => (
        <line class="nav-fixline" x1={x(f.t_eva_min)} x2={x(f.t_eva_min)} y1={m.t} y2={H - m.b} stroke={NAV_THEME.fix[f.type]} />
      ))}
      {series((r) => r.ellipse.b_m).map((p) => (
        <polyline class="nav-series-b" points={p} />
      ))}
      {series((r) => r.ellipse.a_m).map((p) => (
        <polyline class="nav-series-a" points={p} stroke={NAV_THEME.ellipse} />
      ))}
      {series((r) => r.r95_m).map((p) => (
        <polyline class="series" points={p} />
      ))}
      <line class="nav-cursor" x1={x(Math.min(t1, Math.max(t0, t)))} x2={x(Math.min(t1, Math.max(t0, t)))} y1={m.t} y2={H - m.b} />
      <g class="nav-chart-key">
        <text x={m.l + 6} y={m.t + 10} style={{ fill: 'var(--accent)' }}>
          r95
        </text>
        <text x={m.l + 36} y={m.t + 10} style={{ fill: NAV_THEME.ellipse }}>
          a
        </text>
        <text x={m.l + 50} y={m.t + 10}>
          b
        </text>
      </g>
    </svg>
  )
}
