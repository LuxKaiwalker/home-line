"""Traverse (F9) on a routing grid: forward runs from the pad and each reachable station, the
exact orienteering DP with the route-margin check, route legs with per-vertex times, and the
timeline with O2 checkpoints, turn-back times and margins.

Route legs (``route_{scenario}.geojson``; contract route, properties proposed by WS2): ``leg``
(1-based), ``from``, ``to``, ``t_min`` (walk time), ``o2_L``, ``length_m``, ``t_start_min`` /
``t_end_min`` (minutes since EVA start) and ``times_min``: one number per LineString vertex,
minutes since EVA start, non-decreasing (WS7/WS8/WS9 interpolate the playback position from
it). Geometry is not simplified, so vertices and times stay aligned.

Margin check in the DP (SPEC F9 "margin m(t) >= 0 along every leg, using T_home at sampled
path points"): every vertex of the leg path is checked. O2 used at departure is bounded by
the effort-capped rate x elapsed time (VO2 never exceeds the cap), which makes the check depend
on departure time only and keeps the DP exact; the timeline then reports the actual margins.

Stations with no walk home (T_home infinite) are left out and listed in ``unreachable``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import dijkstra, orienteering, provenance
from .geo import feature_collection, write_json
from .graph import Grid
from .margin import MarginInputs, latest_departure, margin
from .physio import GradeTable

SCRIPT = "pipeline/engine/traverse.py"
VERTEX_TIME_KEY = "times_min"
PAD = orienteering.PAD


@dataclass
class LegPath:
    cells: np.ndarray  # (k, 2) row, col from start to end
    tau: np.ndarray  # min since leg start, per vertex
    o2: np.ndarray  # L used since leg start, per vertex
    t_home: np.ndarray  # T_home at each vertex
    o2_home: np.ndarray

    @property
    def t(self) -> float:
        return float(self.tau[-1])

    @property
    def o2_total(self) -> float:
        return float(self.o2[-1])


@dataclass
class Result:
    order: list[str]
    unreachable: list[str]
    total_min: float
    value: float
    route: dict
    timeline: list[dict]
    legs: list[dict] = field(default_factory=list)
    margin_terms: list[str] = field(default_factory=list)


def _forward_leg(fld: dijkstra.Field, dst, home: dijkstra.Field) -> LegPath:
    cells = np.array(dijkstra.trace(fld, dst))
    r, c = cells[:, 0], cells[:, 1]
    return LegPath(cells, fld.t_min[r, c].copy(), fld.o2_l[r, c].copy(), home.t_min[r, c],
                   home.o2_l[r, c])  # fmt: skip


def _home_leg(home: dijkstra.Field, src) -> LegPath:
    """Walk home along the return field's pointers (T_home falls to 0 at the pad)."""
    cells = np.array(dijkstra.trace(home, src))
    r, c = cells[:, 0], cells[:, 1]
    t, o2 = home.t_min[r, c], home.o2_l[r, c]
    return LegPath(cells, t[0] - t, o2[0] - o2, t, o2)


def plan(grid: Grid, table: GradeTable, home: dijkstra.Field, pad, stations: list[dict],
         budget_min: float, checkpoint_min: float, mi: MarginInputs,
         partner_t: np.ndarray | None = None, partner_min: float | None = None,
         ) -> Result:  # fmt: skip
    """stations: dicts with id, rc, value, dwell_min. home: the scenario's return field."""
    reach = [s for s in stations if math.isfinite(float(home.t_min[s["rc"]]))]
    unreachable = [s["id"] for s in stations if s not in reach]
    n = len(reach)
    rc = [tuple(s["rc"]) for s in reach]
    fpad = dijkstra.forward_field(grid, table, pad)
    fst = [dijkstra.forward_field(grid, table, x) for x in rc]
    out_legs = [_forward_leg(fpad, x, home) if np.isfinite(fpad.t_min[x]) else None for x in rc]
    back_legs = [_home_leg(home, x) for x in rc]
    mid = [[_forward_leg(fst[i], rc[j], home) if i != j and np.isfinite(fst[i].t_min[rc[j]])
            else None for j in range(n)] for i in range(n)]  # fmt: skip

    def tt(lp):
        return np.inf if lp is None else lp.t

    t_from = np.array([tt(lp) for lp in out_legs])
    t_to = np.array([lp.t for lp in back_legs])
    t_leg = np.array([[tt(mid[i][j]) for j in range(n)] for i in range(n)]).reshape(n, n)

    # latest departure per leg under the bounded-O2 margin check (monotone in time)
    def latest(lp):
        if lp is None:
            return -np.inf
        return latest_departure(mi, 0.0, 0.0, mi.o2_rate_l_min, lp.tau, lp.o2, lp.t_home,
                                lp.o2_home)  # fmt: skip

    lat_from = [latest(lp) for lp in out_legs]
    lat_to = [latest(lp) for lp in back_legs]
    lat_mid = [[latest(mid[i][j]) for j in range(n)] for i in range(n)]

    def leg_ok(frm, to, t):
        if frm == PAD:
            return t <= lat_from[to]
        if to == PAD:
            return t <= lat_to[frm]
        return t <= lat_mid[frm][to]

    values = [float(s["value"]) for s in reach]
    dwell = [float(s["dwell_min"]) for s in reach]
    p = orienteering.solve(values, dwell, t_from, t_to, t_leg, budget_min, leg_ok)
    names = [s["id"] for s in reach]

    # walk the plan: legs with absolute times and O2, a dense (t, used, T_home, O2_home) track
    seq = []  # (from_name, to_name, LegPath, dwell_before)
    here = PAD
    for k in p.order:
        lp = out_legs[k] if here == PAD else mid[here][k]
        seq.append(("pad" if here == PAD else names[here], names[k], lp,
                    0.0 if here == PAD else dwell[here]))  # fmt: skip
        here = k
    if p.order:
        seq.append((names[here], "pad", back_legs[here], dwell[here]))

    in_partner = {}
    if partner_t is not None and partner_min is not None:
        for s in reach:
            tp = float(partner_t[s["rc"]])
            in_partner[s["id"]] = bool(math.isfinite(tp) and tp <= partner_min)

    t, used = 0.0, 0.0
    track_t, track_u, track_th, track_oh = [0.0], [0.0], [], []
    items, legs, events = [], [], []

    def ev(tm, event, st, u, th, oh):
        m, b = margin(mi, tm, u, th, oh)
        row = {"t_min": round(tm, 2), "event": event, "station": st,
               "o2_left_L": round(mi.o2_capacity_l - u, 2), "t_home_min": round(float(th), 2),
               "margin_min": round(m, 2), "margin_binding": b}  # fmt: skip
        if st is not None and st in in_partner:
            row["in_partner_line"] = in_partner[st]
        events.append(row)

    ev(0.0, "depart", None, 0.0, 0.0, 0.0)
    track_th.append(0.0)
    track_oh.append(0.0)
    for i, (frm, to, lp, dw) in enumerate(seq):
        if dw > 0:  # dwell at `frm` before this leg
            t += dw
            used += dw * mi.dwell_rate_l_min
            track_t.append(t)
            track_u.append(used)
            track_th.append(float(lp.t_home[0]))
            track_oh.append(float(lp.o2_home[0]))
            ev(t, "leave", frm, used, lp.t_home[0], lp.o2_home[0])
        times = t + lp.tau
        track_t.extend(times[1:].tolist())
        track_u.extend((used + lp.o2[1:]).tolist())
        track_th.extend(lp.t_home[1:].tolist())
        track_oh.extend(lp.o2_home[1:].tolist())
        xy = np.column_stack(grid.xy_of_rc(lp.cells[:, 0], lp.cells[:, 1]))
        if len(xy) == 1:
            xy, times = np.vstack([xy, xy]), np.concatenate([times, times])
        props = {
            "leg": i + 1, "from": frm, "to": to,
            "t_min": round(lp.t, 2), "o2_L": round(lp.o2_total, 2),
            "length_m": round(float(np.hypot(*np.diff(xy, axis=0).T).sum()), 1),
            "t_start_min": round(t, 2), "t_end_min": round(t + lp.t, 2),
            VERTEX_TIME_KEY: [round(float(v), 2) for v in times],
        }  # fmt: skip
        legs.append(props)
        from shapely.geometry import LineString

        items.append((LineString(xy), props))
        t += lp.t
        used += lp.o2_total
        if to == "pad":
            ev(t, "return", None, used, 0.0, 0.0)
        else:
            ev(t, "arrive", to, used, lp.t_home[-1], lp.o2_home[-1])
            k = names.index(to)
            back = back_legs[k]
            tb = latest_departure(mi, t, used, mi.dwell_rate_l_min, back.tau, back.o2,
                                  back.t_home, back.o2_home)  # fmt: skip
            if math.isfinite(tb):
                u_tb = used + (tb - t) * mi.dwell_rate_l_min
                ev(tb, "turn_back", to, u_tb, back.t_home[0], back.o2_home[0])
    if not p.order:
        ev(0.0, "return", None, 0.0, 0.0, 0.0)

    tr_t, tr_u = np.array(track_t), np.array(track_u)
    tr_th, tr_oh = np.array(track_th), np.array(track_oh)
    for tc in np.arange(checkpoint_min, t, checkpoint_min):
        j = int(np.searchsorted(tr_t, tc, side="right") - 1)
        u = float(np.interp(tc, tr_t, tr_u))
        ev(float(tc), "o2_checkpoint", None, u, tr_th[j], tr_oh[j])
    events.sort(key=lambda e: (e["t_min"], e["event"] != "depart"))
    route = feature_collection(items, grid.crs)
    return Result([names[k] for k in p.order], unreachable, float(p.total_min), float(p.value),
                  route, events, legs, mi.terms)  # fmt: skip


def write(res: Result, sid: str, public: Path) -> None:
    """route_{sid}.geojson + timeline_{sid}.json, validated; manifest keys."""
    rp = write_json(public / f"route_{sid}.geojson", res.route, "route.schema.json")
    tp = write_json(public / f"timeline_{sid}.json", res.timeline, "timeline.schema.json")
    tfile = f"timeline_{sid}.json"
    units = {"t_min": "min", "o2_left_L": "L", "t_home_min": "min", "margin_min": "min"}
    for i, row in enumerate(res.timeline):
        for k, u in units.items():
            if row.get(k) is not None:
                provenance.record(f"timeline.{sid}.{i}.{k}", row[k], u, tfile, SCRIPT)
    provenance.record(f"route.{sid}.total_min", round(res.total_min, 2), "min", tfile, SCRIPT)
    provenance.record(f"route.{sid}.margin_terms", res.margin_terms, None, tfile, SCRIPT)
    provenance.record_file(f"route_{sid}.geojson", rp, SCRIPT)
    provenance.record_file(tfile, tp, SCRIPT)
