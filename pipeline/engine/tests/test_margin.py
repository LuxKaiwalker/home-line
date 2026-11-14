"""Route margin m(t) (SPEC F4, F9) known answers by hand."""

import math

import numpy as np
import pytest

from pipeline.engine import margin, physio
from pipeline.engine.config import load

CREW = load("crew")
P = physio.params("nominal", suit_kg=104)


def test_inputs_from_config():
    mi = margin.inputs(P)
    assert mi.o2_capacity_l == CREW["o2_budget"]["primary_L"]  # margin_uses: primary_L
    assert mi.reserve_frac == CREW["o2_reserve_frac"]
    cap = CREW["effort_cap_frac"] * CREW["vo2max_ml_kg_min"]
    assert mi.o2_rate_l_min == pytest.approx(cap * CREW["body_mass_kg"] / 1000)  # 1.35 L/min
    assert mi.dwell_rate_l_min == pytest.approx(6 * 75 / 1000)  # V0 nominal = 6
    assert mi.terms == ["O2"]


def test_margin_o2_term_by_hand():
    mi = margin.inputs(P)
    # used 100 L, walk home costs 20 L: (504 - 100 - 1.2 * 20) / 1.35 = 281.48 min
    m, b = margin.margin(mi, 120.0, 100.0, 15.0, 20.0)
    assert b == "O2"
    assert m == pytest.approx((504 - 100 - 1.2 * 20) / 1.35)


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
    # min(504 - o2p - 1.2 oh) / 1.35 = (504 - 32.4) / 1.35 = 349.3 -> daylight binds
    t = margin.latest_departure(mi, 0.0, 0.0, mi.o2_rate_l_min, tau, o2p, th, oh)
    assert t == pytest.approx(280.0)
    # and at that departure the margin is 0 at the binding vertices, >= 0 everywhere
    for k in range(3):
        m, _ = margin.margin(mi, t + tau[k], 1.35 * t + o2p[k], th[k], oh[k])
        assert m >= -1e-9
    mi2 = margin.inputs(P)
    t2 = margin.latest_departure(mi2, 0.0, 0.0, mi2.o2_rate_l_min, tau, o2p, th, oh)
    assert t2 == pytest.approx((504 - 32.4) / 1.35)


def test_latest_departure_dose_and_unknown():
    mi = margin.inputs(P, tau_dose_min=15.0)
    assert margin.latest_departure(mi, 0, 0, 1.0, [0, 1], [0, 1], [20, 10], [5, 2]) == -math.inf
    mi = margin.inputs(P)
    assert margin.latest_departure(mi, 0, 0, 1.0, [0], [0], [np.inf], [1]) == -math.inf
