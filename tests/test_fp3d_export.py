"""Known-answer tests for the WS8 3D exporters (F20; contracts/README.md "3D files").

pipeline/export/terrain_chunks.py, far_mesh.py, ortho_chunks.py turn the WS1 1 m DEM and the
HiRISE ortho into web/public/data/fp3d/. Synthetic rasters only; every file goes to tmp_path.

The binary layout must stay identical to the M0 dummy (tools/make_dummy.py) that the web view is
built against, so several tests decode the committed dummy files and compare them with the dummy's
analytic surface at the pixel centres this module computes (grid alignment KAT).
"""

from __future__ import annotations

import gzip
import importlib.util
import io
import json
import struct
import sys
from pathlib import Path

import numpy as np
import pytest
from affine import Affine
from PIL import Image

from pipeline.export import far_mesh, ortho_chunks, terrain_chunks
from pipeline.export.terrain_chunks import (
    ChunkGrid,
    Geo,
    corridor_chunks,
    decode_heights,
    encode_heights,
    fill_nodata,
    pad_centred_grid,
    sample_bilinear,
)

REPO = Path(__file__).resolve().parent.parent
DUMMY = REPO / "web" / "public" / "data-dummy"
FP3D_CFG = terrain_chunks.load_config()["fp3d"]
SITE = terrain_chunks.load_config()["site"]
Q = FP3D_CFG["height"]["quantum_m"]


def _load_make_dummy():
    name = "make_dummy_for_fp3d_tests"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, REPO / "tools" / "make_dummy.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def dummy_index() -> dict:
    return json.loads((DUMMY / "fp3d" / "index.json").read_text())


@pytest.fixture(scope="module")
def geo() -> Geo:
    return Geo(SITE)


@pytest.fixture(scope="module")
def dummy_grid(geo) -> ChunkGrid:
    return pad_centred_grid(geo.pad_xy, SITE["planning_radius_m"],
                            FP3D_CFG["near"]["chunk_px"], FP3D_CFG["near"]["res_m"])


# ------------------------------------------------------------------------- chunk grid ----
def test_pad_centred_grid_matches_dummy_index(dummy_grid, dummy_index):
    """Same grid as the dummy: 29 x 29 chunks of 256 m, NW corner at origin_xy_m."""
    g = dummy_index["chunk_grid"]
    assert [dummy_grid.n, dummy_grid.n] == [g["cols"], g["rows"]] == [29, 29]
    assert dummy_grid.chunk_px == g["chunk_px"]
    assert dummy_grid.res_m == g["res_m"]
    assert round(dummy_grid.x0, 2) == pytest.approx(g["origin_xy_m"][0], abs=0.006)
    assert round(dummy_grid.y0, 2) == pytest.approx(g["origin_xy_m"][1], abs=0.006)
    assert g["crs"] == SITE["crs"]["analysis_proj"]


def test_grid_pad_is_centre_of_middle_chunk(dummy_grid, geo):
    mid = dummy_grid.n // 2
    w, s, e, n = dummy_grid.chunk_bounds_xy(mid, mid)
    assert (w + e) / 2 == pytest.approx(geo.pad_xy[0], abs=1e-6)
    assert (s + n) / 2 == pytest.approx(geo.pad_xy[1], abs=1e-6)
    assert dummy_grid.chunk_of(*geo.pad_xy) == (mid, mid)


def test_chunk_bounds_and_pixel_centres():
    g = ChunkGrid(x0=1000.0, y0=5000.0, chunk_px=4, res_m=2.0, n=3)
    assert g.size_m == 8.0
    assert g.chunk_bounds_xy(1, 2) == (1008.0, 4976.0, 1016.0, 4984.0)
    xs, ys = g.pixel_centres(1, 2)
    np.testing.assert_array_equal(xs, [1009.0, 1011.0, 1013.0, 1015.0])
    np.testing.assert_array_equal(ys, [4983.0, 4981.0, 4979.0, 4977.0])  # row 0 = north
    assert g.chunk_of(1008.0, 4984.0) == (1, 2)
    assert g.chunk_of(1015.99, 4976.01) == (1, 2)
    assert g.chunk_of(999.0, 4990.0) is None


def test_chunk_bounds_lonlat_match_dummy(dummy_grid, dummy_index, geo):
    for ch in dummy_index["chunk_grid"]["chunks"][:5]:
        assert dummy_grid.chunk_bounds_lonlat(ch["i"], ch["j"], geo) == pytest.approx(
            ch["bounds"], abs=1.5e-6)


# ---------------------------------------------------------------------- encode/decode ----
def test_encode_layout_little_endian_row0_north():
    h = np.array([[1.5, 2.0], [-3.25, 4.0]], dtype=np.float64)  # row 0 = north
    raw = gzip.decompress(encode_heights(h, Q))
    assert len(raw) == 4 * 4
    assert struct.unpack("<4f", raw) == (1.5, 2.0, -3.25, 4.0)


def test_encode_decode_round_trip_within_quantum():
    rng = np.random.default_rng(20261114)
    h = rng.normal(-4000.0, 50.0, size=(256, 256))
    back = decode_heights(encode_heights(h, Q), (256, 256))
    assert back.dtype == np.float32
    assert np.abs(back - h).max() <= Q / 2 + 1e-3 * Q + np.spacing(np.float32(4200.0))
    # quantised values survive float32 exactly
    hq = np.round(h / Q) * Q
    np.testing.assert_array_equal(back, hq.astype(np.float32))


def test_encode_is_deterministic():
    h = np.arange(16, dtype=float).reshape(4, 4)
    assert encode_heights(h, Q) == encode_heights(h, Q)  # gzip mtime fixed


def test_encode_refuses_nan_and_bad_shape():
    with pytest.raises(ValueError):
        encode_heights(np.array([[0.0, np.nan]]), Q)
    with pytest.raises(ValueError):
        decode_heights(gzip.compress(b"\0" * 12), (2, 2))


def test_decode_dummy_chunk_matches_dummy_surface(dummy_grid, dummy_index, geo):
    """Grid alignment KAT: the dummy chunk equals the dummy surface at our pixel centres."""
    md = _load_make_dummy()
    world = md.World.build()
    for ch in dummy_index["chunk_grid"]["chunks"][::9]:
        data = (DUMMY / ch["file"]).read_bytes()
        h = decode_heights(data, (256, 256))
        xs, ys = dummy_grid.pixel_centres(ch["i"], ch["j"])
        xx, yy = np.meshgrid(xs - geo.pad_xy[0], ys - geo.pad_xy[1])
        ref = world.elevation(xx, yy)
        assert np.abs(h - ref).max() <= Q / 2 + 1e-3


# -------------------------------------------------------------------------- sampling ----
def test_sample_bilinear_exact_on_aligned_grid():
    rng = np.random.default_rng(1)
    dem = rng.normal(0, 10, size=(20, 30))
    tr = Affine(1.0, 0, 500.0, 0, -1.0, 800.0)  # NW corner (500, 800), 1 m
    xs = 500.5 + np.arange(5, 12)
    ys = 800.0 - 0.5 - np.arange(3, 9)
    xx, yy = np.meshgrid(xs, ys)
    out = sample_bilinear(dem, tr, xx, yy)
    np.testing.assert_array_equal(out, dem[3:9, 5:12])


def test_sample_bilinear_reproduces_a_plane_off_grid():
    tr = Affine(1.0, 0, 0.0, 0, -1.0, 100.0)
    cy, cx = np.mgrid[0:100, 0:100]
    x = cx + 0.5
    y = 100.0 - (cy + 0.5)
    dem = 3.0 + 0.05 * x - 0.2 * y
    px, py = np.array([10.3, 50.75, 77.01]), np.array([12.9, 60.2, 33.33])
    np.testing.assert_allclose(sample_bilinear(dem, tr, px, py), 3.0 + 0.05 * px - 0.2 * py,
                               atol=1e-9)


def test_sample_bilinear_nan_outside_and_at_nodata():
    tr = Affine(1.0, 0, 0.0, 0, -1.0, 10.0)
    dem = np.zeros((10, 10))
    dem[4, 4] = np.nan
    out = sample_bilinear(dem, tr, np.array([-5.0, 4.5, 4.9, 2.5]), np.array([5.0, 5.5, 5.1, 2.5]))
    assert np.isnan(out[0]) and np.isnan(out[1]) and np.isnan(out[2])
    assert out[3] == 0.0


def test_fill_nodata_nearest():
    a = np.array([[1.0, np.nan, np.nan, 4.0]])
    filled, n = fill_nodata(a)
    assert n == 2
    np.testing.assert_array_equal(filled, [[1.0, 1.0, 4.0, 4.0]])
    with pytest.raises(ValueError):
        fill_nodata(np.full((2, 2), np.nan))


# -------------------------------------------------------------------------- corridor ----
def _dummy_route_xy(geo) -> list[np.ndarray]:
    fc = json.loads((DUMMY / "route_nom_104.geojson").read_text())
    return terrain_chunks.route_lines_xy(fc, geo)


def test_corridor_chunks_simple():
    g = ChunkGrid(x0=0.0, y0=1000.0, chunk_px=100, res_m=1.0, n=10)
    line = np.array([[150.0, 850.0], [450.0, 850.0]])  # inside row j=1, chunks i=1..4
    assert corridor_chunks(g, [line], 10.0) == [(1, 1), (2, 1), (3, 1), (4, 1)]
    got = corridor_chunks(g, [line], 60.0)  # rows 0..2, columns 0..5; round caps miss corners
    corners = {(0, 0), (5, 0), (0, 2), (5, 2)}  # nearest corner 70.7 m from the line end
    assert got == [(i, j) for j in range(3) for i in range(6) if (i, j) not in corners]


def test_corridor_chunks_reproduce_dummy_set(dummy_grid, dummy_index, geo):
    want = sorted((c["j"], c["i"]) for c in dummy_index["chunk_grid"]["chunks"])
    got = corridor_chunks(dummy_grid, _dummy_route_xy(geo),
                          FP3D_CFG["near"]["corridor_half_width_m"])
    assert sorted((j, i) for i, j in got) == want


# ------------------------------------------------------------------------ near export ----
def _synthetic_dem(grid: ChunkGrid, offset_px: tuple[int, int] = (0, 0)):
    """1 m DEM covering the whole grid (plus margin), aligned to the grid, with a nodata hole."""
    margin = 10
    n = grid.n * grid.chunk_px + 2 * margin
    tr = Affine(grid.res_m, 0, grid.x0 - (margin + offset_px[0]) * grid.res_m, 0, -grid.res_m,
                grid.y0 + (margin + offset_px[1]) * grid.res_m)
    rr, cc = np.mgrid[0:n, 0:n]
    x = tr.c + (cc + 0.5) * grid.res_m
    y = tr.f - (rr + 0.5) * grid.res_m
    dem = -4100.0 + 0.03 * (x - grid.x0) + 5.0 * np.sin((y - grid.y0) / 37.0)
    return dem, tr


def test_export_near_heights_exact_within_quantum(tmp_path):
    g = ChunkGrid(x0=-1000.0, y0=-280000.0, chunk_px=32, res_m=1.0, n=3)
    dem, tr = _synthetic_dem(g)
    dem_hole = dem.copy()
    dem_hole[50:53, 50:53] = np.nan  # inside chunk (1, 1)
    entries = terrain_chunks.export_near(dem_hole, tr, g, [(1, 1), (2, 0)], tmp_path, Q)
    assert [(e["i"], e["j"]) for e in entries] == [(1, 1), (2, 0)]
    for e in entries:
        f = tmp_path / e["file"]
        assert f.exists() and e["bytes"] == f.stat().st_size
        h = decode_heights(f.read_bytes(), (32, 32))
        r0 = 10 + e["j"] * 32
        c0 = 10 + e["i"] * 32
        ref = dem[r0:r0 + 32, c0:c0 + 32]
        if (e["i"], e["j"]) == (2, 0):
            assert e["filled_px"] == 0
            assert np.abs(h - ref).max() <= Q / 2 + 1e-3
        else:
            assert e["filled_px"] == 9
            ok = np.isfinite(dem_hole[r0:r0 + 32, c0:c0 + 32])
            assert np.abs(h[ok] - ref[ok]).max() <= Q / 2 + 1e-3
            assert np.isfinite(h).all()


def test_export_near_unaligned_dem_is_bilinear(tmp_path):
    """DEM shifted by half a pixel: chunk heights = bilinear on the plane (exact for a plane)."""
    g = ChunkGrid(x0=0.0, y0=1000.0, chunk_px=16, res_m=1.0, n=2)
    tr = Affine(1.0, 0, -10.5, 0, -1.0, 1010.5)
    rr, cc = np.mgrid[0:60, 0:60]
    plane = lambda x, y: 2.0 + 0.1 * x + 0.02 * y  # noqa: E731
    dem = plane(tr.c + cc + 0.5, tr.f - rr - 0.5)
    (e,) = terrain_chunks.export_near(dem, tr, g, [(1, 1)], tmp_path, Q)
    h = decode_heights((tmp_path / e["file"]).read_bytes(), (16, 16))
    xs, ys = g.pixel_centres(1, 1)
    xx, yy = np.meshgrid(xs, ys)
    assert np.abs(h - plane(xx, yy)).max() <= Q / 2 + 1e-4


# -------------------------------------------------------------------------- far mesh ----
def test_far_shape_matches_dummy(dummy_grid, dummy_index):
    assert far_mesh.far_shape(dummy_grid, FP3D_CFG["far"]["res_m"]) == (
        dummy_index["far"]["height"], dummy_index["far"]["width"])


def test_far_block_mean_exact_on_aligned_dem():
    g = ChunkGrid(x0=-1000.0, y0=-280000.0, chunk_px=32, res_m=1.0, n=2)
    dem, tr = _synthetic_dem(g)
    far, counts = far_mesh.far_heights([(dem, tr)], g, 8.0)
    assert far.shape == (8, 8)
    assert counts == [64, 0]
    core = dem[10:10 + 64, 10:10 + 64]
    ref = core.reshape(8, 8, 8, 8).mean(axis=(1, 3))
    np.testing.assert_allclose(far, ref, atol=1e-9)


def test_far_falls_back_to_coarser_source():
    g = ChunkGrid(x0=0.0, y0=64.0, chunk_px=64, res_m=1.0, n=1)
    fine = np.full((64, 32), 10.0)  # covers the west half only
    fine_tr = Affine(1.0, 0, 0.0, 0, -1.0, 64.0)
    coarse = np.full((4, 4), 20.0)  # 16 m cells over everything
    coarse_tr = Affine(16.0, 0, 0.0, 0, -16.0, 64.0)
    far, counts = far_mesh.far_heights([(fine, fine_tr), (coarse, coarse_tr)], g, 8.0)
    assert far.shape == (8, 8)
    assert counts == [32, 32, 0]
    np.testing.assert_array_equal(far[:, :4], 10.0)
    np.testing.assert_array_equal(far[:, 4:], 20.0)


def test_far_plane_at_cell_centres():
    g = ChunkGrid(x0=0.0, y0=128.0, chunk_px=128, res_m=1.0, n=1)
    tr = Affine(1.0, 0, 0.0, 0, -1.0, 128.0)
    rr, cc = np.mgrid[0:128, 0:128]
    dem = 0.5 * (cc + 0.5) - 0.25 * (128.0 - rr - 0.5)
    far, _ = far_mesh.far_heights([(dem, tr)], g, 8.0)
    xs = (np.arange(16) + 0.5) * 8.0
    ys = 128.0 - (np.arange(16) + 0.5) * 8.0
    xx, yy = np.meshgrid(xs, ys)
    np.testing.assert_allclose(far, 0.5 * xx - 0.25 * yy, atol=1e-9)


def test_far_grid_extends_by_whole_chunks_around_the_same_centre(dummy_grid):
    assert far_mesh.far_grid(dummy_grid, None) is dummy_grid
    assert far_mesh.far_grid(dummy_grid, 1000.0) is dummy_grid  # smaller than the near square
    fg = far_mesh.far_grid(dummy_grid, 6000.0)
    assert fg.n == 47 and fg.extent_m == 47 * 256.0  # 2 ceil((6000 - 128) / 256) + 1
    assert fg.x0 + fg.extent_m / 2 == pytest.approx(dummy_grid.x0 + dummy_grid.extent_m / 2)
    assert fg.y0 - fg.extent_m / 2 == pytest.approx(dummy_grid.y0 - dummy_grid.extent_m / 2)
    assert (dummy_grid.x0 - fg.x0) % 256.0 == pytest.approx(0.0)  # near and far lattices align
    assert far_mesh.far_shape(fg, 8.0) == (1504, 1504)


def test_corridor_includes_station_points():
    g = ChunkGrid(x0=0.0, y0=1000.0, chunk_px=100, res_m=1.0, n=10)
    line = np.array([[150.0, 850.0], [450.0, 850.0]])
    got = corridor_chunks(g, [line], 10.0, points=[(750.0, 250.0)])
    assert (7, 7) in got and (7, 6) not in got
    assert set(corridor_chunks(g, [line], 10.0)) | {(7, 7)} == set(got)


def test_dummy_far_file_matches_dummy_surface(dummy_grid, dummy_index, geo):
    md = _load_make_dummy()
    world = md.World.build()
    shape = (dummy_index["far"]["height"], dummy_index["far"]["width"])
    far = decode_heights((DUMMY / dummy_index["far"]["file"]).read_bytes(), shape)
    xs, ys = far_mesh.far_cell_centres(dummy_grid, dummy_index["far"]["res_m"])
    sel = slice(None, None, 37)
    xx, yy = np.meshgrid(xs[sel] - geo.pad_xy[0], ys[sel] - geo.pad_xy[1])
    assert np.abs(far[sel, sel] - world.elevation(xx, yy)).max() <= Q / 2 + 1e-3


def test_export_far_writes_file(tmp_path):
    g = ChunkGrid(x0=0.0, y0=64.0, chunk_px=64, res_m=1.0, n=1)
    dem = np.full((64, 64), -4000.0)
    entry = far_mesh.export_far([(dem, Affine(1.0, 0, 0.0, 0, -1.0, 64.0))], g, 8.0, tmp_path, Q,
                                source_names=["dem"])
    assert entry["width"] == 8 and entry["height"] == 8 and entry["res_m"] == 8.0
    assert entry["origin_xy_m"] == [0.0, 64.0]
    assert entry["cells_by_source"] == {"dem": 64, "filled_nearest": 0}
    h = decode_heights((tmp_path / entry["file"]).read_bytes(), (8, 8))
    np.testing.assert_array_equal(h, -4000.0)
    assert entry["bytes"] == (tmp_path / entry["file"]).stat().st_size


# --------------------------------------------------------------------- ortho chunks ----
GROUND = terrain_chunks.load_config()["horizon"]["panorama"]["ground_rgb"]


def _jpeg_rgb(data: bytes) -> np.ndarray:
    return np.asarray(Image.open(io.BytesIO(data)).convert("RGB")).astype(int)


def test_ortho_chunk_alignment_and_level():
    g = ChunkGrid(x0=0.0, y0=64.0, chunk_px=64, res_m=1.0, n=1)
    tr = Affine(0.25, 0, 0.0, 0, -0.25, 64.0)  # 0.25 m ortho over the chunk
    rgb = np.full((3, 256, 256), 100.0)
    # bright 8 x 8 m square, NW corner at x = 16 m, 16 m south of the north edge
    rgb[:, 64:96, 64:96] = 220.0
    img, nod = ortho_chunks.chunk_texture(rgb, tr, g, 0, 0, tex_px=32, nodata_rgb=GROUND)
    assert nod == 0
    assert img.size == (32, 32) and img.mode == "RGB"
    a = np.asarray(img).astype(int)
    assert a[8:12, 8:12, 0].min() == 220  # tex px 2 m: square covers rows/cols 8..11
    assert a[0:6, 0:6, 0].max() == 100
    enc = ortho_chunks.encode_jpeg(img, FP3D_CFG["texture"]["jpeg_quality"])
    back = _jpeg_rgb(enc)
    assert abs(back[..., 0].mean() - a[..., 0].mean()) < 2.0


def test_ortho_colour_kept_and_nodata_is_ground_colour_not_invented():
    g = ChunkGrid(x0=0.0, y0=64.0, chunk_px=64, res_m=1.0, n=1)
    tr = Affine(1.0, 0, 0.0, 0, -1.0, 64.0)
    rgb = np.full((3, 64, 64), np.nan)
    rgb[0, :, :32], rgb[1, :, :32], rgb[2, :, :32] = 200.0, 120.0, 60.0  # west half only
    img, nod = ortho_chunks.chunk_texture(rgb, tr, g, 0, 0, tex_px=16, nodata_rgb=GROUND)
    a = np.asarray(img).astype(int)
    assert tuple(a[5, 2]) == (200, 120, 60)
    assert tuple(a[5, 13]) == tuple(GROUND)
    assert nod == 16 * 8
    with pytest.raises(ValueError):
        ortho_chunks.chunk_texture(np.full((3, 64, 64), np.nan), tr, g, 0, 0, tex_px=8,
                                   nodata_rgb=GROUND)


def test_read_rgba_alpha_zero_is_nodata(tmp_path):
    import rasterio
    from rasterio.transform import from_origin

    g = ChunkGrid(x0=0.0, y0=64.0, chunk_px=32, res_m=1.0, n=2)
    data = np.zeros((4, 64, 64), dtype=np.uint8)
    data[0], data[1], data[2], data[3] = 10, 20, 30, 255
    data[3, :, 40:] = 0
    p = tmp_path / "o.tif"
    with rasterio.open(p, "w", driver="GTiff", width=64, height=64, count=4, dtype="uint8",
                       transform=from_origin(0.0, 64.0, 1.0, 1.0)) as ds:
        ds.write(data)
    out = ortho_chunks.export_textures_from_file(p, g, [(0, 0), (1, 1)], tmp_path, tex_px=16,
                                                 quality=95, nodata_rgb=GROUND)
    assert [o["tex"] for o in out] == ["fp3d/near_tex/0_0.jpg", "fp3d/near_tex/1_1.jpg"]
    assert out[0]["nodata_px"] == 0
    assert out[1]["nodata_px"] == 16 * 12  # x 40..64 of chunk (1,1) [32, 64]: 24 m of 32
    a = _jpeg_rgb((tmp_path / out[1]["tex"]).read_bytes())
    assert np.abs(a[8, 1] - [10, 20, 30]).max() <= 3
    assert np.abs(a[8, 14] - GROUND).max() <= 3
    for o in out:
        assert Image.open(tmp_path / o["tex"]).size == (16, 16)


# ---------------------------------------------------------------------------- index ----
def test_build_index_validates_and_matches_dummy_shape(dummy_grid, dummy_index, geo):
    near = [{"i": 14, "j": 14, "file": "fp3d/near/14_14.f32.gz", "bytes": 10, "filled_px": 0}]
    tex = [{"i": 14, "j": 14, "tex": "fp3d/near_tex/14_14.jpg", "bytes": 5, "nodata_px": 0}]
    far = {"file": "fp3d/far.f32.gz", "res_m": 8.0, "width": 928, "height": 928, "bytes": 7}
    idx = terrain_chunks.build_index(
        dummy_grid, geo, near, tex, far, quantum_m=Q, datum="test datum",
        eye_height_m=1.7, sources={"dem": "synthetic"})
    terrain_chunks.validate_index(idx)
    assert idx["dummy"] is False
    assert idx["height_scale"] == 1.0
    assert idx["height"]["byte_order"] == "little"
    assert idx["height"]["row_order"] == "north_to_south"
    assert idx["height"]["quantum_m"] == Q
    g, dg = idx["chunk_grid"], dummy_index["chunk_grid"]
    for k in ("cols", "rows", "chunk_px", "res_m", "index", "crs"):
        assert g[k] == dg[k], k
    assert g["origin_xy_m"] == pytest.approx(dg["origin_xy_m"], abs=0.006)
    assert idx["bounds"] == pytest.approx(dummy_index["bounds"], abs=2e-6)
    assert set(dummy_index) - {"dummy"} <= set(idx)  # every key the viewer reads in the dummy
    (ch,) = g["chunks"]
    assert ch["tex"] == "fp3d/near_tex/14_14.jpg"
    assert ch["bounds"] == pytest.approx(dummy_grid.chunk_bounds_lonlat(14, 14, geo))
    assert idx["far"]["bounds"] == idx["bounds"]
    assert idx["download_bytes"] == 10 + 5 + 7
    # a far grid larger than the chunk grid records its own origin and bounds
    fg = far_mesh.far_grid(dummy_grid, 6000.0)
    far2 = {**far, "width": 1504, "height": 1504, "origin_xy_m": [fg.x0, fg.y0]}
    idx2 = terrain_chunks.build_index(dummy_grid, geo, near, tex, far2, quantum_m=Q, datum="t",
                                      eye_height_m=1.7, sources={})
    w, s_, e, n = idx2["far"]["bounds"]
    assert (w, s_) == pytest.approx(geo.lonlat(fg.x0, fg.y0 - fg.extent_m), abs=1e-6)
    assert (e, n) == pytest.approx(geo.lonlat(fg.x0 + fg.extent_m, fg.y0), abs=1e-6)
    assert w < idx2["bounds"][0] and n > idx2["bounds"][3]
    assert idx["horizon_ring"] == "fp3d/horizon_ring.json"


# ------------------------------------------------------------------------ sun (Mars24) ----
# The 3D view's sun is WS4's Mars24 series in conditions/clock.json (eva.sun_series), read by
# web/src/fp3d/sun.ts. KAT: the committed series equals WS4's sun API (pipeline/conditions/sun.py)
# at eva_start + t, so the browser lights the scene with the API's sun, interpolated only.
from datetime import timedelta  # noqa: E402

from pipeline.conditions import sun  # noqa: E402
from pipeline.conditions.config import parse_utc  # noqa: E402

CLOCK_JSON = REPO / "web" / "public" / "data" / "conditions" / "clock.json"


@pytest.mark.skipif(not CLOCK_JSON.exists(), reason="no real conditions/clock.json yet")
def test_clock_json_sun_series_is_ws4_sun_api():
    ck = json.loads(CLOCK_JSON.read_text())
    eva = ck["eva"]
    cols = eva["sun_series_columns"]
    it, ia, ie = (cols.index(c) for c in ("t_eva_min", "sun_azimuth_deg", "sun_elevation_deg"))
    t0 = sun.eva_start_utc()  # clock.json start_utc is the same instant, rounded to 1 s
    assert abs((parse_utc(eva["start_utc"]) - t0).total_seconds()) <= 1.0
    lat, lon = ck["site"]["lat_deg"], ck["site"]["lon_east_deg"]
    rows = eva["sun_series"]
    assert rows[0][it] == 0 and rows[-1][it] >= CFG_ALL["crew"]["eva_h"] * 60 - 1e-9
    for row in rows[:: max(1, len(rows) // 7)] + [rows[-1]]:
        p = sun.sun_position(t0 + timedelta(minutes=row[it]), lat, lon)
        assert row[ia] == pytest.approx(p.azimuth_deg, abs=2e-3)
        assert row[ie] == pytest.approx(p.elevation_deg, abs=2e-3)


CFG_ALL = terrain_chunks.load_config()


# ---------------------------------------------------------------- skyline check (F20) ----
# SPEC F20 acceptance: "the rendered skyline at each station within 0.5 deg of the computed
# horizon". The computed horizon is WS3's engine (pipeline/horizon/rays.py, config/horizon.yaml
# sampling and curvature). For the dummy world it is computed here on the dummy's analytic
# surface (tools/make_dummy.py World) over the dummy data extent and committed as a fixture that
# web/src/fp3d/skyline.test.ts compares the rendered geometry against. Regenerate with
#   HOMELINE_WRITE_FIXTURES=1 uv run --no-sync pytest -k skyline_fixture
import math  # noqa: E402
import os  # noqa: E402

SKYLINE_FIXTURE = REPO / "web" / "src" / "fp3d" / "testdata" / "skyline_check.dummy.json"


def _surface_band(world, pad_xy, source, x_west, y_north, res, cols, rows):
    from pipeline.horizon.rays import DemBand

    z = np.empty((rows, cols), dtype=np.float32)
    xs = x_west + (np.arange(cols) + 0.5) * res - pad_xy[0]
    block = max(1, 2_000_000 // cols)
    for r0 in range(0, rows, block):
        r1 = min(rows, r0 + block)
        ys = y_north - (np.arange(r0, r1) + 0.5) * res - pad_xy[1]
        gx, gy = np.meshgrid(xs, ys)
        z[r0:r1] = world.elevation(gx, gy)
    return DemBand(source, z, x_west, y_north, res, -res)


def dummy_skyline_check(geo: Geo, dummy_index: dict) -> dict:
    from pipeline.horizon import config as hcfg
    from pipeline.horizon.rays import HorizonEngine

    world = _load_make_dummy().World.build()
    hz = hcfg.load()
    samp = {s["source"]: s for s in hz["sampling"]}
    eye = CFG_ALL["hud"]["eye_height_m"]
    stations = json.loads((DUMMY / "stations.json").read_text())
    obs = [("pad", *geo.pad_xy)] + [(s["id"], *geo.xy(s["lon"], s["lat"])) for s in stations]
    west, north = dummy_index["chunk_grid"]["origin_xy_m"]
    ext = dummy_index["far"]["width"] * dummy_index["far"]["res_m"]
    # dem_1m: every observer +- the dem_1m range, clipped to the dummy extent, on the 1 m lattice
    reach = samp["dem_1m"]["to_m"]
    xa = max(west, math.floor(min(o[1] for o in obs) - reach - west) + west)
    xb = min(west + ext, math.ceil(max(o[1] for o in obs) + reach - west) + west)
    yb = min(north, math.ceil(max(o[2] for o in obs) + reach - north) + north)
    ya = max(north - ext, math.floor(min(o[2] for o in obs) - reach - north) + north)
    dem = _surface_band(world, geo.pad_xy, "dem_1m", xa, yb, 1.0, int(round(xb - xa)),
                        int(round(yb - ya)))
    cs = samp["ctx_20m"]["step_m"]
    n = int(ext // cs)
    ctx = _surface_band(world, geo.pad_xy, "ctx_20m", west, north, cs, n, n)
    engine = HorizonEngine([dem, ctx], cfg=hz)
    step = FP3D_CFG["skyline_check"]["az_step_deg"]
    profs = [(sid, engine.horizon(x, y, eye_height_m=eye, az_step_deg=step))
             for sid, x, y in obs]
    return terrain_chunks.skyline_reference(
        profs, geo, source="WS3 HorizonEngine (config/horizon.yaml) on the M0 dummy surface "
        "(tools/make_dummy.py World) over the dummy fp3d extent; DUMMY")


@pytest.mark.filterwarnings("ignore::numba.NumbaPerformanceWarning")
def test_dummy_skyline_fixture_is_current(geo, dummy_index):
    """The committed reference horizons for the vitest skyline check match a fresh WS3 run."""
    fresh = dummy_skyline_check(geo, dummy_index)
    if os.environ.get("HOMELINE_WRITE_FIXTURES"):
        SKYLINE_FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        SKYLINE_FIXTURE.write_text(json.dumps(fresh, separators=(",", ":")) + "\n")
    committed = json.loads(SKYLINE_FIXTURE.read_text())
    assert [s["id"] for s in committed["stations"]] == ["pad", "S1", "S2", "S3"]
    assert committed["tolerance_deg"] == FP3D_CFG["skyline_check"]["tolerance_deg"] == 0.5
    for a, b in zip(committed["stations"], fresh["stations"], strict=True):
        assert a["id"] == b["id"]
        assert a["x_m"] == pytest.approx(b["x_m"], abs=1e-3)
        np.testing.assert_allclose(np.array(a["elevation_deg"], dtype=float),
                                   np.array(b["elevation_deg"], dtype=float), atol=2e-4)


def test_skyline_reference_resamples_and_keeps_unknown(geo):
    from pipeline.horizon.rays import HorizonProfile

    az = np.arange(1440) * 0.25
    el = np.sin(np.radians(az))
    el[8:12] = np.nan  # 2.0 .. 2.75 deg unknown
    prof = HorizonProfile(az_deg=az, elevation_deg=el, distance_m=np.full(1440, 100.0),
                          source=["dem_1m"] * 1440, observer={"x": geo.pad_xy[0],
                                                              "y": geo.pad_xy[1], "z": 0.0},
                          eye_height_m=1.7, az_step_deg=0.25)
    ref = terrain_chunks.skyline_reference([("pad", prof)], geo, source="test")
    (st,) = ref["stations"]
    assert len(st["elevation_deg"]) == 360
    assert st["elevation_deg"][90] == pytest.approx(1.0, abs=1e-4)
    assert st["elevation_deg"][2] is None
    assert (st["lon"], st["lat"]) == pytest.approx(geo.pad_lonlat, abs=1e-6)
