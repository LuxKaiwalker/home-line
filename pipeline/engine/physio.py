"""Suited mobility model and speed governor (SPEC F3), exactly per config/variants.yaml.

Formulas (variants.yaml ``formulas``; angles in radians, i = tan(theta)):

    a_anchor = (anchor.vo2 - V0) / anchor.speed                       # mL/kg/min per m/s
    alpha    = ist2.level_increment / (ist2.delta_mass_kg * anchor.speed)
    a(M)     = a_anchor * a_mult + alpha * (M - anchor.carried_kg)
    k        = (m_b + M) g sin(theta) / (eta m_b) * 60 / 20.1          # theta > 0, else 0
    VO2      = V0 + a(M) v + k v                                       # theta >= 0
    VO2      = V0 + a(M) v clamp(f(i) / f(0), lo, hi)                  # theta < 0
    v*       = min(v_safe(theta), (effort_cap VO2max - V0) / (a(M) + k))   # downhill: a(M) f/f0
    O2 [L]   = integral(VO2 m_b dt) / 1000                             # dt in minutes

M is the carried mass (suit + tools, SPEC F3). The Minetti polynomial coefficients and the
downhill clamp are parsed from the formula text in variants.yaml so the config stays the single
source. The only literals here are unit conversions (60 s/min, 1000 mL/L).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, replace

import numpy as np

from .config import load

SEC_PER_MIN = 60.0
ML_PER_L = 1000.0
VARIANT_PREFIX = {"opt": "optimistic", "nom": "nominal", "con": "conservative"}


class MissingInput(RuntimeError):
    """A required upstream number is not available yet (e.g. V1 slope RMSE from WS6)."""


# ------------------------------------------------------------------ formula text parsing


def _parse_minetti(text: str) -> tuple[float, ...]:
    """Coefficients c5..c0 of f(i) from 'f(i) = 280.5 i^5 - 58.7 i^4 ... + 2.5 # ...'."""
    rhs = text.split("=", 1)[1].split("#", 1)[0].replace(" ", "")
    coef = dict.fromkeys(range(6), 0.0)
    for sign, num, var, power in re.findall(r"([+-]?)([\d.]+)(i)?(?:\^(\d))?", rhs):
        deg = (int(power) if power else 1) if var else 0
        coef[deg] = float(num) * (-1.0 if sign == "-" else 1.0)
    return tuple(coef[d] for d in range(5, -1, -1))


def _parse_clamp(text: str) -> tuple[float, float]:
    m = re.search(r"clamp\(\s*f\(i\)\s*/\s*f\(0\)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)", text)
    if not m:
        raise ValueError(f"cannot parse downhill clamp from {text!r}")
    return float(m.group(1)), float(m.group(2))


_F = load("variants")["formulas"]
MINETTI_COEF = _parse_minetti(_F["minetti_f"])
DOWNHILL_CLAMP = _parse_clamp(_F["vo2_downhill"])


def minetti_f(i):
    """Minetti 2002 cost-of-transport shape f(i) (J/kg/m on Earth; shape only here)."""
    return np.polyval(MINETTI_COEF, i)


def downhill_mult(i):
    """clamp(f(i) / f(0), lo, hi) for i = tan(theta) < 0."""
    lo, hi = DOWNHILL_CLAMP
    return np.clip(minetti_f(i) / minetti_f(0.0), lo, hi)


# ------------------------------------------------------------------ parameters


@dataclass(frozen=True)
class Params:
    variant: str
    eta: float
    V0: float
    a_mult: float
    nogo_deg: float
    m_b: float  # body mass, kg
    carried_kg: float  # M = suit + tools, kg
    g: float
    vo2max: float
    effort_cap: float
    anchor_vo2: float
    anchor_speed: float
    anchor_carried_kg: float
    alpha: float
    j_per_ml: float
    vsafe_max_deg: tuple[float, ...]
    vsafe_v: tuple[float, ...]

    @property
    def a_anchor(self) -> float:
        return (self.anchor_vo2 - self.V0) / self.anchor_speed

    @property
    def cap(self) -> float:
        """Effort-capped VO2, mL/kg/min."""
        return self.effort_cap * self.vo2max


def parse_scenario(sid: str) -> tuple[str, int]:
    """'nom_104' -> ('nominal', 104)."""
    pre, suit = sid.split("_")
    return VARIANT_PREFIX[pre], int(suit)


def resolve_nogo(spec, v1_rmse_deg: float | None) -> float:
    """Variant slope limit. The conservative one is the text '20 - v1_rmse_deg'."""
    if isinstance(spec, (int, float)):
        return float(spec)
    m = re.fullmatch(r"\s*([\d.]+)\s*-\s*v1_rmse_deg\s*", str(spec))
    if not m:
        raise ValueError(f"cannot parse nogo_deg {spec!r}")
    if v1_rmse_deg is None:
        raise MissingInput("conservative nogo_deg needs v1_rmse_deg (V1 slope RMSE, WS6)")
    return float(m.group(1)) - float(v1_rmse_deg)


def params(
    variant: str,
    suit_kg: float | None = None,
    *,
    carried_kg: float | None = None,
    v1_rmse_deg: float | None = None,
) -> Params:
    """Build Params for a variant and either a suit mass (M = suit + tools) or carried mass M."""
    crew, var = load("crew"), load("variants")
    v = var["variants"][variant]
    if carried_kg is None:
        if suit_kg is None:
            suit_kg = crew["default_suit_kg"]
        carried_kg = float(suit_kg) + crew["tools_kg"]
    a, ist2 = crew["anchor"], var["ist2"]
    table = sorted(crew["v_safe_ms"], key=lambda r: r["max_deg"])
    return Params(
        variant=variant,
        eta=float(v["eta"]),
        V0=float(v["V0"]),
        a_mult=float(v["a_mult"]),
        nogo_deg=resolve_nogo(v["nogo_deg"], v1_rmse_deg),
        m_b=float(crew["body_mass_kg"]),
        carried_kg=float(carried_kg),
        g=float(crew["g_mars"]),
        vo2max=float(crew["vo2max_ml_kg_min"]),
        effort_cap=float(crew["effort_cap_frac"]),
        anchor_vo2=float(a["vo2_ml_kg_min"]),
        anchor_speed=float(a["speed_ms"]),
        anchor_carried_kg=float(a["carried_kg"]),
        alpha=ist2["level_increment_ml_kg_min"] / (ist2["delta_mass_kg"] * a["speed_ms"]),
        j_per_ml=float(crew["o2_energy_j_per_ml"]),
        vsafe_max_deg=tuple(float(r["max_deg"]) for r in table),
        vsafe_v=tuple(float(r["v"]) for r in table),
    )


def scenario_params(sid: str, *, v1_rmse_deg: float | None = None) -> Params:
    variant, suit = parse_scenario(sid)
    return params(variant, suit_kg=suit, v1_rmse_deg=v1_rmse_deg)


# ------------------------------------------------------------------ model


def a_of_m(p: Params, m: float | None = None) -> float:
    """Level cost slope a(M), mL/kg/min per m/s."""
    m = p.carried_kg if m is None else m
    return p.a_anchor * p.a_mult + p.alpha * (m - p.anchor_carried_kg)


def k_uphill(p: Params, theta):
    """Uphill term k(theta, M), mL/kg/min per m/s; 0 for theta <= 0."""
    th = np.asarray(theta, dtype=float)
    k = (p.m_b + p.carried_kg) * p.g * np.sin(th) / (p.eta * p.m_b) * SEC_PER_MIN / p.j_per_ml
    out = np.where(th > 0, k, 0.0)
    return out if out.ndim else float(out)


def cost_slope(p: Params, theta):
    """d VO2 / d v at grade theta: a + k uphill, a * clamp(f/f0) downhill."""
    th = np.asarray(theta, dtype=float)
    a = a_of_m(p)
    out = np.where(th >= 0, a + k_uphill(p, th), a * downhill_mult(np.tan(np.minimum(th, 0.0))))
    return out if out.ndim else float(out)


def vo2(p: Params, v, theta):
    """Oxygen uptake, mL/kg/min, at speed v (m/s) and grade angle theta (rad)."""
    out = p.V0 + cost_slope(p, theta) * np.asarray(v, dtype=float)
    return out if np.ndim(out) else float(out)


def v_safe(p: Params, theta):
    """Safety speed from the crew.yaml table by |theta|; 0 beyond the last row."""
    deg = np.abs(np.degrees(np.asarray(theta, dtype=float)))
    out = np.zeros_like(deg)
    for max_deg, v in zip(reversed(p.vsafe_max_deg), reversed(p.vsafe_v), strict=True):
        out = np.where(deg <= max_deg, v, out)
    return out if out.ndim else float(out)


def governor(p: Params, theta):
    """Governed speed v* (m/s) = min(v_safe, (cap - V0) / cost_slope)."""
    vs = v_safe(p, theta)
    v_cap = max(p.cap - p.V0, 0.0) / cost_slope(p, theta)
    out = np.minimum(vs, v_cap)
    return out if np.ndim(out) else float(out)


def o2_litres(p: Params, vo2_ml_kg_min, minutes):
    """O2 = VO2 * m_b * dt / 1000 (litres) for a constant VO2 over `minutes`."""
    return np.asarray(vo2_ml_kg_min) * p.m_b * np.asarray(minutes) / ML_PER_L


def heat_w(p: Params, vo2_ml_kg_min):
    """Metabolic heat (W) = VO2 * m_b / 60 * 20.1 J/mL."""
    return np.asarray(vo2_ml_kg_min) * p.m_b / SEC_PER_MIN * p.j_per_ml


# ------------------------------------------------------------------ router lookup table


@dataclass(frozen=True)
class GradeTable:
    """Per-metre time and O2 as a function of edge grade angle, for the router kernels.

    theta_deg is uniform from -90 to 90 deg; pace is inf where impassable
    (|theta| > nogo_deg or v* = 0). Kernels interpolate linearly.
    """

    theta_deg: np.ndarray
    pace_s_per_m: np.ndarray
    o2_l_per_m: np.ndarray
    step_deg: float


def table_step_deg() -> float:
    """Lookup-table resolution (variants.yaml numerics.grade_table_step_deg)."""
    return float(load("variants")["numerics"]["grade_table_step_deg"])


def grade_table(p: Params, step_deg: float | None = None) -> GradeTable:
    step_deg = table_step_deg() if step_deg is None else step_deg
    n = int(round(180.0 / step_deg)) + 1
    deg = np.linspace(-90.0, 90.0, n)
    th = np.radians(deg)
    v = governor(p, th)
    ok = (np.abs(deg) <= p.nogo_deg + 1e-9) & (v > 0)
    vv = np.where(ok, v, 1.0)
    pace = np.where(ok, 1.0 / vv, np.inf)
    o2 = np.where(ok, o2_litres(p, vo2(p, vv, th), 1.0 / vv / SEC_PER_MIN), np.inf)
    return GradeTable(deg, pace, o2, 180.0 / (n - 1))


def level_to_grade_increment(p: Params, v: float) -> dict:
    """Level -> 20 % / 30 % increment k*v (mL/kg/min) at speed v. NOT validated: IST-2's
    8.7 / 17.0 are weight-span differences, not this quantity (S review 2026-11-14), and no
    measured level -> grade reference is in hand (variants.yaml ist2.level_to_grade_validated)."""
    out: dict = {f"grade_{g}pct": float(k_uphill(p, math.atan(g / 100)) * v) for g in (20, 30)}
    out["validated"] = bool(load("variants")["ist2"]["level_to_grade_validated"])
    return out


def ist2_weight_span(variant: str = "nominal") -> dict:
    """IST-2 weight-span check (S review 2026-11-14, variants.yaml ist2.weight_span).

    The model is run at the same grade at the lightest and heaviest IST-2 weight (g fractions
    of Earth g) with the IST-2 system (carried = system_kg, body = subject_kg, so VO2 is per kg
    of subject mass) over the IST-2 speed range. The band is min..max of the difference over
    the speed sweep; ``inside`` says whether IST-2's reported difference falls in it. Only the
    variant's eta matters (V0 and a(M) do not depend on g and cancel).
    """
    ist2 = load("variants")["ist2"]
    w = ist2["weight_span"]
    eta = float(load("variants")["variants"][variant]["eta"])
    base = params("nominal", carried_kg=float(w["system_kg"]))
    base = replace(base, variant=variant, eta=eta, m_b=float(w["subject_kg"]))
    g_lo, g_hi = (float(f) * float(ist2["g_earth_ms2"]) for f in w["g_frac"])
    v = np.linspace(float(w["speed_ms"][0]), float(w["speed_ms"][1]), int(w["speed_sweep_n"]))
    out: dict = {"variant": variant, "eta": eta, "speed_ms": [float(v[0]), float(v[-1])]}
    for key, reported in ist2["uphill_check_ml_kg_min"].items():
        th = math.atan(float(key.split("_")[1].rstrip("pct")) / 100)
        d = vo2(replace(base, g=g_hi), v, th) - vo2(replace(base, g=g_lo), v, th)
        lo, hi = float(np.min(d)), float(np.max(d))
        out[key] = {"band": [lo, hi], "reported": float(reported),
                    "inside": bool(lo <= reported <= hi)}  # fmt: skip
    return out
