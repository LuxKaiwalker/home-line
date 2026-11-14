"""Route margin (SPEC F4, F9; O2 term per S review 2026-11-14, crew.yaml o2_margin):

    m(t) = min( O2 term ,  t_dark - t - T_home ,  tau_dose - T_home )
    O2 term = (O2_left - O2_return_route - O2_station_tasks - O2_reserve) / effort_rate

* All O2 quantities in litres; the O2 term is converted to "minutes at maximum effort" at the
  effort-capped rate (effort_cap * VO2max * m_b / 1000 = 1.35 L/min).
* O2_left = crew.o2_budget[margin_uses] - O2 used so far. O2 used includes the walking and the
  station work at the task rate (0.84 L/min = 1,000 BTU/hr), which replaces the resting V0.
* O2_return_route = O2_home(x) from the return field (no (1 + r) factor any more).
* O2_station_tasks = task O2 still to do at the station the crew is working at (0 while
  walking): the margin on arrival already covers finishing that station's tasks. Confirmed
  (decision log 2026-11-14 15:40, user for S).
* O2_reserve = fixed 30 min at the effort cap = 40.5 L. crew.o2_reserve_frac (r) is NOT used.
* t_dark (min since EVA start) and tau_dose (min) come from WS4 (daylight, dose leash). While
  they are missing their terms are left out and ``terms`` says which were used.

Binding term names follow the card contract: "O2" | "daylight" | "dose".
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
    tau_dose_min: float | None = None

    @property
    def terms(self) -> list[str]:
        out = ["O2"]
        if self.t_dark_min is not None:
            out.append("daylight")
        if self.tau_dose_min is not None:
            out.append("dose")
        return out


_BUDGET_KEYS = {"primary_L": ("primary_design_eva_h", "primary_design_rate_btu_h"),
                "secondary_L": ("secondary_eva_h", "secondary_design_rate_btu_h")}


def o2_budget_l(which: str = "primary_L") -> float:
    """crew.yaml o2_budget computed from config (decision 14 Nov 15:40, ICES-2026-127):
    O2_L = hours * rate_btu_h / btu_per_kcal / kcal_per_L_O2 (RER 0.85, 5.0225 kcal/L).
    Primary: 8 h x 1,200 BTU/h = 481.99 L; secondary: 1 h x 3,000 BTU/h = 150.62 L."""
    b = load("crew")["o2_budget"]
    if b["conversion"] != "o2_margin.conversion":
        raise ValueError("crew.o2_budget.conversion must point at o2_margin.conversion")
    h_key, r_key = _BUDGET_KEYS[which]
    c = load("crew")["o2_margin"]["conversion"]
    return float(b[h_key]) * float(b[r_key]) / float(c["btu_per_kcal"]) / kcal_per_l_o2()


def o2_capacity_l() -> float:
    """O2 planned against (crew.o2_budget.margin_uses = primary_L), computed from config."""
    return o2_budget_l(load("crew")["o2_budget"]["margin_uses"])


def kcal_per_l_o2() -> float:
    """kcal per litre of O2 at the configured RER (ICES-2026-127 MetRate equation)."""
    c = load("crew")["o2_margin"]["conversion"]
    return float(c["kcal_per_L_vo2"]) + float(c["kcal_per_L_vco2"]) * float(c["rer"])


def btu_h_to_l_min(btu_h: float) -> float:
    """Metabolic rate (BTU/hr) -> O2 uptake (L/min)."""
    c = load("crew")["o2_margin"]["conversion"]
    return float(btu_h) / float(c["btu_per_kcal"]) / SEC_PER_MIN / kcal_per_l_o2()


def effort_rate_l_min(p: Params) -> float:
    om = load("crew")["o2_margin"]
    if om["effort_rate_L_min"].replace(" ", "") != (
            "effort_cap_frac*vo2max_ml_kg_min*body_mass_kg/1000"):  # fmt: skip
        raise ValueError(f"cannot parse o2_margin.effort_rate_L_min {om['effort_rate_L_min']!r}")
    return p.cap * p.m_b / ML_PER_L


def inputs(p: Params, t_dark_min: float | None = None, tau_dose_min: float | None = None,
           ) -> MarginInputs:  # fmt: skip
    """Margin inputs from config (crew.yaml o2_margin) for the walker p (variant + suit)."""
    if load("variants")["route"]["o2_margin"] != "crew.o2_margin":
        raise ValueError("variants.route.o2_margin must point at crew.o2_margin")
    om = load("crew")["o2_margin"]
    rate = effort_rate_l_min(p)
    return MarginInputs(
        o2_capacity_l=o2_capacity_l(),
        reserve_l=float(om["reserve_min_at_effort_cap"]) * rate,
        o2_rate_l_min=rate,
        dwell_rate_l_min=float(om["station_task_rate_L_min"]),
        planning_rate_l_min=btu_h_to_l_min(om["planning_rate_btu_h"]),
        t_dark_min=t_dark_min,
        tau_dose_min=tau_dose_min,
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
    if mi.tau_dose_min is not None:
        terms["dose"] = mi.tau_dose_min - t_home_min
    binding = min(terms, key=terms.get)
    return float(terms[binding]), binding


def latest_departure(mi: MarginInputs, t0: float, u0: float, rate: float, tau_v, o2path_v,
                     t_home_v, o2_home_v) -> float:  # fmt: skip
    """Latest departure time t >= t0 on a leg so that m >= 0 at every sampled vertex v.

    O2 used at departure is u0 + rate (t - t0) (rate >= 0); at vertex v it adds o2path_v; the
    walker reaches v at t + tau_v. Each term is non-increasing in t, so the set of feasible
    departures is (-inf, latest]. Returns -inf if no departure time works.
    """
    tau_v, o2path_v = np.asarray(tau_v, float), np.asarray(o2path_v, float)
    t_home_v, o2_home_v = np.asarray(t_home_v, float), np.asarray(o2_home_v, float)
    if not (np.all(np.isfinite(t_home_v)) and np.all(np.isfinite(o2_home_v))):
        return -np.inf
    slack = o2_slack_l(mi, u0 + o2path_v, o2_home_v)
    if rate > 0:
        latest = t0 + float(np.min(slack)) / rate
    else:
        latest = np.inf if np.min(slack) >= 0 else -np.inf
    if mi.t_dark_min is not None:
        latest = min(latest, float(np.min(mi.t_dark_min - tau_v - t_home_v)))
    if mi.tau_dose_min is not None and np.max(t_home_v) > mi.tau_dose_min:
        return -np.inf
    return latest
