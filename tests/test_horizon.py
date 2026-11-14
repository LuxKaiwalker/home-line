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


# --------------------------------------------------------------------------------------------
# Sky detector (F13 V2, reused by F22)
# --------------------------------------------------------------------------------------------

SKY = CFG["sky_detector_params"]


def test_sky_detector_rule_known_answer():
    """horizon.yaml sky_detector: first pixel where the vertical gradient > 3x the median gradient
    of the top 10% rows (rule as written: no border, no smoothing)."""
    from pipeline.horizon.sky import detect_skyline

    assert SKY["grad_ratio"] == 3.0 and SKY["ref_top_frac"] == 0.10  # same as the prose rule
    img = np.full((100, 4), 200, dtype=np.uint8)
    img[60:, 0] = 100          # column 0: sharp boundary between rows 59 and 60
    img[60:, 1] = 198          # column 1: 2-DN step < 3 x one-count guard -> no detection
    img[::2, 2] = 202          # column 2: noisy sky (median grad 2) ...
    img[70:, 2] = 150          # ... a step of ~50 at row 70 still fires
    det = detect_skyline(img, border_px=0, smooth_sigma_px=0)
    assert det.rows[0] == pytest.approx(59.5)
    assert math.isnan(det.rows[1])
    assert det.rows[2] == pytest.approx(69.5)
    assert math.isnan(det.rows[3])          # uniform sky: unknown, not a fake skyline
    assert det.ref_median[2] == pytest.approx(2.0)
    assert not det.in_ref_band.any()


def test_sky_detector_flags_skyline_inside_reference_band():
    from pipeline.horizon.sky import detect_skyline

    img = np.full((100, 1), 200, dtype=np.uint8)
    img[5:, 0] = 80
    det = detect_skyline(img, border_px=0, smooth_sigma_px=0)
    assert det.rows[0] == pytest.approx(4.5)
    assert det.in_ref_band[0]


def test_sky_detector_ignores_artefact_border():
    from pipeline.horizon.sky import detect_skyline

    b = SKY["border_px"]
    img = np.full((100, 20), 200, dtype=np.uint8)
    img[60:, :] = 100        # true boundary between rows 59 and 60
    img[0, :] = 254          # bright artefact row (as on the fresh Navcam JPEGs)
    img[:, 0] = 5            # dark artefact column
    raw = detect_skyline(img, border_px=0, smooth_sigma_px=0)
    assert raw.in_ref_band[1:].all()          # without the exclusion the artefact row fires
    det = detect_skyline(img, smooth_sigma_px=0)
    assert np.isnan(det.rows[:b]).all() and np.isnan(det.rows[-b:]).all()
    assert det.rows[b:-b] == pytest.approx(np.full(20 - 2 * b, 59.5))
    assert not det.in_ref_band.any()


def test_sky_detector_presmoothing_keeps_edge_position():
    from pipeline.horizon.sky import detect_skyline

    assert SKY["presmooth_sigma_px"] > 0
    rng = np.random.default_rng(3)
    img = np.clip(np.where(np.arange(200)[:, None] >= 120, 90.0, 180.0)
                  + rng.normal(0, 4.0, (200, 64)), 0, 255).astype(np.uint8)
    raw = detect_skyline(img, smooth_sigma_px=0)
    assert np.mean(np.abs(raw.rows - 119.5) <= 1.0) < 0.5   # the bare rule fires on noise
    det = detect_skyline(img)
    ok = np.isfinite(det.rows) & ~det.in_ref_band
    assert ok.mean() > 0.9
    assert np.all(np.abs(det.rows[ok] - 119.5) <= 1.0)   # no smoothing bias


# --------------------------------------------------------------------------------------------
# Far-field bands (bands.py)
# --------------------------------------------------------------------------------------------

def test_ctx_greedy_pick_known_answer():
    from shapely.geometry import box

    from pipeline.horizon.bands import pick_ctx_items

    def feat(i, x0, x1):
        return {"id": i, "geometry": {"type": "Polygon", "coordinates": [
            [[x0, -10], [x1, -10], [x1, 10], [x0, 10], [x0, -10]]]}}

    disc = box(0, -10, 10, 10)  # area 200 in "lon/lat" units with an identity transform
    feats = [feat("a", 0, 6), feat("b", 0, 5), feat("c", 5, 10), feat("d", 9, 10)]
    ident = lambda x, y: (x, y)  # noqa: E731
    got = pick_ctx_items(feats, disc, 3, 0.01, to_xy=ident)
    assert [g["id"] for g in got] == ["a", "c"]  # b and d add nothing after a + c
    assert got[0]["gain_pct"] == pytest.approx(60.0) and got[1]["cum_pct"] == pytest.approx(100)
    got = pick_ctx_items(feats, disc, 3, 0.01, to_xy=ident, exclude=["a"])
    assert [g["id"] for g in got] == ["b", "c"]


def test_band_target_grid_centred_on_pad():
    from pipeline.horizon.bands import _pad_xy, target_grid

    gt, w, h = target_grid(1000.0, 20.0)
    px, py = _pad_xy()
    assert w == h == 101
    assert gt[0] <= px - 1000 and gt[0] + w * gt[1] >= px + 1000
    assert gt[3] >= py + 1000 and gt[3] + h * gt[5] <= py - 1000
    assert gt[0] % 20 == 0 and gt[3] % 20 == 0


# --------------------------------------------------------------------------------------------
# Canonical bands (C decision 11:15), stations, pad, ring, landmarks, panorama, card fragments
# --------------------------------------------------------------------------------------------

def test_engine_reads_canonical_ws1_far_field_bands():
    """C decision (STATUS Decision log 11:15): the engine reads WS1's terrain/ bands."""
    from pipeline.horizon.bands import band_paths

    p = band_paths()
    assert p["ctx_20m"] == hcfg.REPO / "data/interim/terrain/ctx_20m.tif"
    assert p["mola_hrsc_200m"] == hcfg.REPO / "data/interim/terrain/mola_hrsc_200m.tif"
    assert p["dem_1m"] == hcfg.REPO / "data/interim/terrain/dem_1m.tif"


def test_station_observer_access_cell_rule():
    """User decision 11:40: the observer stands at the access cell when WS2 publishes it; until
    then the science coordinate, marked provisional."""
    from pipeline.horizon.cards import observer_from_station

    s = {"id": "S1", "lon": 137.39, "lat": -4.81}
    o = observer_from_station(s)
    assert (o["lon"], o["lat"]) == (137.39, -4.81)
    assert o["position"] == "science_coordinate" and o["provisional"] is True
    for acc in ({"access_lon": 137.3905, "access_lat": -4.8102},
                {"access": {"lon": 137.3905, "lat": -4.8102, "walk_in_m": 21.0}}):
        o = observer_from_station({**s, **acc})
        assert (o["lon"], o["lat"]) == (137.3905, -4.8102)
        assert o["position"] == "access_cell" and o["provisional"] is False
        assert (o["science_lon"], o["science_lat"]) == (137.39, -4.81)


def test_pad_observer_prefers_ws2_pad_then_ws1_grid(tmp_path):
    import json

    from pipeline.horizon.cards import pad_observer

    eng, ter = tmp_path / "engine", tmp_path / "terrain"
    eng.mkdir()
    ter.mkdir()
    pad = hcfg.site()["pad_default"]
    o = pad_observer(eng, ter)
    assert (o["lon"], o["lat"]) == (pad["lon"], pad["lat"]) and "site.yaml" in o["source"]
    (ter / "grid.json").write_text(json.dumps({"pad": {"lon": 137.383, "lat": -4.807}}))
    o = pad_observer(eng, ter)
    assert (o["lon"], o["lat"]) == (137.383, -4.807) and "grid.json" in o["source"]
    (eng / "pad.json").write_text(json.dumps({"pad": {"lon": 137.384, "lat": -4.808}}))
    o = pad_observer(eng, ter)
    assert (o["lon"], o["lat"]) == (137.384, -4.808) and "pad.json" in o["source"]


IAU_CSV = hcfg.REPO / "data/raw/discovery/iau_mars.csv"
# docs/discovery.md 3.5: (distance km, bearing deg) from pad_default, great circle on R 3,396.19 km
DISCOVERY_LANDMARKS = {
    "Gediz Vallis": (4.3, 131.5), "Yellowknife": (13.8, 14.3), "Sakarya Vallis": (17.7, 190.0),
    "Aeolis Palus": (20.3, 6.6), "Aeolis Mons": (31.9, 121.0), "Peace Vallis": (36.7, 345.6),
    "Gale": (41.8, 142.7), "Dulce Vallis": (49.8, 269.1),
}


@pytest.mark.skipif(not IAU_CSV.exists(), reason="IAU gazetteer CSV not cached (discovery 3.5)")
def test_iau_landmarks_within_80km_match_discovery_table():
    from pipeline.horizon.cards import load_iau_landmarks
    from pipeline.horizon.geo import great_circle

    pad = hcfg.site()["pad_default"]
    lms = load_iau_landmarks(IAU_CSV, pad["lon"], pad["lat"])
    assert {lm["name"] for lm in lms} == set(DISCOVERY_LANDMARKS)
    for lm in lms:
        b, d = great_circle(pad["lon"], pad["lat"], lm["lon"], lm["lat"])
        want_d, want_b = DISCOVERY_LANDMARKS[lm["name"]]
        assert round(d / 1000, 1) == pytest.approx(want_d, abs=0.051)
        assert round(b, 1) == pytest.approx(want_b, abs=0.051)


@pytest.fixture(scope="module")
def cone_engine():
    """Flat plane (z 0) to 82 km with a 1,000 m cone (radius 5 km) whose apex is 30 km north."""
    res = 200.0
    n = int(round(2 * 82_000.0 / res)) + 1
    c = (np.arange(n) * res) - 82_000.0
    xx, yy = np.meshgrid(c, -c)
    r = np.hypot(xx, yy - 30_000.0)
    z = np.clip(1000.0 * (1.0 - r / 5000.0), 0.0, None)
    return HorizonEngine([band_from_centers("mola_hrsc_200m", z, -82_000.0, 82_000.0, res)])


def test_landmark_on_skyline_peak_is_visible_and_behind_it_is_hidden(cone_engine):
    from pipeline.horizon.cards import landmark_view

    prof = cone_engine.horizon(0.0, 0.0)
    obs = {"x": 0.0, "y": 0.0, "z": prof.observer["z"]}
    apex = landmark_view(obs, {"name": "apex", "x": 0.0, "y": 30_000.0}, cone_engine, prof)
    assert apex["bearing_deg"] == pytest.approx(0.0, abs=1e-6)
    assert apex["dist_km"] == pytest.approx(30.0)
    want = math.degrees(math.atan((1000.0 - EYE - curvature_drop(30_000.0)) / 30_000.0))
    assert apex["el_deg"] == pytest.approx(want, abs=1e-3)
    assert apex["above_skyline"] is True
    behind = landmark_view(obs, {"name": "behind", "x": 0.0, "y": 50_000.0}, cone_engine, prof)
    assert behind["above_skyline"] is False
    side = landmark_view(obs, {"name": "east", "x": 10_000.0, "y": 0.0}, cone_engine, prof)
    assert side["bearing_deg"] == pytest.approx(90.0)


def test_landmark_pick_rule():
    """landmarks.yaml rule: 3-6 landmarks that rise above the skyline or are within 5 km;
    drop_if: below the skyline and > 5 km. Fewer than 3 qualifying are reported, not padded."""
    from pipeline.horizon.cards import pick_landmarks

    rule = CFG["landmark_rule"]
    assert (rule["min_n"], rule["max_n"], rule["near_km"]) == (3, 6, 5)

    def v(name, d, above):
        return {"name": name, "bearing_deg": 10.0, "dist_km": d, "above_skyline": above}

    views = [v("far_hidden", 40, False), v("near_hidden", 4.9, False), v("far_up", 30, True),
             v("mid_up", 12, True)] + [v(f"up{i}", 20 + i, True) for i in range(5)]
    picked, note = pick_landmarks(views)
    names = [p["name"] for p in picked]
    assert len(picked) == 6 and "far_hidden" not in names and names[0] == "near_hidden"
    assert names == sorted(names, key=lambda n: next(x["dist_km"] for x in views
                                                     if x["name"] == n))
    picked, note = pick_landmarks([v("a", 40, False), v("b", 2, False)])
    assert [p["name"] for p in picked] == ["b"] and "fewer than 3" in note


def test_panorama_rows_follow_profile_and_landmark_tick():
    from pipeline.horizon.cards import pano_xy, render_panorama

    az = np.arange(1440) * 0.25
    el = 2.0 + np.sin(np.radians(az))
    prof = HorizonProfile(az, el, np.full(az.size, 10_000.0), ["ctx_20m"] * az.size,
                          {"x": 0, "y": 0, "z": 0}, EYE, 0.25)
    img, meta = render_panorama(prof, [{"name": "Peak", "bearing_deg": 90.0, "dist_km": 10.0,
                                        "el_deg": 3.0}])
    pc = CFG["panorama"]
    a = np.asarray(img.convert("RGB")).astype(int)
    assert a.shape[1] == int(round(360 * pc["px_per_deg"]))
    for az_q in (0.0, 90.0, 270.0):
        x, y_want = pano_xy(meta, az_q, 2.0 + math.sin(math.radians(az_q)))
        col = a[:, int(round(x))]
        ground = np.nonzero(np.all(col == pc["ground_rgb"], axis=1))[0]
        assert abs(ground[0] - y_want) <= 2.0          # first ground pixel under the line
    x, y = pano_xy(meta, 90.0, 3.0)
    assert tuple(a[int(round(y)) - 4, int(round(x))]) == tuple(pc["tick_rgb"])


def test_horizon_ring_beyond_min_range_and_consistent_points(cone_engine):
    from pipeline.horizon.cards import ring_doc

    obs = {"id": "pad", "lon": 137.0, "lat": -4.8, "x": 0.0, "y": 0.0}
    doc = ring_doc(cone_engine, obs, min_range_m=3700.0)
    n = int(round(360 / CFG["az_step_deg"]))
    assert len(doc["az_deg"]) == len(doc["elev_deg"]) == len(doc["dist_m"]) == n
    d = np.array(doc["dist_m"], dtype=float)
    assert np.nanmin(d) >= 3700.0
    assert doc["dist_m"][0] == pytest.approx(30_000.0, abs=200.0)      # cone apex due north
    assert doc["z_m"][0] == pytest.approx(1000.0, abs=1.0)
    south = n // 2
    assert doc["z_m"][south] == pytest.approx(0.0, abs=0.05)        # flat plane behind
    e, nn = doc["east_m"][n // 4], doc["north_m"][n // 4]
    assert e == pytest.approx(doc["dist_m"][n // 4], abs=0.5) and abs(nn) < 0.5
    from pipeline.horizon.contracts import validate

    validate(doc, "horizon_ring.schema.json")


def test_nearest_suitable_frame_skips_failed_and_manual_rejects():
    from pipeline.horizon.cards import nearest_suitable_frame

    frames = [{"image_id": "A", "x": 10.0, "y": 0.0}, {"image_id": "B", "x": 20.0, "y": 0.0},
              {"image_id": "C", "x": 30.0, "y": 0.0}, {"image_id": "D", "x": 40.0, "y": 0.0}]
    v2 = {"A": {"status": "failed"}, "B": {"status": "ok", "manual_ok": False},
          "C": {"status": "ok", "manual_ok": None}, "D": {"status": "ok", "manual_ok": True}}
    f, dist = nearest_suitable_frame((0.0, 0.0), frames, v2)
    assert f["image_id"] == "C" and dist == pytest.approx(30.0)
    assert nearest_suitable_frame((0.0, 0.0), frames[:2], v2) == (None, None)


def test_card_fragment_validates_against_card_contract_fields():
    from pipeline.horizon.cards import FRAGMENT_FIELDS, card_fragment
    from pipeline.horizon.contracts import validate

    frag = card_fragment(
        "S1", observer={"id": "S1", "position": "science_coordinate", "provisional": True},
        frame={"image_id": "NLB_X", "sol": 4834, "stop_id": "v121_0"}, frame_dist_m=522.0,
        frame_errors={"near": 0.1, "mid": None, "far": 4.2},
        landmarks=[{"name": "Gale", "bearing_deg": 142.7, "dist_km": 41.8, "el_deg": 1.0,
                    "above_skyline": True}], landmarks_note=None)
    validate(frag, "card.schema.json", properties=FRAGMENT_FIELDS)
    assert set(FRAGMENT_FIELDS) == {"navcam", "skyline_error_deg", "panorama_png", "landmarks"}
    assert frag["navcam"]["url_local"] == "cards/S1/navcam.png"
    assert frag["navcam"]["overlay_png"] == "cards/S1/overlay.png"
    assert frag["panorama_png"] == "cards/S1/panorama.png"
    assert frag["provisional"] is True
    none = card_fragment("S2", observer={"id": "S2", "provisional": False}, frame=None,
                         frame_dist_m=None, frame_errors=None, landmarks=[], landmarks_note="x")
    validate(none, "card.schema.json", properties=FRAGMENT_FIELDS)
    assert none["navcam"] == {"sol": None, "image_id": None, "url_local": None,
                              "overlay_png": None}
    assert none["skyline_error_deg"] == {"near": None, "mid": None, "far": None}
