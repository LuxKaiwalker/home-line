"""Route margin (SPEC F4, F9; O2 term per S review 2026-11-14, crew.yaml o2_margin):

    m(t) = min( O2 term ,  t_dark - t - T_home ,  tau_dose(t) - T_home ,  EVA_budget - t - T_home )
    O2 term = (O2_left - O2_return_route - O2_station_tasks - O2_reserve) / effort_rate

* All O2 quantities in litres; the O2 term is converted to "minutes at maximum effort" at the
  effort-capped rate (effort_cap * VO2max * m_b / 1000 = 1.35 L/min).
* O2_left = crew.o2_budget[margin_uses] - O2 used so far. O2 used includes the walking and the
  station work at the task rate (1,000 BTU/hr at 21.0 J/mL = 0.837 L/min, D29), which replaces
  the resting V0. Every BTU/h -> O2 conversion uses crew.o2_energy_j_per_ml = 21.0 (D29).
* O2_return_route = O2_home(x) from the return field (no (1 + r) factor any more).
* O2_station_tasks = task O2 still to do at the station the crew is working at (0 while
  walking). Confirmed (decision log 2026-11-14 15:40).
* O2_reserve = reserve_min_at_effort_cap x effort rate = 30 x 1.35 = 40.5 L, derived (D24,
  "30 min at the effort cap (EMU precedent)"). crew.o2_reserve_frac (r) is NOT used.
* EVA duration (D28, user 16:20): EVA_budget - t - T_home with EVA_budget = crew.eva_h x 60.
* t_dark (min since EVA start) comes from WS4. The dose term (D39) is either static
  (tau_dose - T_home, a CLI value or the storm peak) or timed (``DoseTiming``): the 20 May 2024
  RAD storm series is shifted onto the EVA clock so its tripwire fires at the route minute t*
  where T_home is largest (conditions.yaml storm_replay), and tau_dose(t) = 60 D_allow /
  Ddot(t). A term that is missing is left out and ``terms`` says which were used.

Binding term names: "O2" | "daylight" | "dose" | "EVA duration" (D28).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .config import load
from .physio import ML_PER_L, SEC_PER_MIN, Params


@dataclass(frozen=True)
class MarginInputs:
    o2_capacity_l: float
    reserve_l: float  # fixed O2 reserve, L
    o2_rate_l_min: float  # converts the O2 term to minutes (effort cap)
    dwell_rate_l_min: float  # O2 use while working at a station
    planning_rate_l_min: float | None = None  # optional second O2 display rate
    reserve_frac: float = 0.0  # legacy (1 + r) factor; 0 in the current formula
    t_dark_min: float | None = None
    tau_dose_min: float | None = None  # static dose leash (used when dose_timing is None)
    eva_budget_min: float | None = None  # D28: EVA budget (crew.eva_h x 60)
    dose_timing: DoseTiming | None = None  # D39: timed dose leash (replaces tau_dose_min)

    @property
    def terms(self) -> list[str]:
        out = ["O2"]
        if self.t_dark_min is not None:
            out.append("daylight")
        if self.dose_timing is not None or self.tau_dose_min is not None:
            out.append("dose")
        if self.eva_budget_min is not None:
            out.append(EVA)
        return out

    def tau_dose_at(self, t_min):
        """Dose leash (min) at EVA minute(s) t: timed if dose_timing, else static, else None."""
        if self.dose_timing is not None:
            return self.dose_timing.tau_min(t_min)
        if self.tau_dose_min is not None:
            return np.full(np.shape(t_min), float(self.tau_dose_min)) if np.ndim(t_min) else \
                float(self.tau_dose_min)
        return None


EVA = "EVA duration"  # D28 binding term name


@dataclass(frozen=True)
class DoseTiming:
    """Timed dose leash (D39). ``eva_min`` / ``rate_mgy_h``: the storm series (valid samples,
    sample midpoints) on the EVA clock; tau_dose(t) = 60 D_allow / Ddot(t), Ddot linear between
    sample midpoints (WS4 rad.json method), clamped to the first/last sample outside the series."""

    t_star_min: float  # EVA minute where the tripwire fires (route max T_home)
    eva_min: np.ndarray
    rate_mgy_h: np.ndarray
    d_allow_mgy: float
    tripwire_offset_min: float  # tripwire_utc - series time origin, for the record
    source: str = ""

    def rate(self, t_min):
        return np.interp(t_min, self.eva_min, self.rate_mgy_h)

    def tau_min(self, t_min):
        r = self.rate(t_min)
        return 60.0 * self.d_allow_mgy / r


_BUDGET_KEYS = {"primary_L": ("primary_design_eva_h", "primary_design_rate_btu_h"),
                "secondary_L": ("secondary_eva_h", "secondary_design_rate_btu_h")}


def _check(text: str, expected: str, key: str) -> None:
    if text.replace(" ", "") != expected.replace(" ", ""):
        raise ValueError(f"crew.yaml {key} changed: {text!r}; update margin.py")


def o2_budget_l(which: str = "primary_L") -> float:
    """crew.yaml o2_budget computed from config (D29, user 16:20): O2_L = hours x rate_btu_h x
    j_per_btu / o2_energy_j_per_ml / 1000. Primary: 8 h x 1,200 BTU/h = 482.31 L; secondary:
    1 h x 3,000 BTU/h = 150.72 L."""
    b = load("crew")["o2_budget"]
    _check(b["formula"], "O2_L = hours * rate_btu_h * j_per_btu / o2_energy_j_per_ml / 1000",
           "o2_budget.formula")  # fmt: skip
    h_key, r_key = _BUDGET_KEYS[which]
    return float(b[h_key]) * btu_h_to_l_min(float(b[r_key])) * 60.0


def o2_capacity_l() -> float:
    """O2 planned against (crew.o2_budget.margin_uses = primary_L), computed from config."""
    return o2_budget_l(load("crew")["o2_budget"]["margin_uses"])


def j_per_ml() -> float:
    """The one O2 energy equivalent (D29): crew.o2_energy_j_per_ml = 21.0 J per mL O2."""
    return float(load("crew")["o2_energy_j_per_ml"])


def btu_h_to_l_min(btu_h: float) -> float:
    """Metabolic rate (BTU/hr) -> O2 uptake (L/min) at o2_energy_j_per_ml (D29)."""
    jpb = float(load("crew")["o2_budget"]["j_per_btu"])
    return float(btu_h) * jpb / SEC_PER_MIN / j_per_ml() / ML_PER_L


def station_task_rate_l_min() -> float:
    """Station work O2 rate (L/min), derived from station_task_rate_btu_h (D29): 0.8373."""
    om = load("crew")["o2_margin"]
    _check(om["station_task_rate_formula"], "station_task_rate_btu_h * o2_budget.j_per_btu / "
           "60 / o2_energy_j_per_ml / 1000", "o2_margin.station_task_rate_formula")  # fmt: skip
    return btu_h_to_l_min(float(om["station_task_rate_btu_h"]))


def reserve_l(p: Params) -> float:
    """O2 reserve (D24): reserve_min_at_effort_cap x effort rate = 30 x 1.35 = 40.5 L."""
    om = load("crew")["o2_margin"]
    _check(om["reserve_L"], "reserve_min_at_effort_cap * effort_rate_L_min", "o2_margin.reserve_L")
    return float(om["reserve_min_at_effort_cap"]) * effort_rate_l_min(p)


def reserve_label() -> str:
    return str(load("crew")["o2_margin"]["reserve_label"])


def eva_budget_min() -> float:
    """D28 EVA budget: crew.eva_h x 60 (variants.yaml route.eva_term)."""
    _check(load("variants")["route"]["eva_term"], "crew.eva_h * 60 - t - T_home",
           "variants.route.eva_term")  # fmt: skip
    return float(load("crew")["eva_h"]) * 60.0


def effort_rate_l_min(p: Params) -> float:
    om = load("crew")["o2_margin"]
    if om["effort_rate_L_min"].replace(" ", "") != (
            "effort_cap_frac*vo2max_ml_kg_min*body_mass_kg/1000"):  # fmt: skip
        raise ValueError(f"cannot parse o2_margin.effort_rate_L_min {om['effort_rate_L_min']!r}")
    return p.cap * p.m_b / ML_PER_L


def inputs(p: Params, t_dark_min: float | None = None, tau_dose_min: float | None = None,
           eva: bool = True, dose_timing: DoseTiming | None = None) -> MarginInputs:  # fmt: skip
    """Margin inputs from config (crew.yaml o2_margin) for the walker p (variant + suit).
    eva: include the D28 EVA-duration term. dose_timing (D39) replaces the static tau_dose."""
    if load("variants")["route"]["o2_margin"] != "crew.o2_margin":
        raise ValueError("variants.route.o2_margin must point at crew.o2_margin")
    om = load("crew")["o2_margin"]
    rate = effort_rate_l_min(p)
    return MarginInputs(
        o2_capacity_l=o2_capacity_l(),
        reserve_l=reserve_l(p),
        o2_rate_l_min=rate,
        dwell_rate_l_min=station_task_rate_l_min(),
        planning_rate_l_min=btu_h_to_l_min(om["planning_rate_btu_h"]),
        t_dark_min=t_dark_min,
        tau_dose_min=None if dose_timing is not None else tau_dose_min,
        eva_budget_min=eva_budget_min() if eva else None,
        dose_timing=dose_timing,
    )


def legacy_inputs(p: Params, t_dark_min: float | None = None,
                  tau_dose_min: float | None = None) -> MarginInputs:  # fmt: skip
    """Session-1 formula (O2_left - (1 + r) O2_home) / 1.35 with dwell at V0. ONLY for the
    before/after comparison S asked for; never used for a product."""
    rate = effort_rate_l_min(p)
    return MarginInputs(o2_capacity_l=o2_capacity_l(), reserve_l=0.0, o2_rate_l_min=rate,
                        dwell_rate_l_min=p.V0 * p.m_b / ML_PER_L, planning_rate_l_min=None,
                        reserve_frac=float(load("crew")["o2_reserve_frac"]),
                        t_dark_min=t_dark_min, tau_dose_min=tau_dose_min)  # fmt: skip


def o2_slack_l(mi: MarginInputs, o2_used_l, o2_home_l, tasks_l=0.0):
    """O2_left - O2_return_route - O2_station_tasks - O2_reserve (L)."""
    return (mi.o2_capacity_l - o2_used_l - (1 + mi.reserve_frac) * o2_home_l - tasks_l
            - mi.reserve_l)  # fmt: skip


def o2_margin_min(mi: MarginInputs, o2_used_l, o2_home_l, tasks_l=0.0,
                  rate_l_min: float | None = None) -> float:  # fmt: skip
    """O2 term in minutes at ``rate_l_min`` (default: the effort cap)."""
    rate = mi.o2_rate_l_min if rate_l_min is None else rate_l_min
    return float(o2_slack_l(mi, o2_used_l, o2_home_l, tasks_l) / rate)


def margin(mi: MarginInputs, t_min, o2_used_l, t_home_min, o2_home_l, tasks_l=0.0):
    """(margin_min, binding) at absolute EVA time t with o2_used so far, at a point whose walk
    home takes t_home / o2_home, with tasks_l of station work still to do there. Scalars."""
    terms = {"O2": o2_margin_min(mi, o2_used_l, o2_home_l, tasks_l)}
    if mi.t_dark_min is not None:
        terms["daylight"] = mi.t_dark_min - t_min - t_home_min
    tau = mi.tau_dose_at(t_min)
    if tau is not None:
        terms["dose"] = float(tau) - t_home_min
    if mi.eva_budget_min is not None:
        terms[EVA] = mi.eva_budget_min - t_min - t_home_min
    binding = min(terms, key=terms.get)
    return float(terms[binding]), binding


def latest_departure(mi: MarginInputs, t0: float, u0: float, rate: float, tau_v, o2path_v,
                     t_home_v, o2_home_v) -> float:  # fmt: skip
    """Latest departure time t >= t0 on a leg so that m >= 0 at every sampled vertex v
    (min over ``latest_departure_terms``). Returns -inf if no departure time works."""
    terms = latest_departure_terms(mi, t0, u0, rate, tau_v, o2path_v, t_home_v, o2_home_v)
    return min(terms.values())


def latest_departure_terms(mi: MarginInputs, t0: float, u0: float, rate: float, tau_v, o2path_v,
                           t_home_v, o2_home_v, dose_step_min: float = 0.05,
                           ) -> dict[str, float]:  # fmt: skip
    """{term: latest departure} on a leg (m >= 0 at every vertex v), per margin term.

    O2 used at departure is u0 + rate (t - t0) (rate >= 0); at vertex v it adds o2path_v; the
    walker reaches v at t + tau_v. O2, daylight, EVA duration and the static dose term are
    non-increasing in t, so each feasible set is (-inf, latest]. The timed dose term (D39) is not
    monotone: its value is the first departure time t >= t0 (scanned in dose_step_min steps up
    to the other terms' latest) at which tau_dose(t + tau_v) - T_home(v) < 0 at some vertex, minus
    one step; inf if it never fails in that range, -inf if it already fails at t0.
    """
    tau_v, o2path_v = np.asarray(tau_v, float), np.asarray(o2path_v, float)
    t_home_v, o2_home_v = np.asarray(t_home_v, float), np.asarray(o2_home_v, float)
    if not (np.all(np.isfinite(t_home_v)) and np.all(np.isfinite(o2_home_v))):
        return {"O2": -np.inf}
    slack = o2_slack_l(mi, u0 + o2path_v, o2_home_v)
    out: dict[str, float] = {}
    if rate > 0:
        out["O2"] = t0 + float(np.min(slack)) / rate
    else:
        out["O2"] = np.inf if np.min(slack) >= 0 else -np.inf
    if mi.t_dark_min is not None:
        out["daylight"] = float(np.min(mi.t_dark_min - tau_v - t_home_v))
    if mi.eva_budget_min is not None:
        out[EVA] = float(np.min(mi.eva_budget_min - tau_v - t_home_v))
    if mi.dose_timing is None and mi.tau_dose_min is not None:
        out["dose"] = np.inf if np.max(t_home_v) <= mi.tau_dose_min else -np.inf
    elif mi.dose_timing is not None:
        hi = min(out.values())
        out["dose"] = _dose_latest(mi.dose_timing, t0, hi, tau_v, t_home_v, dose_step_min)
    return out


def _dose_latest(dt: DoseTiming, t0: float, hi: float, tau_v, t_home_v, step: float) -> float:
    if not np.isfinite(hi):
        hi = t0 + 24 * 60.0
    if hi < t0:
        hi = t0
    ts = np.arange(t0, hi + step, step)
    for k in range(0, len(ts), 256):  # chunks keep memory small
        tt = ts[k: k + 256]
        bad = np.any(dt.tau_min(tt[:, None] + tau_v[None, :]) - t_home_v[None, :] < 0, axis=1)
        if bad.any():
            j = k + int(np.argmax(bad))
            return -np.inf if j == 0 else float(ts[j - 1])
    return np.inf


def t_star(track_t, track_t_home) -> float:
    """D39 anchor: EVA minute of the route's largest T_home (first sample on a tie,
    conditions.yaml storm_replay.tie_break 'first')."""
    th = np.asarray(track_t_home, float)
    return float(np.asarray(track_t, float)[int(np.argmax(th))])


def dose_timing_from_ws4(t_star_min: float, rad: dict, storm_replay: dict) -> DoseTiming:
    """DoseTiming from WS4's rad.json (storm_2024.series at sample midpoints, tripwire_utc,
    leash.D_allow_mGy) and conditions.yaml storm_replay (D39). The series is shifted so the
    tripwire fires at EVA minute t*: eva_min(utc) = t* + (utc - tripwire_utc) / 1 min.
    Null samples are dropped (linear between valid midpoints)."""
    from datetime import datetime

    if storm_replay.get("tripwire_at") != "route_max_t_home":
        raise ValueError(f"storm_replay.tripwire_at {storm_replay.get('tripwire_at')!r} "
                         "not implemented (route_max_t_home only)")  # fmt: skip
    if storm_replay.get("anchor_event", "tripwire") != "tripwire":
        raise ValueError("storm_replay.anchor_event must be 'tripwire'")
    if storm_replay.get("tie_break", "first") != "first":
        raise ValueError("storm_replay.tie_break must be 'first'")

    def ts(u):
        return datetime.fromisoformat(u.replace("Z", "+00:00")).timestamp()

    st = rad["storm_2024"]
    trip = ts(st["tripwire_utc"])
    rows = [(ts(u), float(v)) for u, v in st["series"] if v is not None]
    eva = np.array([t_star_min + (t - trip) / 60.0 for t, _ in rows])
    rate = np.array([v / 1000.0 / 24.0 for _, v in rows])  # uGy/day -> mGy/h
    return DoseTiming(t_star_min=float(t_star_min), eva_min=eva, rate_mgy_h=rate,
                      d_allow_mgy=float(rad["leash"]["D_allow_mGy"]),
                      tripwire_offset_min=float((trip - rows[0][0]) / 60.0),
                      source="conditions.yaml storm_replay (D39) + rad.json")  # fmt: skip
