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
