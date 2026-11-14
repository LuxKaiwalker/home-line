"""Route margin (SPEC F4, F9):

    m(t) = min( O2_left - (1 + r) O2_home ,  t_dark - t - T_home ,  tau_dose - T_home )

* O2_left = crew.o2_budget[margin_uses] - O2 used so far (L); r = crew.o2_reserve_frac.
* The O2 term is in litres, the others in minutes. It is turned into minutes at the
  effort-capped O2 rate (variants.yaml route.o2_margin_rate, assumed, S to confirm).
* t_dark (min since EVA start) and tau_dose (min) come from WS4 (daylight, dose leash). While
  they are missing their terms are left out and ``terms`` says which were used.

Binding term names follow the card contract: "O2" | "daylight" | "dose".
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np

from .config import load
from .physio import ML_PER_L, Params


@dataclass(frozen=True)
class MarginInputs:
    o2_capacity_l: float
    reserve_frac: float
    o2_rate_l_min: float  # converts the O2 term to minutes
    dwell_rate_l_min: float  # O2 use while dwelling
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


def o2_capacity_l() -> float:
    b = load("crew")["o2_budget"]
    return float(b[b["margin_uses"]])


def inputs(p: Params, t_dark_min: float | None = None, tau_dose_min: float | None = None,
           ) -> MarginInputs:  # fmt: skip
    """Margin inputs from config for the walker p (variant + suit)."""
    route = load("variants")["route"]
    if route["o2_margin_rate"].replace(" ", "") != "effort_cap*VO2max*m_b/1000":
        raise ValueError(f"cannot parse route.o2_margin_rate {route['o2_margin_rate']!r}")
    if not re.fullmatch(r"\s*V0\s*", route["dwell_vo2"]):
        raise ValueError(f"cannot parse route.dwell_vo2 {route['dwell_vo2']!r}")
    return MarginInputs(
        o2_capacity_l=o2_capacity_l(),
        reserve_frac=float(load("crew")["o2_reserve_frac"]),
        o2_rate_l_min=p.cap * p.m_b / ML_PER_L,
        dwell_rate_l_min=p.V0 * p.m_b / ML_PER_L,
        t_dark_min=t_dark_min,
        tau_dose_min=tau_dose_min,
    )


def margin(mi: MarginInputs, t_min, o2_used_l, t_home_min, o2_home_l):
    """(margin_min, binding) at absolute EVA time t with o2_used so far, at a point whose walk
    home takes t_home / o2_home. Scalars only."""
    terms = {"O2": (mi.o2_capacity_l - o2_used_l - (1 + mi.reserve_frac) * o2_home_l)
             / mi.o2_rate_l_min}  # fmt: skip
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
    slack = mi.o2_capacity_l - u0 - o2path_v - (1 + mi.reserve_frac) * o2_home_v
    if rate > 0:
        latest = t0 + float(np.min(slack)) / rate
    else:
        latest = np.inf if np.min(slack) >= 0 else -np.inf
    if mi.t_dark_min is not None:
        latest = min(latest, float(np.min(mi.t_dark_min - tau_v - t_home_v)))
    if mi.tau_dose_min is not None and np.max(t_home_v) > mi.tau_dose_min:
        return -np.inf
    return latest
