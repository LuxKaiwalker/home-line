"""WS9 navigation KATs (SPEC §9 "F21 navigation" / "F22 skyline fix", brief WS9 "Tests").

Synthetic inputs only. Every model constant comes from config/nav.yaml (and crew.yaml for the
walking speed); tests override parameters only to isolate one error term. Small Monte Carlo N
with a fixed seed keeps the suite fast; the full N from config is used only in real runs.
"""

from __future__ import annotations

import json
import math

import numpy as np
import pytest

from pipeline.navigation import deadreckon as dr
from pipeline.navigation import montecarlo as mc

NAV = dr.load_config()
SPEED = dr.walking_speed_ms()  # crew.yaml anchor speed (0.98 m/s)
SEED = NAV["monte_carlo"]["seed"]


def zero_params(**kw) -> dr.NavParams:
    p = dr.NavParams.from_config(NAV["default_set"]).replace(
        sigma_s=0.0, sigma_b_deg_h=0.0, psi0_deg=0.0, psi_rw_deg_sqrt_min=0.0, slip=0.0,
        step_noise_frac=0.0)
    return p.replace(**kw)


# --------------------------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------------------------

def test_sets_load_from_config():
    for name, raw in NAV["sets"].items():
        p = dr.NavParams.from_config(name)
        assert p.sigma_s == raw["sigma_s"]
        assert p.sigma_b_deg_h == raw["sigma_b_deg_h"]
        assert p.psi0_deg == raw["psi0_deg"]
        assert p.psi_rw_deg_sqrt_min == raw["psi_rw_deg_sqrt_min"]
        assert p.slip == raw["slip"]
        assert p.step_m == NAV["step_m"]
        assert p.step_noise_frac == NAV["step_noise_frac"]
        assert p.slip_min_slope_deg == NAV["slip_min_slope_deg"]
    assert dr.NavParams.from_config().name == NAV["default_set"]


def test_walking_speed_is_crew_anchor():
    assert SPEED == pytest.approx(0.98)


# --------------------------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------------------------

def test_straight_route_geometry():
    tr = dr.straight_route(600.0, SPEED, heading_deg=90.0)
    assert tr.t_s[0] == 0 and tr.t_s[-1] == pytest.approx(600.0)
    assert np.allclose(np.diff(tr.t_s), NAV["monte_carlo"]["dt_s"])
    assert tr.x[-1] == pytest.approx(600.0 * SPEED)
    assert np.allclose(tr.y, 0.0, atol=1e-9)
    assert tr.distance_m[-1] == pytest.approx(600.0 * SPEED)


def test_piecewise_route_dwells_and_distance():
    pts = [(0.0, 0.0), (0.0, 300.0), (400.0, 300.0)]
    tr = dr.piecewise_route(pts, SPEED, dwell_s={1: 120.0})
    total = 700.0
    assert tr.distance_m[-1] == pytest.approx(total, rel=1e-9)
    assert tr.t_s[-1] == pytest.approx(total / SPEED + 120.0, abs=1.0)
    # stationary during the dwell
    t_arrive = 300.0 / SPEED
    i0 = int(np.ceil(t_arrive)) + 1
    i1 = int(np.floor(t_arrive + 120.0)) - 1
    assert np.allclose(tr.x[i0:i1], 0.0) and np.allclose(tr.y[i0:i1], 300.0)


# --------------------------------------------------------------------------------------------
# F21 KAT 1: zero-error parameters give estimate = truth
# --------------------------------------------------------------------------------------------

def test_zero_error_estimate_equals_truth():
    pts = [(0.0, 0.0), (250.0, 400.0), (-300.0, 900.0), (0.0, 0.0)]
    tr = dr.piecewise_route(pts, SPEED, dwell_s={1: 300.0, 2: 60.0},
                            slope_deg=25.0)  # steep: slip term would fire if non-zero
    res = dr.simulate(tr, zero_params(), runs=20, seed=SEED, record_every_s=1)
    assert np.allclose(res.est_x, tr.x[None, :], atol=1e-9)
    assert np.allclose(res.est_y, tr.y[None, :], atol=1e-9)


# --------------------------------------------------------------------------------------------
# F21 KAT 2: heading bias only, straight route -> analytic lateral error within 1 %
# --------------------------------------------------------------------------------------------

def test_heading_bias_only_matches_analytic_lateral_error():
    sigma_b = NAV["sets"]["high"]["sigma_b_deg_h"]
    p = zero_params(sigma_b_deg_h=sigma_b)
    T = 3600.0
    heading = 90.0  # due east (x); positive heading error turns clockwise = to the right (-y)
    tr = dr.straight_route(T, SPEED, heading_deg=heading)
    res = dr.simulate(tr, p, runs=200, seed=SEED, record_every_s=60)
    b = np.radians(res.gyro_bias_deg_h) / 3600.0  # rad/s, per run
    assert np.std(res.gyro_bias_deg_h) == pytest.approx(sigma_b, rel=0.15)
    ex = res.est_x[:, -1] - tr.x[-1]
    ey = res.est_y[:, -1] - tr.y[-1]
    lateral_right = -ey  # right of an eastward track is -y
    along = ex
    big = np.abs(b) > 1e-9
    analytic_lat = np.where(big, SPEED * (1.0 - np.cos(b * T)) / np.where(big, b, 1.0), 0.0)
    analytic_along = np.where(big, SPEED * np.sin(b * T) / np.where(big, b, 1.0), SPEED * T) \
        - SPEED * T
    sel = np.abs(analytic_lat) > 1.0
    assert sel.sum() > 150
    assert np.allclose(lateral_right[sel], analytic_lat[sel], rtol=0.01)
    assert np.allclose(along, analytic_along, rtol=0.01, atol=0.01)


# --------------------------------------------------------------------------------------------
# F21 KAT 3: the 95 % ellipse covers 93-97 % of runs
# --------------------------------------------------------------------------------------------

@pytest.fixture(scope="module")
def medium_straight():
    tr = dr.straight_route(3600.0, SPEED, heading_deg=60.0)
    p = dr.NavParams.from_config("medium")
    # the full Monte Carlo from config (nav.yaml monte_carlo: runs, seed)
    return tr, p, dr.simulate(tr, p, record_every_s=60)


def test_ellipse_95_covers_93_to_97_pct(medium_straight):
    tr, p, res = medium_straight
    conf = NAV["ellipse_conf"]
    for minute in (10, 30, 60):
        k = res.record_index(minute)
        e = res.errors(k)
        ell = mc.error_ellipse(e, conf)
        cov = mc.coverage(e, ell, conf)
        assert 0.93 <= cov <= 0.97, (minute, cov)


def test_ellipse_axes_and_orientation_known_covariance():
    rng = np.random.default_rng(SEED)
    # major axis 10 m along azimuth 30 deg (clockwise from north), minor 3 m
    n = 200_000
    u = rng.normal(0, 10.0, n)
    v = rng.normal(0, 3.0, n)
    az = math.radians(30.0)
    major = np.array([math.sin(az), math.cos(az)])
    minor = np.array([math.cos(az), -math.sin(az)])
    e = u[:, None] * major + v[:, None] * minor
    ell = mc.error_ellipse(e, 0.95)
    k = math.sqrt(-2.0 * math.log(1.0 - 0.95))
    assert ell["a_m"] == pytest.approx(10.0 * k, rel=0.01)
    assert ell["b_m"] == pytest.approx(3.0 * k, rel=0.01)
    assert ell["theta_deg"] == pytest.approx(30.0, abs=0.5)


def test_ellipse_degenerate_zero_error():
    ell = mc.error_ellipse(np.zeros((50, 2)), 0.95)
    assert ell == {"a_m": 0.0, "b_m": 0.0, "theta_deg": 0.0}


# --------------------------------------------------------------------------------------------
# r95(D) and its fit
# --------------------------------------------------------------------------------------------

def test_r95_fit_recovers_known_coefficients():
    D = np.linspace(0, 3000, 61)
    a, b = 0.04, 2.5e-5
    fit = mc.fit_r95(D, a * D + b * D**2)
    assert fit["a"] == pytest.approx(a, rel=1e-6)
    assert fit["b"] == pytest.approx(b, rel=1e-6)


def test_r95_fit_coefficients_non_negative():
    D = np.linspace(10, 1000, 30)
    fit = mc.fit_r95(D, 5.0 + 0.0 * D)  # flat -> no negative growth terms
    assert fit["a"] >= 0 and fit["b"] >= 0


def test_r95_grows_with_distance_and_faster_than_linear_with_bias(medium_straight):
    tr, p, res = medium_straight
    summ = mc.summarise(res, p)
    r95 = np.array([m["r95_m"] for m in summ["per_minute"]])
    D = np.array([m["dist_since_fix_m"] for m in summ["per_minute"]])
    assert np.all(np.diff(r95[5:]) > -0.05 * r95[6:])  # monotone up to MC noise
    assert summ["r95_fit"]["a"] > 0 and summ["r95_fit"]["b"] > 0
    fitted = summ["r95_fit"]["a"] * D + summ["r95_fit"]["b"] * D**2
    late = D > 1000
    assert np.allclose(fitted[late], r95[late], rtol=0.1)


def test_inverse_r95():
    fit = {"a": 0.05, "b": 2e-5}
    r = np.array([0.0, 5.0, 50.0, 200.0])
    D = mc.inverse_r95(fit, r)
    assert np.allclose(fit["a"] * D + fit["b"] * D**2, r)
    assert mc.inverse_r95({"a": 0.05, "b": 0.0}, 5.0) == pytest.approx(100.0)


# --------------------------------------------------------------------------------------------
# F21 KAT 4: error resets at fixes
# --------------------------------------------------------------------------------------------

def test_error_resets_at_fix():
    tr = dr.straight_route(3600.0, SPEED, heading_deg=0.0)
    p = dr.NavParams.from_config("high")
    sigma = NAV["fix_sigma_m"]["station"]
    fixes = [dr.FixEvent(t_eva_min=30.0, type="station", sigma_m=sigma, station="S1")]
    res = dr.simulate(tr, p, runs=2000, seed=SEED, record_every_s=60, fixes=fixes)
    before = res.errors(res.record_index(29))
    at = res.errors(res.record_index(30))
    after = res.errors(res.record_index(31))
    # just before: large; at the fix: N(0, sigma) per axis; then growing again from there
    assert np.std(before, axis=0).max() > 5 * sigma
    assert np.std(at, axis=0) == pytest.approx([sigma, sigma], rel=0.08)
    assert np.mean(at, axis=0) == pytest.approx([0.0, 0.0], abs=0.3)
    assert np.std(after, axis=0).max() < np.std(before, axis=0).max()
    # distance since fix restarts at the fix
    d = res.dist_since_fix_m
    k = res.record_index(30)
    assert d[k] == pytest.approx(0.0, abs=1e-9)
    assert d[res.record_index(31)] == pytest.approx(60 * SPEED, rel=1e-6)
    # errors after the fix are independent of those before (correlation ~ 0)
    r = np.corrcoef(before[:, 0], at[:, 0])[0, 1]
    assert abs(r) < 0.1


def test_fix_at_start_sets_initial_error():
    tr = dr.straight_route(120.0, SPEED)
    sigma = NAV["fix_sigma_m"]["rover"]
    fixes = [dr.FixEvent(t_eva_min=0.0, type="rover", sigma_m=sigma)]
    res = dr.simulate(tr, zero_params(), runs=4000, seed=SEED, record_every_s=60, fixes=fixes)
    e0 = res.errors(0)
    assert np.std(e0, axis=0) == pytest.approx([sigma, sigma], rel=0.05)
    # zero-error dead reckoning keeps the offset constant
    assert np.allclose(res.errors(res.record_index(2)), e0, atol=1e-9)


# --------------------------------------------------------------------------------------------
# Slip: fires only above the slope threshold
# --------------------------------------------------------------------------------------------

def test_slip_only_above_threshold():
    thr = NAV["slip_min_slope_deg"]
    slip = NAV["sets"]["high"]["slip"]
    p = zero_params(slip=slip)
    flat = dr.straight_route(600.0, SPEED, slope_deg=thr - 0.5)
    steep = dr.straight_route(600.0, SPEED, slope_deg=30.0)
    rf = dr.simulate(flat, p, runs=500, seed=SEED, record_every_s=60)
    rs = dr.simulate(steep, p, runs=500, seed=SEED, record_every_s=60)
    assert np.allclose(rf.errors(-1), 0.0, atol=1e-9)
    e = rs.errors(-1)
    # along-track (east) only; per-step N(0, slip sin(theta) L) summed over d / L steps
    L = NAV["step_m"]
    d = 600.0 * SPEED
    expected = slip * math.sin(math.radians(30.0)) * math.sqrt(L * d)
    assert np.std(e[:, 0]) == pytest.approx(expected, rel=0.1)
    assert np.allclose(e[:, 1], 0.0, atol=1e-9)


def test_scale_factor_only_gives_proportional_along_track_error():
    p = zero_params(sigma_s=NAV["sets"]["medium"]["sigma_s"])
    tr = dr.straight_route(1200.0, SPEED, heading_deg=90.0)
    res = dr.simulate(tr, p, runs=300, seed=SEED, record_every_s=60)
    e = res.errors(-1)
    assert np.allclose(e[:, 0], (res.scale_factor - 1.0) * tr.distance_m[-1], atol=1e-6)
    assert np.std(res.scale_factor) == pytest.approx(p.sigma_s, rel=0.15)


def test_seed_reproducible():
    tr = dr.straight_route(300.0, SPEED)
    p = dr.NavParams.from_config("medium")
    a = dr.simulate(tr, p, runs=10, seed=SEED, record_every_s=60)
    b = dr.simulate(tr, p, runs=10, seed=SEED, record_every_s=60)
    assert np.array_equal(a.est_x, b.est_x) and np.array_equal(a.est_y, b.est_y)


# --------------------------------------------------------------------------------------------
# Contracts: montecarlo, tracks, fixes (written to tmp only)
# --------------------------------------------------------------------------------------------

CONTRACTS = dr.REPO / "contracts"


def _validate(obj, schema):
    """Validate against contracts/<schema> (draft 2020-12), raising on the first error."""
    from jsonschema import Draft202012Validator

    s = json.loads((CONTRACTS / schema).read_text())
    Draft202012Validator(s).validate(obj)


def test_montecarlo_json_validates(tmp_path, medium_straight):
    tr, p, res = medium_straight
    summ = mc.summarise(res, p)
    _validate(summ, "montecarlo.schema.json")
    assert summ["set"] == "medium" and summ["runs"] == NAV["monte_carlo"]["runs"]
    assert summ["per_minute"][0]["t_eva_min"] == 0
    out = mc.write_json(summ, tmp_path / "nav" / "montecarlo_medium.json")
    _validate(json.loads(out.read_text()), "montecarlo.schema.json")


def test_tracks_geojson_validates(tmp_path):
    pts = [(0.0, 0.0), (0.0, 600.0), (500.0, 600.0)]
    tr = dr.piecewise_route(pts, SPEED, dwell_s={1: 300.0})
    p = dr.NavParams.from_config("medium")
    res = dr.simulate(tr, p, runs=100, seed=SEED, record_every_s=60)
    gj = mc.tracks_geojson(res, p)
    _validate(gj, "tracks.schema.json")
    kinds = [f["properties"]["kind"] for f in gj["features"]]
    assert kinds.count("true") == 1 and kinds.count("estimated") == 1
    assert gj["features"][0]["properties"]["t_eva_min"] == pytest.approx(tr.t_s[-1] / 60.0)
    n_ell = kinds.count("ellipse95")
    every = NAV["tracks"]["ellipse_every_min"]
    assert n_ell == int(tr.t_s[-1] / 60 // every) + 1
    ring = next(f for f in gj["features"] if f["properties"]["kind"] == "ellipse95")
    coords = ring["geometry"]["coordinates"][0]
    assert coords[0] == coords[-1]
    assert len(coords) == NAV["tracks"]["ellipse_vertices"] + 1
    # coordinates are lon/lat near the pad, 6 decimals
    lon, lat = gj["features"][0]["geometry"]["coordinates"][0]
    assert abs(lon - dr.pad_lonlat()[0]) < 0.01 and abs(lat - dr.pad_lonlat()[1]) < 0.01
    assert round(lon, 6) == lon


def test_fixes_json_validates():
    fixes = [
        dr.FixEvent(0.0, "rover", NAV["fix_sigma_m"]["rover"]),
        dr.FixEvent(42.5, "station", NAV["fix_sigma_m"]["station"], station="S1"),
        dr.FixEvent(90.0, "skyline", 37.2, station="S2", error_m=37.2, image_id="NLB_test"),
    ]
    out = mc.fixes_json(fixes)
    _validate(out, "fixes.schema.json")
    assert out[0]["error_m"] is None and out[2]["image_id"] == "NLB_test"
    with pytest.raises(ValueError):
        dr.FixEvent(1.0, "skyline", 5.0)  # skyline fix without error_m / image_id


def test_projection_round_trip():
    lon0, lat0 = dr.pad_lonlat()
    x, y = dr.lonlat_to_xy(lon0, lat0)
    lon, lat = dr.xy_to_lonlat(x + 1000.0, y)
    x2, y2 = dr.lonlat_to_xy(lon, lat)
    assert x2 - x == pytest.approx(1000.0, abs=1e-6) and y2 == pytest.approx(y, abs=1e-6)


def test_manifest_records_to_tmp_fragment(tmp_path, medium_straight):
    tr, p, res = medium_straight
    summ = mc.summarise(res, p)
    keys = mc.record_manifest(summ, "data/interim/nav/montecarlo_medium.json",
                              fragment_dir=tmp_path)
    frag = json.loads(next(tmp_path.rglob("*.json")).read_text())
    assert set(keys) <= set(frag)
    assert frag["nav.r95_fit.medium.a"]["value"] == pytest.approx(summ["r95_fit"]["a"])
    assert frag["nav.r95_fit.medium.a"]["units"] == "1"


