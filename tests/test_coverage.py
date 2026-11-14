"""Known-answer tests for WS1 terrain (briefs/WS1.md "Tests"; SPEC §9 Terrain, F1, F2).

- Source-mask fractions over a window match a direct count / the footprint area within 1%.
- An unknown island is never assessed and is excluded from percentages.
- A cell within 20 m of a source boundary is flagged as a data edge.
- Slope of a synthetic 10% plane = 5.71 deg +- 0.05 deg (Horn 3x3 and the 5 m plane fit).
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from shapely.geometry import Polygon, box

from pipeline.terrain import coverage, routing, slope
from pipeline.terrain.grid import Grid

# ---------------------------------------------------------------- source mask


def test_mask_fraction_matches_footprint_area_within_1pct():
    g = Grid(x0=0.0, y0=1000.0, res=1.0, width=1000, height=1000)
    quad = Polygon([(120, 80), (870, 210), (760, 940), (60, 700)])  # skewed STAC-like quad
    m = coverage.rasterize_footprints([quad], g)
    frac_raster = m.mean()
    frac_area = quad.intersection(box(*g.bounds)).area / box(*g.bounds).area
    assert abs(frac_raster - frac_area) <= 0.01 * frac_area


def test_source_fractions_match_direct_count():
    rng = np.random.default_rng(1)
    mask = rng.choice(np.array([0, 1, 2, 3], np.uint8), size=(300, 400), p=[.1, .5, .3, .1])
    win = (slice(20, 220), slice(50, 350))
    fr = coverage.source_fractions(mask, win)
    sub = mask[win]
    for code in (0, 1, 2, 3):
        assert fr[code] == pytest.approx((sub == code).mean(), abs=0.01)
    assert sum(fr.values()) == pytest.approx(1.0)


def test_source_mask_codes():
    dem = np.zeros((10, 10), np.float32)
    dem[0, 0] = np.nan
    hirise = np.zeros((10, 10), bool)
    hirise[:, :5] = True
    m = coverage.source_mask(dem, hirise)
    assert m[0, 0] == coverage.NODATA
    assert (m[1:, :5] == coverage.HIRISE).all()
    assert (m[:, 5:] == coverage.NON_HIRISE).all()


# ---------------------------------------------------------------- cell states, island


def _flat_world(n3=60):
    """1 m DEM of a flat plane, all HiRISE, with a 10x10-m unknown island (CTX)."""
    n1 = 3 * n3
    dem = np.zeros((n1, n1), np.float32)
    mask = np.full((n1, n1), coverage.HIRISE, np.uint8)
    mask[90:100, 90:100] = coverage.NON_HIRISE  # island
    return dem, mask


def test_unknown_island_never_assessed_and_excluded():
    dem, mask = _flat_world()
    slope1 = np.zeros_like(dem)
    elev3, max3, state3 = routing.routing_grids(dem, slope1, mask, nogo_deg=20.0)
    island3 = np.zeros(state3.shape, bool)
    island3[90 // 3:(100 + 2) // 3, 90 // 3:(100 + 2) // 3] = True
    assert (state3[island3] == routing.UNKNOWN).all()
    assert (state3[~island3] == routing.ASSESSED).all()
    # percentages exclude unknown cells
    vals = np.ones(state3.shape)
    vals[island3] = 1e9  # would dominate if it leaked in
    assert routing.mean_over_known(vals, state3) == pytest.approx(1.0)
    # coverage counts the island as unknown
    disc = np.ones(state3.shape, bool)
    cov = coverage.disc_coverage(state3, disc)
    assert cov["unknown_frac"] == pytest.approx(island3.mean())
    assert cov["assessed_frac"] + cov["unknown_frac"] == pytest.approx(1.0)


def test_blocked_cells_from_max_slope():
    dem = np.zeros((30, 30), np.float32)
    slope1 = np.zeros_like(dem)
    slope1[4, 4] = 21.0  # one steep 1 m cell blocks its 3 m cell
    mask = np.full(dem.shape, coverage.HIRISE, np.uint8)
    _, max3, st = routing.routing_grids(dem, slope1, mask, nogo_deg=20.0)
    assert st[1, 1] == routing.BLOCKED and max3[1, 1] == pytest.approx(21.0)
    assert (np.delete(st.ravel(), 1 * 10 + 1) == routing.ASSESSED).all()


def test_nodata_cell_is_unknown():
    dem = np.zeros((9, 9), np.float32)
    dem[0, 0] = np.nan
    mask = coverage.source_mask(dem, np.ones(dem.shape, bool))
    _, _, st = routing.routing_grids(dem, np.zeros_like(dem), mask, nogo_deg=20.0)
    assert st[0, 0] == routing.UNKNOWN and st[1, 1] == routing.ASSESSED


# ---------------------------------------------------------------- data edge


def test_data_edge_within_20m():
    state = np.zeros((100, 100), np.uint8)
    state[:, 60:] = routing.UNKNOWN  # boundary between col 59 and col 60
    edge = coverage.data_edge(state, res=3.0, buffer_m=20.0)
    # cell centre to the boundary: (59.5 - c) * 3 m for assessed col c
    for c in range(0, 60):
        d = (60 - c - 0.5) * 3.0
        assert edge[50, c] == (d <= 20.0), (c, d)
    assert not edge[:, 60:].any()  # unknown cells are not "edges", they are unknown


# ---------------------------------------------------------------- slope


@pytest.mark.parametrize("res", [1.0, 3.0])
def test_slope_10pct_plane(res):
    n = 64
    yy, xx = np.mgrid[0:n, 0:n] * res
    z = 0.10 * xx + 0.0 * yy
    s = slope.horn(z.astype(np.float32), res)
    inner = s[1:-1, 1:-1]
    assert np.nanmax(np.abs(inner - math.degrees(math.atan(0.1)))) < 0.05
    assert math.degrees(math.atan(0.1)) == pytest.approx(5.71, abs=0.01)
    assert np.isnan(s[0]).all()  # border has no full window: unknown, not filled


def test_slope_diagonal_plane_and_plane_fit():
    n = 64
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float64)
    z = (0.06 * xx - 0.08 * yy).astype(np.float32)  # |grad| = 0.10
    s = slope.horn(z, 1.0)
    assert np.nanmax(np.abs(s - 5.7106)) < 0.05
    s5, rough = slope.plane_fit(z, 1.0, window_px=5)
    assert np.nanmax(np.abs(s5 - 5.7106)) < 0.05
    assert np.nanmax(rough) < 1e-3  # a plane has no roughness


def test_roughness_of_known_bumps():
    rng = np.random.default_rng(0)
    z = rng.normal(0, 0.2, size=(200, 200)).astype(np.float32)
    _, rough = slope.plane_fit(z, 1.0, window_px=5)
    # RMS residual of a 3-parameter plane over 25 samples: sigma * sqrt(22/25)
    assert np.nanmedian(rough) == pytest.approx(0.2 * math.sqrt(22 / 25), rel=0.1)


def test_nodata_propagates_to_slope():
    z = np.zeros((20, 20), np.float32)
    z[10, 10] = np.nan
    s = slope.horn(z, 1.0)
    assert np.isnan(s[9:12, 9:12]).all()
    assert s[5, 5] == pytest.approx(0.0)


# -------------------------------------------------- web shape, contracts v1.0.0 (F1, F16)

REPO = __import__("pathlib").Path(__file__).resolve().parents[1]


def _schema(name):
    import json

    from jsonschema import Draft202012Validator

    return Draft202012Validator(json.loads((REPO / "contracts" / name).read_text()))


def test_disc_state_pct_is_a_partition_of_the_disc():
    from pipeline.terrain import webout

    st = np.zeros((10, 10), np.uint8)
    st[0, :] = routing.BLOCKED       # 10 blocked
    st[1, :5] = routing.UNKNOWN      # 5 unknown
    disc = np.ones(st.shape, bool)
    disc[9, :] = False               # 90 cells; row 9 (all assessed) outside
    p = webout.disc_state_pct(st, disc)
    assert p == {"assessed_pct": pytest.approx(75 / 90 * 100, abs=0.01),
                 "blocked_pct": pytest.approx(10 / 90 * 100, abs=0.01),
                 "unknown_pct": pytest.approx(5 / 90 * 100, abs=0.01)}
    assert sum(p.values()) == pytest.approx(100.0, abs=0.02)
    assert webout.disc_state_pct(st, np.zeros(st.shape, bool)) == {
        "assessed_pct": None, "blocked_pct": None, "unknown_pct": None}


_PAD_DISCS = [{"budget_min": 30, "radius_m": 1764.0, "assessed_pct": 55.0, "blocked_pct": 40.0,
               "unknown_pct": 5.0},
              {"budget_min": 60, "radius_m": 3528.0, "assessed_pct": 92.0, "blocked_pct": 3.0,
               "unknown_pct": 5.0}]


def test_pad_check_shows_both_readings_and_picks_none_while_open():
    """Pad check (SPEC F1 acceptance, WS1 G0): the reading of "assessed" is open (S/C), so both
    readings are reported - data coverage (assessed + blocked) and state 0 only - and pass is
    null until site.yaml coverage.pad_check_reading names one."""
    from pipeline.terrain import webout

    pc = webout.pad_check(_PAD_DISCS, budget_min=30, min_pct=90)
    assert pc["budget_min"] == 30 and pc["min_assessed_pct"] == 90
    assert pc["reading"] is None and pc["pass"] is None
    r = pc["readings"]
    assert set(r) == {"data_coverage", "state0_only"}
    assert r["data_coverage"]["pct"] == pytest.approx(95.0) and r["data_coverage"]["pass"] is True
    assert r["state0_only"]["pct"] == pytest.approx(55.0) and r["state0_only"]["pass"] is False
    assert pc["known_pct"] == pytest.approx(95.0)
    assert all(v["definition"] for v in r.values())
    r60 = webout.pad_check(_PAD_DISCS, budget_min=60, min_pct=90)["readings"]
    assert r60["data_coverage"]["pass"] is True and r60["state0_only"]["pass"] is True
    nulls = [{**_PAD_DISCS[0], "assessed_pct": None, "blocked_pct": None, "unknown_pct": None}]
    rn = webout.pad_check(nulls, budget_min=30, min_pct=90)
    assert rn["pass"] is None
    assert rn["readings"]["data_coverage"]["pass"] is None
    assert rn["readings"]["state0_only"]["pass"] is None


@pytest.mark.parametrize("reading,expected", [("data_coverage", True), ("state0_only", False)])
def test_pad_check_pass_follows_a_decided_reading(reading, expected):
    from pipeline.terrain import webout

    pc = webout.pad_check(_PAD_DISCS, budget_min=30, min_pct=90, reading=reading)
    assert pc["reading"] == reading and pc["pass"] is expected
    with pytest.raises(ValueError):
        webout.pad_check(_PAD_DISCS, budget_min=30, min_pct=90, reading="assessed")


def test_pad_check_reading_is_open_in_config():
    """Nobody has decided the reading: the config must not pick one (session 2 instruction)."""
    from pipeline.terrain import grid as G

    assert G.site()["coverage"]["pad_check_reading"] is None


def test_prov_record_goes_through_ws6_fragment(tmp_path, monkeypatch):
    """WS1 provenance uses WS6's manifest.record (per-script fragment, no pending file); a
    non-finite value is recorded as None (unknown), never NaN."""
    import json

    from pipeline.terrain import prov

    monkeypatch.setenv("HOMELINE_MANIFEST_DIR", str(tmp_path))
    script = prov.REPO / "pipeline" / "terrain" / "build.py"
    prov.record("terrain.test.value", np.float32(1.5), "m", "validation/coverage.json", script)
    prov.record("terrain.test.unknown", float("nan"), "m", "validation/coverage.json", script)
    frag = json.loads((tmp_path / "pipeline__terrain__build.json").read_text())
    assert frag["terrain.test.value"]["value"] == 1.5
    assert frag["terrain.test.value"]["file"] == "validation/coverage.json"
    assert frag["terrain.test.value"]["script"] == "pipeline/terrain/build.py"
    assert frag["terrain.test.unknown"]["value"] is None
    assert not hasattr(prov, "PENDING")


def test_source_fractions_pct_names_and_region():
    from pipeline.terrain import webout

    m = np.array([[1, 1, 2, 0], [1, 3, 1, 1]], np.uint8)
    region = np.ones(m.shape, bool)
    region[:, 3] = False             # drop one nodata and one HiRISE cell
    p = webout.source_fractions_pct(m, region)
    assert p == {"hirise": pytest.approx(400 / 6), "ctx": pytest.approx(100 / 6),
                 "hrsc_mola": pytest.approx(100 / 6), "nodata": pytest.approx(0.0)}


def test_lonlat_bounds_are_pixel_edges():
    from pipeline.terrain import grid as G
    from pipeline.terrain import webout

    g = G.route_grid()
    w, s, e, n = webout.lonlat_bounds(g)
    x0, y0 = G.xy_of_lonlat(w, n)
    x1, y1 = G.xy_of_lonlat(e, s)
    assert (x0, y0) == (pytest.approx(g.x0, abs=0.06), pytest.approx(g.y0, abs=0.06))
    assert x1 == pytest.approx(g.x0 + g.width * g.res, abs=0.06)
    assert y1 == pytest.approx(g.y0 - g.height * g.res, abs=0.06)


def test_coverage_map_rgba_uses_only_legend_colours():
    from pipeline.terrain import webout

    st = np.zeros((200, 200), np.uint8)
    st[:50] = routing.BLOCKED
    st[:, :20] = routing.UNKNOWN
    g = Grid(x0=0.0, y0=600.0, res=3.0, width=200, height=200)
    rgba, legend = webout.coverage_map_rgba(st, g, (300.0, 300.0), [150.0, 280.0])
    assert rgba.shape == (200, 200, 4) and rgba.dtype == np.uint8
    assert (rgba[..., 3] == 255).all()
    cols = {tuple(c) for c in rgba[..., :3].reshape(-1, 3)}
    leg = {tuple(int(k[i:i + 2], 16) for i in (1, 3, 5)) for k in legend}
    assert cols <= leg
    # far from the circles and the pad, each class has its own legend colour
    inv = {v: k for k, v in legend.items()}
    hexc = "#{:02x}{:02x}{:02x}".format
    assert hexc(*rgba[199, 199, :3]) == inv[webout.LABELS["assessed"]]
    assert hexc(*rgba[0, 199, :3]) == inv[webout.LABELS["blocked"]]
    assert hexc(*rgba[199, 0, :3]) == inv[webout.LABELS["unknown"]]


def test_coverage_web_document_validates_and_keeps_internal_keys():
    from pipeline.terrain import webout

    internal = {"discs": {"30": {"radius_m": 1764.0}}, "d3": {"status": "OPEN"},
                "pad": {"lon": 137.382, "lat": -4.806, "xy": [1.0, 2.0]}}
    discs = [{"budget_min": 30, "radius_m": 1764.0, "assessed_pct": 59.0, "blocked_pct": 41.0,
              "unknown_pct": 0.0}]
    doc = webout.coverage_web(
        internal, discs=discs, source_pct={"hirise": 100.0, "ctx": 0.0, "hrsc_mola": 0.0,
                                           "nodata": 0.0},
        pad_chk=webout.pad_check(discs, 30, 90), speed_ms=0.98, origin="STAC",
        map_meta={"png": "validation/coverage.png", "bounds": [1, 2, 3, 4],
                  "legend": {"#000000": "x"}})
    errs = list(_schema("coverage.schema.json").iter_errors(doc))
    assert not errs, errs
    assert doc["d3"] == {"status": "OPEN"}                         # evidence kept
    assert doc["discs_by_budget"] == {"30": {"radius_m": 1764.0}}  # old dict kept, renamed
    assert doc["pad"]["xy"] == [1.0, 2.0]


def test_grid_spec_fields_grid_corner():
    from pipeline.terrain import grid as G
    from pipeline.terrain import webout

    s = G.site()
    gf = G.fields_grid()
    spec = webout.grid_spec(gf)
    px, py = G.pad_xy()
    r = s["planning_radius_m"]
    assert spec["nw_xy"] == [pytest.approx(px - r), pytest.approx(py + r)]
    assert spec["width"] == spec["height"] == int(2 * r / s["grids_m"]["fields"])
    assert spec["res_m"] == s["grids_m"]["fields"]
    assert spec["transform_gdal"] == [gf.x0, gf.res, 0.0, gf.y0, 0.0, -gf.res]
    assert spec["bounds_lonlat"] == webout.lonlat_bounds(gf)


# -------------------------------------------------- basemap zooms (brief WS1 task 7)


def test_basemap_zoom_range_for_025_to_10_m():
    """Mars lon/lat passed to MapLibre as-is (D4): m/px at zoom z = 2 pi R / (256 * 2^z).
    R = 3,396,190 m -> z18 = 0.318 m/px (nearest to 0.25 m), z13 = 10.18 m/px (nearest to 10 m)."""
    from pipeline.terrain import build

    r = 3396190.0
    assert 2 * math.pi * r / (256 * 2 ** 18) == pytest.approx(0.31798, abs=1e-4)
    assert build._zoom_for(0.25) == 18
    assert build._zoom_for(10.0) == 13
    assert build._zoom_for(1.0) == 16
