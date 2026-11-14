"""WS3 camera KATs (SPEC §2.2 F12, §9; brief WS3 "Tests"): CAHV/CAHVOR/CAHVORE projection and the
site <-> rover attitude chain on synthetic cameras; the real-frame KATs (A-vector azimuth and rover
yaw within 1 deg of the image label on 3 frames) run on raw-image API records fetched after H0
(see the "Real frames" section).
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from pipeline.horizon import config as hcfg
from pipeline.horizon.cahvor import (
    CameraModel,
    cahv_from_intrinsics,
    enu_to_site,
    matrix_to_ypr,
    parse_cmod_string,
    pointing_az_el,
    quat_to_matrix,
    site_to_enu,
    ypr_to_quat,
)

CFG = hcfg.load()

# A Navcam-like synthetic camera (1024 x 1024, 45 deg FOV) in the rover frame
# (MSL rover frame: +X forward, +Y right, +Z down).
W = H_IMG = 1024
F = 512.0 / math.tan(math.radians(22.5))
CX = CY = 511.5
C0 = np.array([0.8, 0.5, -1.9])


def rot_y(deg):  # pitch about the rover +Y axis (nose up positive in NED-like frames)
    a = math.radians(deg)
    return np.array([[math.cos(a), 0, math.sin(a)], [0, 1, 0], [-math.sin(a), 0, math.cos(a)]])


def base_cahv(pitch_deg=0.0):
    rot = rot_y(pitch_deg)
    a = rot @ np.array([1.0, 0, 0])
    h = rot @ np.array([0, 1.0, 0])   # image right = rover right
    v = rot @ np.array([0, 0, 1.0])   # image down = rover down
    return cahv_from_intrinsics(C0, a, h, v, F, F, CX, CY)


def cahvor(pitch_deg=-10.0, r=(1e-3, -0.08, 0.02)):
    m = base_cahv(pitch_deg)
    o = rot_y(0.5) @ m.A  # optical axis 0.5 deg off the pointing axis
    return CameraModel("CAHVOR", m.C, m.A, m.H, m.V, O=o / np.linalg.norm(o), R=np.array(r))


def grid_pixels(step=64):
    xs, ys = np.meshgrid(np.arange(0, W, step, dtype=float), np.arange(0, H_IMG, step, dtype=float))
    return np.column_stack([xs.ravel(), ys.ravel()])


# --------------------------------------------------------------------------------------------
# Projection KATs
# --------------------------------------------------------------------------------------------

def test_cahv_matches_pinhole_formula():
    m = base_cahv(0.0)
    p = np.array([[10.0, 2.0, -1.0], [5.0, -1.0, 0.3]])
    px = m.project(C0 + p)
    np.testing.assert_allclose(px[:, 0], CX + F * p[:, 1] / p[:, 0], atol=1e-9)
    np.testing.assert_allclose(px[:, 1], CY + F * p[:, 2] / p[:, 0], atol=1e-9)


def test_cahvor_radial_term_known_answer():
    # With O = A, a point at angle t off-axis lands at radius f t (1 + r0 + r1 t^2 + r2 t^4).
    r = np.array([1e-3, -0.08, 0.02])
    m0 = base_cahv(0.0)
    m = CameraModel("CAHVOR", m0.C, m0.A, m0.H, m0.V, O=m0.A.copy(), R=r)
    t = 0.3
    px = m.project(C0 + np.array([[1.0, t, 0.0]]))[0]
    mu = r[0] + r[1] * t**2 + r[2] * t**4
    assert px[0] - CX == pytest.approx(F * t * (1 + mu), abs=1e-9)
    assert px[1] == pytest.approx(CY, abs=1e-9)


def test_cahvor_round_trip_under_half_pixel():
    m = cahvor()
    px = grid_pixels()
    origin, d = m.unproject(px)
    back = m.project(origin + 30.0 * d)
    err = np.hypot(*(back - px).T)
    assert err.max() < 0.5
    assert err.max() < 1e-6  # in practice it is exact to numerical precision


def test_cahvor_point_round_trip_rays_hit_points():
    m = cahvor()
    rng = np.random.default_rng(0)
    pts = m.C + np.column_stack([rng.uniform(5, 50, 200), rng.uniform(-8, 8, 200),
                                 rng.uniform(-6, 6, 200)])
    px = m.project(pts)
    origin, d = m.unproject(px)
    v = pts - origin
    cosang = np.sum(v * d, axis=1) / np.linalg.norm(v, axis=1)
    assert np.all(cosang > math.cos(1e-7))


def test_points_behind_camera_are_nan():
    m = cahvor()
    px = m.project(np.array([m.C - 10.0 * m.A]))
    assert np.all(np.isnan(px))


def test_cahvore_perspective_without_entrance_shift_equals_cahvor():
    m = cahvor()
    e = CameraModel("CAHVORE", m.C, m.A, m.H, m.V, O=m.O, R=m.R, E=np.zeros(3), linearity=1.0)
    pts = m.C + np.array([[10.0, 2.0, -1.0], [5.0, -2.0, 1.5], [20.0, 0.0, 0.0]])
    np.testing.assert_allclose(e.project(pts), m.project(pts), atol=1e-6)


def test_cahvore_fisheye_equidistant_known_answer():
    # L = 0, E = 0, R = 0, O = A: radius = f * theta (equidistant fisheye).
    m0 = base_cahv(0.0)
    e = CameraModel("CAHVORE", m0.C, m0.A, m0.H, m0.V, O=m0.A.copy(), R=np.zeros(3),
                    E=np.zeros(3), linearity=0.0)
    theta = math.radians(40.0)
    px = e.project(C0 + np.array([[math.cos(theta), math.sin(theta), 0.0]]))[0]
    assert px[0] - CX == pytest.approx(F * theta, abs=1e-6)


@pytest.mark.parametrize("linearity", [1.0, 0.5, 0.0, -0.3])
def test_cahvore_round_trip_under_half_pixel(linearity):
    m = cahvor()
    e = CameraModel("CAHVORE", m.C, m.A, m.H, m.V, O=m.O, R=np.array([0.0, -0.02, 0.003]),
                    E=np.array([0.002, 0.01, -0.004]), linearity=linearity)
    px = grid_pixels()
    origin, d = e.unproject(px)
    back = e.project(origin + 25.0 * d)
    assert np.nanmax(np.hypot(*(back - px).T)) < 0.5


def test_parse_cmod_string():
    s = "(1.0,2.0,3.0);(0,0,1);(100,0,500);(0,100,500);(0,0,1);(0.1,0.2,0.3)"
    m = parse_cmod_string(s)
    assert m.kind == "CAHVOR"
    np.testing.assert_allclose(m.C, [1, 2, 3])
    np.testing.assert_allclose(m.R, [0.1, 0.2, 0.3])
    assert parse_cmod_string(";".join(s.split(";")[:4])).kind == "CAHV"


def test_intrinsics_recovered_from_cahv():
    m = base_cahv(-7.0)
    k = m.intrinsics()
    assert k["fx"] == pytest.approx(F)
    assert k["cx"] == pytest.approx(CX)
    assert k["cy"] == pytest.approx(CY)


# --------------------------------------------------------------------------------------------
# Attitude chain
# --------------------------------------------------------------------------------------------

def test_quaternion_identity_and_yaw():
    np.testing.assert_allclose(quat_to_matrix([1, 0, 0, 0]), np.eye(3), atol=1e-12)
    rm = quat_to_matrix(ypr_to_quat(30.0, 0.0, 0.0))
    np.testing.assert_allclose(rm @ [1, 0, 0], [math.cos(math.radians(30)),
                                                 math.sin(math.radians(30)), 0], atol=1e-12)


@pytest.mark.parametrize("ypr", [(30.0, 0.0, 0.0), (-150.0, 4.0, -3.0), (271.0, -12.0, 8.0)])
def test_ypr_round_trip(ypr):
    y, p, r = matrix_to_ypr(quat_to_matrix(ypr_to_quat(*ypr)))
    assert (y - ypr[0]) % 360.0 == pytest.approx(0.0, abs=1e-9) or \
        (y - ypr[0]) % 360.0 == pytest.approx(360.0, abs=1e-9)
    assert p == pytest.approx(ypr[1], abs=1e-9)
    assert r == pytest.approx(ypr[2], abs=1e-9)


def test_pointing_azimuth_follows_yaw_and_pitch():
    az, el = pointing_az_el(np.array([1.0, 0, 0]), ypr_to_quat(30.0, 5.0, 0.0))
    assert az == pytest.approx(30.0)
    assert el == pytest.approx(5.0)
    az, el = pointing_az_el(base_cahv(-10.0).A, ypr_to_quat(200.0, 0.0, 0.0))
    assert az == pytest.approx(200.0)
    assert el == pytest.approx(-10.0)


def test_enu_site_round_trip():
    v = np.array([[1.0, 2.0, 3.0]])
    np.testing.assert_allclose(enu_to_site(v), [[2.0, 1.0, -3.0]])
    np.testing.assert_allclose(site_to_enu(enu_to_site(v)), v)


def test_attitude_chain_round_trip_site_az_el_to_pixels_and_back():
    """Site-frame (az, el) -> rover frame -> CAHVOR pixel -> back to (az, el), tilted rover."""
    from pipeline.horizon.cahvor import pixels_to_az_el, project_az_el

    m = cahvor(pitch_deg=-5.0)
    q = ypr_to_quat(123.0, 7.0, -4.0)
    px = grid_pixels(128)
    az, el = pixels_to_az_el(m, q, px)
    back = project_az_el(m, q, az, el, 1e7)  # far points: the camera offset is negligible
    assert np.nanmax(np.hypot(*(back - px).T)) < 0.5


# --------------------------------------------------------------------------------------------
# Real frames (brief WS3: A-vector azimuth and rover yaw within 1 deg of the label on 3 frames)
# --------------------------------------------------------------------------------------------

# Three NAV_LEFT_B full frames from two drive ends, as returned by the raw-image API after H0
# (WS3 query of sol 4200 at 2026-11-14 ~10:10Z; sol 5073 from D0's raw response
# data/raw/discovery/rawapi_msl_sol5073_NAV_LEFT_B.json). Fields as in docs/discovery.md §3.3.
# Rover yaw/pitch/roll labels: MMGIS MSL_waypoints.json (D0 copy) for the same RMC.
REAL_ITEMS = [
    {"imageid": "NLB_770343787EDR_F1072484NCAM00255M_", "instrument": "NAV_LEFT_B", "sol": 4200,
     "site": 107, "drive": 2484, "camera_model_type": "CAHVOR",
     "camera_model_component_list":
         "(0.852289,0.319831,-1.88711);(0.861523,-0.272506,0.42837);(806.22,1029.51,217.423);"
         "(-67.7024,21.1742,1321.88);(0.861522,-0.272508,0.428371);(0.0,0.00011478,0.00639642)",
     "attitude": "(0.117987,0.110838,-0.0566556,-0.985182)", "subframe_rect": "(1,1,1024,1024)",
     "scale_factor": 1,
     "camera_vector": "(0.8594041342558667,-0.267705945464948,0.4356122826397835)",
     "xyz": "(-104.508,25.6997,-13.481)", "date_taken": "2024-05-30T13:23:48.000Z",
     "https_url": "https://mars.nasa.gov/msl-raw-images/proj/msl/redops/ods/surface/sol/04200/"
                  "opgs/edr/ncam/NLB_770343787EDR_F1072484NCAM00255M_.JPG",
     "extended": {"lmst": "Sol-04200M12:06:44.820", "mast_az": "342.672", "mast_el": "-25.801",
                  "sample_type": "full"}},
    {"imageid": "NLB_770345556EDR_F1072484NCAM00256M_", "instrument": "NAV_LEFT_B", "sol": 4200,
     "site": 107, "drive": 2484, "camera_model_type": "CAHVOR",
     "camera_model_component_list":
         "(0.560687,0.53582,-1.89878);(-0.376355,-0.862424,0.338476);(931.702,-927.043,172.534);"
         "(-24.0018,-52.6588,1322.48);(-0.376357,-0.862423,0.338476);(0.0,0.000112331,0.00639928)",
     "attitude": "(0.117987,0.110838,-0.0566556,-0.985182)", "subframe_rect": "(1,1,1024,1024)",
     "scale_factor": 1,
     "camera_vector": "(-0.37170472721888237,-0.8614290484531315,0.34608610235643483)",
     "xyz": "(-104.508,25.6997,-13.481)", "date_taken": "2024-05-30T13:53:17.000Z",
     "https_url": "https://mars.nasa.gov/msl-raw-images/proj/msl/redops/ods/surface/sol/04200/"
                  "opgs/edr/ncam/NLB_770345556EDR_F1072484NCAM00256M_.JPG",
     "extended": {"lmst": "Sol-04200M12:35:26.384", "mast_az": "246.635", "mast_el": "-20.2247",
                  "sample_type": "full"}},
    {"imageid": "NLB_847852920EDR_F1252490NCAM00282M_", "instrument": "NAV_LEFT_B", "sol": 5073,
     "site": 125, "drive": 2490, "camera_model_type": "CAHVOR",
     "camera_model_component_list":
         "(0.781275,0.802092,-1.93076);(-0.917103,0.391826,0.0733355);(-946.226,-927.548,36.1975);"
         "(-378.439,160.669,1258.38);(-0.917102,0.391828,0.073336);(0.0,0.000119405,0.00639103)",
     "attitude": "(0.0692464,0.105055,-0.0267776,-0.991691)", "subframe_rect": "(1,1,1024,1024)",
     "scale_factor": 1,
     "camera_vector": "(-0.9181436763864114,0.3878351267392882,0.08121640215353779)",
     "xyz": "(-82.2708,45.3949,-14.604)", "date_taken": "2026-11-13T15:55:03.000Z",
     "https_url": "https://mars.nasa.gov/msl-raw-images/proj/msl/redops/ods/surface/sol/05073/"
                  "opgs/edr/ncam/NLB_847852920EDR_F1252490NCAM00282M_.JPG",
     "extended": {"lmst": "Sol-05073M14:34:08.418", "mast_az": "157.077", "mast_el": "-4.63516",
                  "sample_type": "full"}},
]
MMGIS_YPR = {"107_2484": (-165.5, 11.83, 8.09), "125_2490": (-171.6, 11.81, 3.96)}
KAT_TOL_DEG = 1.0  # brief WS3 "Tests": within 1 deg of the image label


def _angdiff(a, b):
    return abs((a - b + 180.0) % 360.0 - 180.0)


def _check_label(rec, mmgis_ypr):
    from pipeline.horizon.navcam import a_vector_rover_az_el, rover_ypr

    a_az, a_el = a_vector_rover_az_el(rec)
    assert _angdiff(a_az, rec["mast_az_deg"]) < KAT_TOL_DEG, rec["image_id"]
    assert abs(a_el - rec["mast_el_deg"]) < KAT_TOL_DEG, rec["image_id"]
    yaw, pitch, roll = rover_ypr(rec)
    assert _angdiff(yaw, mmgis_ypr[0]) < KAT_TOL_DEG, rec["image_id"]
    assert abs(pitch - mmgis_ypr[1]) < KAT_TOL_DEG, rec["image_id"]
    assert abs(roll - mmgis_ypr[2]) < KAT_TOL_DEG, rec["image_id"]


def test_a_vector_azimuth_and_yaw_match_label_on_3_real_frames():
    from pipeline.horizon.navcam import parse_item

    for it in REAL_ITEMS:
        rec = parse_item(it)
        _check_label(rec, MMGIS_YPR[f"{rec['site']}_{rec['drive']}"])


def test_navcam_c_height_on_real_frames_within_discovery_range():
    """Navcam C-vector height above the rover-frame origin (discovery §3.4 range)."""
    from pipeline.horizon.navcam import camera_offset_site, parse_item

    rng = CFG["navcam_api"]["c_height_above_rover_origin_m"]
    for it in REAL_ITEMS:
        h = -camera_offset_site(parse_item(it))[2]
        assert rng["min"] <= h <= rng["max"], it["imageid"]


def test_a_vector_and_yaw_on_3_cached_frames_from_different_stops():
    import json

    path = hcfg.REPO / "data" / "interim" / "horizon" / "navcam_frames.json"
    if not path.exists():
        pytest.skip("navcam cache not present (pipeline host only)")
    frames = json.loads(path.read_text())["frames"]
    by_stop = {}
    for f in frames:
        by_stop.setdefault(f["rmc"], f)
    picks = [by_stop[k] for k in sorted(by_stop)[:3]]
    assert len(picks) == 3
    for f in picks:
        _check_label(f, f["mmgis_yaw_pitch_roll_deg"])


# --------------------------------------------------------------------------------------------
# Raw-image API parsing and frame selection (navcam.py)
# --------------------------------------------------------------------------------------------

def test_parse_item_fields_and_conventions():
    from pipeline.horizon.navcam import parse_item, parse_lmst

    rec = parse_item(REAL_ITEMS[0])
    assert rec["camera_model"]["type"] == "CAHVOR"
    assert rec["camera_model"]["C"] == [0.852289, 0.319831, -1.88711]
    assert rec["attitude_quaternion"][0] == pytest.approx(0.117987)  # w first (discovery §3.3a)
    assert (rec["width"], rec["height"]) == (1024, 1024)
    assert rec["utc"] == "2024-05-30T13:23:48.000Z"
    lm = parse_lmst(rec["lmst"])
    assert lm["sol"] == 4200
    assert lm["hours"] == pytest.approx(12 + 6 / 60 + 44.820 / 3600)
    assert parse_lmst("12:00") is None


def test_parse_item_downsampled_size_and_strict_numbers():
    from pipeline.horizon.navcam import parse_item, parse_tuple, strip_key

    it = dict(REAL_ITEMS[0], scale_factor=4)
    assert (parse_item(it)["width"], parse_item(it)["height"]) == (256, 256)
    with pytest.raises(ValueError):
        parse_tuple("(1.0,2.0);import os")
    bad = dict(REAL_ITEMS[0])
    bad["camera_model_component_list"] = ";".join(bad["camera_model_component_list"]
                                                  .split(";")[:5])
    with pytest.raises(ValueError):
        parse_item(bad)
    with pytest.raises(ValueError):
        parse_item(dict(REAL_ITEMS[0], https_url="https://evil.example/x.JPG"))
    assert "SECRET" not in strip_key("https://api.nasa.gov/x?a=1&api_key=SECRET&b=2")
    assert "SECRET" not in strip_key("https://api.nasa.gov/x?a=1&API_KEY=SECRET")


def test_sky_geometry_known_answer_on_synthetic_camera():
    from pipeline.horizon.navcam import sky_geometry, sky_test

    m = base_cahv(-10.0)  # boresight 10 deg below level, rover level and facing north
    rec = {"camera_model": {"type": "CAHV", "C": m.C.tolist(), "A": m.A.tolist(),
                            "H": m.H.tolist(), "V": m.V.tolist()},
           "attitude_quaternion": [1.0, 0.0, 0.0, 0.0], "width": W, "height": H_IMG,
           "subframe": [1, 1, W, H_IMG]}
    g = sky_geometry(rec)
    half = math.degrees(math.atan(CY / F))
    assert g["el_centre_deg"] == pytest.approx(-10.0, abs=0.01)
    assert g["el_top_deg"] == pytest.approx(-10.0 + half, abs=0.01)
    assert g["el_bottom_deg"] == pytest.approx(-10.0 - half, abs=0.01)
    assert g["az_centre_deg"] == pytest.approx(0.0, abs=1e-6)
    sel = CFG["navcam_selection"]
    ok, _, _ = sky_test(rec, sel)
    assert ok == (g["el_top_deg"] >= sel["top_row_min_el_deg"]
                  and g["el_bottom_deg"] <= sel["bottom_row_max_el_deg"])
    ok, why, _ = sky_test({**rec, "subframe": [257, 1, 512, 512]}, sel)
    assert not ok and "unverified" in why


def test_spread_pick_takes_widest_azimuth_spread():
    from pipeline.horizon.navcam import spread_pick

    cands = [{"image_id": f"f{az}", "geometry": {"az_centre_deg": float(az),
                                                 "el_top_deg": 20.0 if az == 10 else 15.0}}
             for az in (0, 10, 20, 100, 190, 200, 280)]
    got = [c["image_id"] for c in spread_pick(cands, 4)]
    assert got[0] == "f10" and got[1] == "f190"
    assert set(got[2:]) == {"f100", "f280"}
    assert spread_pick([], 4) == []


def test_order_stops_station_first_by_sol_rule_and_spacing():
    from pipeline.horizon.geo import lonlat_to_xy
    from pipeline.horizon.navcam import nearest_sol_rmc, order_stops

    des = [{"rmc": f"1_{i}", "site": 1, "drive": i, "sol": 100 + i // 2,
            "lon": 137.39 + 1e-4 * i, "lat": -4.8} for i in range(10)]  # ~5.9 m apart
    assert nearest_sol_rmc(des, 103) == "1_7"  # two drive ends on sol 103: the last one
    order = order_stops(des, [{"station": "S4", "nearest_sol": 101}], 20.0)
    assert order[0]["rmc"] == "1_3" and order[0]["station"] == "S4"
    assert order[1]["rmc"] == "1_9"  # farthest from 1_3
    assert len(order) == len({o["rmc"] for o in order})
    xy = [lonlat_to_xy(o["lon"], o["lat"]) for o in order]
    for i in range(len(xy)):
        for j in range(i):
            assert math.dist(xy[i], xy[j]) >= 20.0


def test_s4_first_stop_is_the_discovery_drive_end():
    """stations.yaml S4 rule on MMGIS -> 107_2484 (docs/discovery.md §3.2)."""
    from pipeline.horizon.navcam import WAYPOINTS_D0, load_drive_ends, nearest_sol_rmc

    if not WAYPOINTS_D0.exists():
        pytest.skip("D0 MMGIS copy not present (pipeline host only)")
    s4 = CFG["navcam_selection"]["first_stops"][0]
    assert s4["station"] == "S4"
    assert nearest_sol_rmc(load_drive_ends(), s4["nearest_sol"]) == "107_2484"
