"""WS3 horizon KATs (SPEC §9 "Horizon and camera", brief WS3 "Tests"), synthetic data only.

Every constant comes from config/ (horizon.yaml, site.yaml). Synthetic DEMs are built in memory.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from pipeline.horizon import config as hcfg
from pipeline.horizon.rays import DemBand, HorizonEngine, HorizonProfile, curvature_drop

CFG = hcfg.load()
R = hcfg.mars_radius_m()
EYE = CFG["eye_height_m"]
I_EAST = int(round(90.0 / CFG["az_step_deg"]))
I_WEST = int(round(270.0 / CFG["az_step_deg"]))


def band_from_centers(source, z, x_first, y_first, res):
    """North-up band whose pixel (0, 0) centre is at (x_first, y_first)."""
    return DemBand.from_transform(
        source, np.asarray(z, dtype=np.float32),
        (x_first - res / 2.0, res, 0.0, y_first + res / 2.0, 0.0, -res),
    )


def plane_band(source, half_extent_m, res, z=0.0):
    n = int(round(2 * half_extent_m / res)) + 1
    return band_from_centers(source, np.full((n, n), z), -half_extent_m, half_extent_m, res)


# --------------------------------------------------------------------------------------------
# Curvature
# --------------------------------------------------------------------------------------------

def test_mars_radius_from_site_config():
    assert R == pytest.approx(3_396_190.0)


def test_curvature_drop_at_20km_is_58_9_m():
    """Brief WS3 / SPEC §9: curvature drop at 20 km = 58.9 m (R = 3,396.19 km)."""
    assert round(curvature_drop(20_000.0, R), 1) == 58.9
    assert curvature_drop(20_000.0) == pytest.approx(20_000.0**2 / (2 * R))


# --------------------------------------------------------------------------------------------
# Ray engine
# --------------------------------------------------------------------------------------------

@pytest.fixture(scope="module")
def flat_engine():
    bands = [
        plane_band("dem_1m", 600.0, 1.0),
        plane_band("ctx_20m", 6_000.0, 20.0),
        plane_band("mola_hrsc_200m", 82_000.0, 200.0),
    ]
    return HorizonEngine(bands)


def test_ray_count_and_step_from_config(flat_engine):
    prof = flat_engine.horizon(0.0, 0.0)
    assert len(prof.az_deg) == int(round(360.0 / CFG["az_step_deg"])) == 1440
    assert prof.az_deg[0] == 0.0
    assert prof.az_deg[1] == pytest.approx(CFG["az_step_deg"])
    assert prof.eye_height_m == EYE


def test_flat_infinite_plane_equals_minus_curvature_dip(flat_engine):
    """Brief WS3: horizon on a flat infinite plane = -(curvature dip) within 0.01 deg."""
    prof = flat_engine.horizon(0.0, 0.0)
    dip_deg = math.degrees(math.acos(R / (R + EYE)))  # geometric dip of the horizon
    assert np.all(np.abs(prof.elevation_deg + dip_deg) < 0.01)
    # horizon distance sqrt(2 R h) ~ 3.4 km, within one 20 m sample step
    assert np.all(np.abs(prof.distance_m - math.sqrt(2 * R * EYE)) <= 20.0 + 1e-6)
    assert set(prof.source) == {"ctx_20m"}


def test_wall_100m_at_1km_from_1p7m_is_5p61_deg():
    """Brief WS3 / SPEC §9: a 100 m wall at 1 km seen from 1.7 m eye height = 5.61 deg."""
    assert EYE == 1.7
    nx, ny = 1101, 41
    z = np.zeros((ny, nx), dtype=np.float32)
    z[:, 1000:1021] = 100.0  # columns 1000..1020 -> x = 1000..1020 m
    eng = HorizonEngine([band_from_centers("dem_1m", z, 0.0, 20.0, 1.0)])
    prof = eng.horizon(0.0, 0.0)
    el = prof.elevation_deg[I_EAST]
    expected = math.degrees(math.atan((100.0 - EYE - curvature_drop(1000.0)) / 1000.0))
    assert el == pytest.approx(expected, abs=1e-6)
    assert round(el, 2) == 5.61
    assert prof.distance_m[I_EAST] == pytest.approx(1000.0)
    assert prof.source[I_EAST] == "dem_1m"


def test_curvature_inside_engine_wall_at_20km_reads_zero():
    """A wall eye height + curvature drop tall at 20 km sits at 0 deg; no data stays unknown."""
    res = 20.0
    xs = np.arange(0.0, 26_000.0 + res, res)
    z = np.zeros((3, xs.size), dtype=np.float32)
    z[:, xs >= 20_000.0] = EYE + curvature_drop(20_000.0)
    eng = HorizonEngine([band_from_centers("ctx_20m", z, 0.0, 20.0, res)])
    prof = eng.horizon(0.0, 0.0)
    assert prof.elevation_deg[I_EAST] == pytest.approx(0.0, abs=1e-4)
    assert prof.distance_m[I_EAST] == pytest.approx(20_000.0)
    assert math.isnan(prof.elevation_deg[I_WEST])  # west: no data -> NaN, not 0
    assert prof.source[I_WEST] is None


def test_sampling_steps_follow_config():
    """Samples every 1 m to 2 km, 20 m to 30 km, 200 m beyond (horizon.yaml sampling)."""
    eng = HorizonEngine([plane_band("mola_hrsc_200m", 1000.0, 200.0)])
    d0, d1, step, _ = eng._seg
    want = CFG["sampling"]
    assert [float(s["step_m"]) for s in want] == list(step)
    assert [float(s["to_m"]) for s in want] == list(d1)
    assert d0[0] == want[0]["step_m"]
    assert d0[1] == want[0]["to_m"] + want[1]["step_m"]


def test_nodata_in_fine_band_falls_back_to_coarser():
    fine = plane_band("dem_1m", 300.0, 1.0)
    fine.z[:, :] = np.nan
    coarse = plane_band("ctx_20m", 3_000.0, 20.0)
    eng = HorizonEngine([fine, coarse])
    prof = eng.horizon(0.0, 0.0, z_obs=EYE)
    assert set(prof.source) == {"ctx_20m"}
    assert CFG["band_fallback"]["value"] == "coarser"


def test_coarse_band_never_used_inside_finer_range_when_finer_has_data():
    """Inside 2 km the 1 m DEM wins over a coarser band that disagrees."""
    fine = plane_band("dem_1m", 2_100.0, 1.0, z=0.0)
    coarse = plane_band("ctx_20m", 5_000.0, 20.0, z=50.0)
    eng = HorizonEngine([fine, coarse])
    el, dist, src = eng.horizons([0.0], [0.0], z_obs=EYE, az_step_deg=90.0)
    # the coarse band (50 m higher) only enters beyond 2 km
    assert np.all(dist[0] > CFG["sampling"][0]["to_m"])
    assert np.all(src[0] == 1)


def test_azimuth_is_clockwise_from_grid_north():
    z = np.zeros((401, 401), dtype=np.float32)
    z[100, 300] = 500.0  # tower at x = +100, y = +100 (observer at the centre)
    prof = HorizonEngine([band_from_centers("dem_1m", z, -200.0, 200.0, 1.0)]).horizon(0.0, 0.0)
    assert prof.az_deg[int(np.nanargmax(prof.elevation_deg))] == pytest.approx(45.0)


def test_min_dist_and_coarse_step_for_f22():
    z = np.zeros((41, 1101), dtype=np.float32)
    z[:, 200:210] = 100.0  # near wall at 200 m
    eng = HorizonEngine([band_from_centers("dem_1m", z, 0.0, 20.0, 1.0)])
    near = eng.horizon(0.0, 0.0, az_step_deg=CFG["az_step_coarse_deg"])
    assert len(near.az_deg) == 360
    far = eng.horizon(0.0, 0.0, az_step_deg=CFG["az_step_coarse_deg"], min_dist_m=500.0)
    assert near.distance_m[90] == pytest.approx(200.0)
    assert far.distance_m[90] >= 500.0


def test_batch_horizons_match_single(flat_engine):
    xs = np.array([0.0, 50.0, -120.0])
    ys = np.array([0.0, 30.0, 75.0])
    el, dist, src = flat_engine.horizons(xs, ys, az_step_deg=1.0)
    assert el.shape == (3, 360)
    for k in range(3):
        p = flat_engine.horizon(xs[k], ys[k], az_step_deg=1.0)
        np.testing.assert_allclose(el[k], p.elevation_deg)
        np.testing.assert_allclose(dist[k], p.distance_m)


def test_observer_off_dem_is_unknown(flat_engine):
    prof = flat_engine.horizon(1e6, 1e6)
    assert np.all(np.isnan(prof.elevation_deg))


def test_profile_interpolation_and_distance_class():
    az = np.arange(0, 360, 90.0)
    prof = HorizonProfile(
        az_deg=az, elevation_deg=np.array([0.0, 1.0, 2.0, 3.0]),
        distance_m=np.array([100.0, 1000.0, 5000.0, 400.0]), source=["dem_1m"] * 4,
        observer={"x": 0.0, "y": 0.0, "z": 0.0}, eye_height_m=EYE, az_step_deg=90.0,
    )
    assert prof.elevation_at(45.0) == pytest.approx(0.5)
    assert prof.elevation_at(315.0) == pytest.approx(1.5)  # wraps 270 -> 360
    assert list(prof.distance_class()) == ["near", "mid", "far", "near"]
    assert list(prof.distance_class(np.array([np.nan]))) == ["unknown"]


def test_horizon_json_roundtrip_and_contract(tmp_path, flat_engine):
    from pipeline.horizon.contracts import validate

    prof = flat_engine.horizon(0.0, 0.0)
    path = prof.write_json(tmp_path / "S1.json", observer_id="S1")
    import json

    validate(json.loads(path.read_text()), "horizon.schema.json")
    back = HorizonProfile.read_json(path)
    np.testing.assert_allclose(back.elevation_deg, prof.elevation_deg, atol=1e-6)
    assert back.source == prof.source


def test_lonlat_to_xy_uses_analysis_crs():
    from pipeline.horizon.geo import lonlat_to_xy, xy_to_lonlat

    x, y = lonlat_to_xy(137.39, -4.8)
    assert abs(x) < 1e-6 and y == pytest.approx(-4.8 * math.pi / 180 * R, rel=1e-9)
    # 0.01 deg of longitude at lat_ts -4.8 = R cos(4.8 deg) * 0.01 deg
    x2, _ = lonlat_to_xy(137.40, -4.8)
    assert x2 == pytest.approx(R * math.cos(math.radians(4.8)) * math.radians(0.01), rel=1e-9)
    lon, lat = xy_to_lonlat(x2, y)
    assert lon == pytest.approx(137.40) and lat == pytest.approx(-4.8)
