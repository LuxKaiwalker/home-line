"""Route margin m(t) (SPEC F4, F9; O2 term per S review 2026-11-14) known answers by hand."""

import math

import numpy as np
import pytest

from pipeline.engine import margin, physio
from pipeline.engine.config import load

CREW = load("crew")
OM = CREW["o2_margin"]
P = physio.params("nominal", suit_kg=104)
RES = 30 * 1.35  # fixed reserve: 30 min at the effort cap = 40.5 L


def test_inputs_from_config():
    mi = margin.inputs(P)
    assert mi.o2_capacity_l == CREW["o2_budget"]["primary_L"]  # margin_uses: primary_L
    cap = CREW["effort_cap_frac"] * CREW["vo2max_ml_kg_min"]
    assert mi.o2_rate_l_min == pytest.approx(cap * CREW["body_mass_kg"] / 1000)  # 1.35 L/min
    assert mi.o2_rate_l_min == pytest.approx(1.35)
    assert mi.reserve_l == pytest.approx(RES)
    assert mi.reserve_frac == 0.0  # r is replaced by the fixed reserve, never both
    assert mi.dwell_rate_l_min == OM["station_task_rate_L_min"] == 0.84
    assert mi.terms == ["O2"]


def test_btu_conversion_matches_review():
    """ICES-2026-127 at RER 0.85: ~5.02 kcal per L O2; 1000 BTU/hr ~ 0.84 L/min,
    effort cap 1.35 L/min ~ 1,600 BTU/hr, 1200 BTU/hr ~ 1.0 L/min."""
    kcal_per_l = 4.039 + 1.157 * 0.85
    assert margin.kcal_per_l_o2() == pytest.approx(kcal_per_l)
    assert margin.btu_h_to_l_min(1000) == pytest.approx(0.84, rel=0.01)
    assert margin.btu_h_to_l_min(1000) == pytest.approx(1000 / 3.96567 / 60 / kcal_per_l)
    assert 1.35 * kcal_per_l * 60 * 3.96567 == pytest.approx(1600, rel=0.02)
    assert margin.inputs(P).planning_rate_l_min == pytest.approx(1.0042, abs=1e-3)


def test_margin_o2_term_by_hand():
    mi = margin.inputs(P)
    # used 100 L, walk home costs 20 L: (504 - 100 - 20 - 40.5) / 1.35 = 254.44 min
    m, b = margin.margin(mi, 120.0, 100.0, 15.0, 20.0)
    assert b == "O2"
    assert m == pytest.approx((504 - 100 - 20 - RES) / 1.35)
    # 15 min of station tasks still to do: minus 15 * 0.84 = 12.6 L
    m2, _ = margin.margin(mi, 120.0, 100.0, 15.0, 20.0, tasks_l=15 * 0.84)
    assert m2 == pytest.approx((504 - 100 - 20 - 12.6 - RES) / 1.35)
    # same O2 slack at the 1,200 BTU/hr planning rate
    assert margin.o2_margin_min(mi, 100.0, 20.0, rate_l_min=mi.planning_rate_l_min) == (
        pytest.approx((504 - 100 - 20 - RES) / mi.planning_rate_l_min))


def test_legacy_inputs_reproduce_session1_formula():
    """For the before/after comparison only: (O2_left - 1.2 O2_home) / 1.35, dwell at V0."""
    old = margin.legacy_inputs(P)
    m, _ = margin.margin(old, 120.0, 100.0, 15.0, 20.0)
    assert m == pytest.approx((504 - 100 - 1.2 * 20) / 1.35)
    assert old.dwell_rate_l_min == pytest.approx(6 * 75 / 1000) and old.reserve_l == 0.0


def test_margin_daylight_and_dose_bind():
    mi = margin.inputs(P, t_dark_min=200.0, tau_dose_min=500.0)
    m, b = margin.margin(mi, 150.0, 50.0, 30.0, 40.0)
    assert (m, b) == (pytest.approx(20.0), "daylight")  # 200 - 150 - 30
    mi = margin.inputs(P, t_dark_min=1e4, tau_dose_min=25.0)
    m, b = margin.margin(mi, 150.0, 50.0, 30.0, 40.0)
    assert (m, b) == (pytest.approx(-5.0), "dose")
    assert mi.terms == ["O2", "daylight", "dose"]


def test_latest_departure_solves_each_term():
    mi = margin.inputs(P, t_dark_min=300.0)
    tau = np.array([0.0, 10.0, 20.0])
    o2p = np.array([0.0, 13.5, 27.0])
    th = np.array([20.0, 10.0, 0.0])
    oh = np.array([27.0, 13.5, 0.0])
    # daylight: 300 - tau - th = 280 at every vertex; O2 (u0 = 0, rate 1.35):
    # min(504 - o2p - oh - 40.5) / 1.35 = (504 - 27 - 40.5) / 1.35 = 323.3 -> daylight binds
    t = margin.latest_departure(mi, 0.0, 0.0, mi.o2_rate_l_min, tau, o2p, th, oh)
    assert t == pytest.approx(280.0)
    for k in range(3):
        m, _ = margin.margin(mi, t + tau[k], 1.35 * t + o2p[k], th[k], oh[k])
        assert m >= -1e-9
    mi2 = margin.inputs(P)
    t2 = margin.latest_departure(mi2, 0.0, 0.0, mi2.o2_rate_l_min, tau, o2p, th, oh)
    assert t2 == pytest.approx((504 - 27 - RES) / 1.35)
    m, b = margin.margin(mi2, t2 + tau[2], 1.35 * t2 + o2p[2], th[2], oh[2])
    assert (m, b) == (pytest.approx(0.0, abs=1e-9), "O2")


def test_latest_departure_dose_and_unknown():
    mi = margin.inputs(P, tau_dose_min=15.0)
    assert margin.latest_departure(mi, 0, 0, 1.0, [0, 1], [0, 1], [20, 10], [5, 2]) == -math.inf
    mi = margin.inputs(P)
    assert margin.latest_departure(mi, 0, 0, 1.0, [0], [0], [np.inf], [1]) == -math.inf
