"""End-to-end tests of the scenario batch, partner line, traverse, trade table and siting on
synthetic grids (the dummy world of docs/dummy.md and planes). Fixtures, not data."""

import json

import numpy as np
import pytest
import rasterio

from pipeline.engine import (
    dijkstra,
    margin,
    physio,
    provenance,
    scenarios,
    siting,
    trade,
    traverse,
)
from pipeline.engine.config import load
from pipeline.engine.geo import validate
from pipeline.engine.synthetic import dummy_world, make_grid, plane

RMSE_STUB = 1.0  # V1 RMSE stand-in until WS6 publishes v1.json


@pytest.fixture(autouse=True)
def manifest_dir(tmp_path, monkeypatch):
    monkeypatch.setenv(provenance.FRAGMENT_DIR_ENV, str(tmp_path / "manifest"))
    return tmp_path / "manifest"


@pytest.fixture
def settings():
    return scenarios.settings_from_config(RMSE_STUB)


def test_settings_from_config(settings):
    assert settings.isochrone_minutes == list(range(1, 61))
    assert settings.isochrone_fallback_step == 2
    assert settings.simplify_m == 2 and settings.budgets == [30, 60]
    assert scenarios.isochrone_levels(1, 60, 2)[0] == 2 and 30 in scenarios.isochrone_levels(
        1, 60, 2)  # fmt: skip


def test_runnable_needs_v1():
    ok, skipped = scenarios.runnable(["nom_104", "con_104"], None)
    assert ok == ["nom_104"] and "con_104" in skipped


def test_batch_on_dummy_world(tmp_path, settings, manifest_dir):
    grid, pad, _ = dummy_world(3.0, half_m=600.0)
    assert scenarios.pad_rc(grid) == pad
    sids = ["nom_104", "con_104", "opt_104"]
    fields = scenarios.return_fields(grid, pad, sids, settings, out_dir=tmp_path / "engine")
    with rasterio.open(tmp_path / "engine/nom_104/t_home.tif") as ds:
        t = ds.read(1)
        assert ds.res == (3.0, 3.0) and t[pad] == 0
        expect = fields["nom_104"].t_min.astype(np.float32)
        np.testing.assert_allclose(t, np.where(np.isfinite(expect), expect, np.nan))
    with rasterio.open(tmp_path / "engine/nom_104/pointer.tif") as ds:
        assert ds.read(1)[pad] == -1
    off = json.loads((tmp_path / "engine/pointer_offsets.json").read_text())
    assert len(off["offsets_drow_dcol"]) == 16
    t_c, t_n, t_o = (fields[s].t_min for s in ("con_104", "nom_104", "opt_104"))
    reach = [(np.isfinite(x) & (x <= 10)).sum() for x in (t_c, t_n, t_o)]
    assert reach[0] <= reach[1] <= reach[2]

    pub = tmp_path / "public"
    index = scenarios.web_products(grid, pad, fields, settings, public=pub)
    validate(index, "scenarios_index.schema.json")
    assert index["dummy"] is False and index["default"] == "nom_104"
    for sid in sids:
        iso = json.loads((pub / f"scenarios/{sid}/isochrones.geojson").read_text())
        validate(iso, "isochrones.schema.json")
        assert [f["properties"]["minutes"] for f in iso["features"]] == list(range(1, 61))
        validate(json.loads((pub / f"scenarios/{sid}/edges.geojson").read_text()),
                 "edges.schema.json")  # fmt: skip
    validate(json.loads((pub / "scenarios/bands_104.geojson").read_text()), "bands.schema.json")
    # A 600 m world cannot hold the 30-min flat disc: headline stays null, nothing recorded.
    h = {s["id"]: s["headline"] for s in index["scenarios"]}["nom_104"]
    assert h == {"budget_min": 30, "reachable_pct": None, "range_pct": [None, None]}
    keys = set(provenance.load_all())
    assert not any(k.startswith("reachable_pct") for k in keys)
    assert "file.scenarios/index.json" in keys and "isochrone_step_min.nom_104" in keys
    validate(provenance.load_all(), "manifest.schema.json")


def test_isochrone_fallback_step(settings):
    """Over the gz budget the fallback step (2 min) is used."""
    g = make_grid(plane(121, 3.0, 0.0), 3.0)
    f = dijkstra.return_field(g, physio.grade_table(physio.params("nominal", suit_kg=104)),
                              (60, 60))  # fmt: skip
    fc, step, mb = scenarios.isochrones_within_budget(g, f.t_min, settings)
    assert step == 1 and mb < settings.isochrone_budget_mb_gz
    tiny = scenarios.Settings(**{**settings.__dict__, "isochrone_budget_mb_gz": 1e-6})
    fc2, step2, _ = scenarios.isochrones_within_budget(g, f.t_min, tiny)
    assert step2 == 2
    assert [x["properties"]["minutes"] for x in fc2["features"]][:2] == [2, 4]
    # the fallback is the even-minute subset of the 1-min set (no second contouring pass)
    by_min = {x["properties"]["minutes"]: x for x in fc["features"]}
    assert all(x == by_min[x["properties"]["minutes"]] for x in fc2["features"])


def test_ridge_3m_aggregation():
    r = np.zeros((9, 9))
    r[4, 4] = 1.0
    out = scenarios.ridge_3m(r, 3)
    assert out.shape == (3, 3) and out[1, 1] == 1.0 and out.sum() == 1.0


def test_partner_on_plane(tmp_path, settings):
    g = make_grid(plane(161, 3.0, 0.03), 3.0)
    pad = (80, 80)
    ridge = np.zeros(g.shape)
    ridge[:, 120] = 1.0  # one ridge line, masked for hauling
    f = scenarios.partner_fields(g, pad, ridge, 104, settings, out_dir=tmp_path)
    # D20: cart only, 2 casualty masses (suited 179 kg, bound 343 kg); no drag fields
    assert set(f) == {("cart", 179.0), ("cart", 343.0)}
    assert not list(tmp_path.glob("haul/*drag*"))
    assert np.isinf(f[("cart", 179.0)][:, 121:]).all()
    fc = scenarios.partner_product(g, f, 104, settings, public=tmp_path / "public")
    validate(fc, "partner.schema.json")
    assert all(ft["properties"]["style"] == "dashed" and not ft["properties"]["default_visible"]
               for ft in fc["features"])  # fmt: skip
    assert {ft["properties"]["case"] for ft in fc["features"]} == {"cart"}
    assert all(ft["properties"]["label"] == "Partner line (cart haul, 60 min)"
               for ft in fc["features"])  # fmt: skip
    assert all(ft["properties"]["caption"].startswith("Design question")
               and ft["properties"]["drag_note"].startswith("One astronaut cannot drag")
               for ft in fc["features"])  # fmt: skip
    # the drag finding travels with the file and its numbers are in the manifest (D20)
    d = fc["drag_finding"]
    assert d["feasible"] is False and d["reason"] == "traction"
    assert d["max_mass_kg"] == pytest.approx(157.5)
    keys = provenance.load_all()
    for q in ("force_N", "traction_limit_N", "max_mass_kg", "casualty_kg"):
        assert keys[f"haul.drag.flat.{q}"]["value"] == pytest.approx(d[q], abs=1e-3)
        assert keys[f"haul.drag.flat.{q}"]["file"] == "scenarios/nom_104/partner.geojson"
        assert f"haul.drag.flat.nom_104.{q}" in keys


# ------------------------------------------------------------------ traverse


@pytest.fixture(scope="module")
def plane_world():
    g = make_grid(plane(241, 3.0, 0.03), 3.0)
    pad = (120, 120)
    p = physio.params("nominal", suit_kg=104)
    tab = physio.grade_table(p)
    home = dijkstra.return_field(g, tab, pad)
    st = [{"id": "S1", "rc": (40, 100), "value": 0.6, "dwell_min": 30},
          {"id": "S2", "rc": (200, 60), "value": 0.5, "dwell_min": 30},
          {"id": "S3", "rc": (130, 220), "value": 0.9, "dwell_min": 30}]  # fmt: skip
    return g, pad, p, tab, home, st


def test_traverse_plan_and_timeline(plane_world, tmp_path):
    g, pad, p, tab, home, st = plane_world
    mi = margin.inputs(p)
    res = traverse.plan(g, tab, home, pad, st, 390.0, 30.0, mi)
    assert sorted(res.order) == ["S1", "S2", "S3"]
    validate(res.timeline, "timeline.schema.json")
    validate(res.route, "route.schema.json")
    tl = res.timeline
    assert tl[0]["event"] == "depart" and tl[0]["o2_left_L"] == round(mi.o2_capacity_l, 2)
    ret = [e for e in tl if e["event"] == "return"][0]
    assert ret["t_min"] == pytest.approx(res.total_min, abs=0.01)
    # T_home on arrival equals the return field at the station (HUD consistency)
    for e in tl:
        if e["event"] == "arrive":
            s = next(x for x in st if x["id"] == e["station"])
            assert e["t_home_min"] == pytest.approx(home.t_min[s["rc"]], abs=0.01)
    # O2 left decreases monotonically along the walk events
    walk = [e for e in tl if e["event"] in ("depart", "arrive", "leave", "o2_checkpoint",
                                            "return")]  # fmt: skip
    o2 = [e["o2_left_L"] for e in walk]
    assert all(b <= a + 1e-9 for a, b in zip(o2, o2[1:], strict=False))
    # checkpoints every 30 min
    ck = [e["t_min"] for e in tl if e["event"] == "o2_checkpoint"]
    assert ck[:2] == [30.0, 60.0]
    # vertex times run from t_start to t_end
    for lg in res.legs:
        assert lg["times_min"][0] == lg["t_start_min"] and lg["times_min"][-1] == lg["t_end_min"]
        assert np.all(np.diff(lg["times_min"]) >= 0)
    # turn-back rows: margin 0 at the binding term
    tbs = [e for e in tl if e["event"] == "turn_back"]
    assert len(tbs) == 3 and all(abs(e["margin_min"]) < 0.02 for e in tbs)
    assert all(e["margin_min"] >= 0 for e in walk)
    # S review O2 term: station work at 0.84 L/min; on arrival the station's remaining tasks
    # (30 min x 0.84 = 25.2 L) are subtracted, so the O2 margin on arrival equals the one on
    # leaving (same cell, same O2_home); fixed 40.5 L reserve, no (1 + r).
    for e in tl:
        if e["event"] == "arrive":
            lv = next(x for x in tl if x["event"] == "leave" and x["station"] == e["station"])
            assert e["o2_tasks_left_L"] == pytest.approx(30 * 0.84)
            assert lv["o2_left_L"] == pytest.approx(e["o2_left_L"] - 30 * 0.84, abs=0.02)
            s = next(x for x in st if x["id"] == e["station"])
            oh = float(home.o2_l[s["rc"]])
            exp = (lv["o2_left_L"] - oh - 40.5) / 1.35
            assert margin.o2_margin_min(mi, mi.o2_capacity_l - lv["o2_left_L"], oh) == (
                pytest.approx(exp, abs=0.02))
            assert e["o2_margin_min_planning_rate"] == pytest.approx(
                (e["o2_left_L"] - e["o2_tasks_left_L"] - oh - 40.5) / mi.planning_rate_l_min,
                abs=0.05)
    traverse.write(res, "nom_104", tmp_path)
    assert json.loads((tmp_path / "timeline_nom_104.json").read_text()) == tl


def test_traverse_manifest_keys(plane_world, tmp_path):
    """WS6 audit: every route leg number and each station's access_dist_m has a key."""
    g, pad, p, tab, home, st = plane_world
    rst = [{**s, "access_dist_m": 2.5 * (i + 1)} for i, s in enumerate(st)]
    res = traverse.plan(g, tab, home, pad, rst, 390.0, 30.0, margin.inputs(p))
    traverse.write(res, "nom_104", tmp_path)
    keys = provenance.load_all()
    assert res.legs
    for lg in res.legs:
        i = lg["leg"]
        for q, u in (("t_min", "min"), ("o2_L", "L"), ("length_m", "m"), ("t_start_min", "min"),
                     ("t_end_min", "min")):  # fmt: skip
            e = keys[f"route.nom_104.leg.{i}.{q}"]
            assert e["value"] == lg[q] and e["units"] == u
            assert e["file"] == "route_nom_104.geojson"
    for s in rst:
        e = keys[f"timeline.nom_104.{s['id']}.access_dist_m"]
        assert e["value"] == s["access_dist_m"] and e["file"] == "timeline_nom_104.json"


def test_traverse_daylight_cuts_the_route(plane_world):
    """A tight daylight limit drops stations; the plan stays feasible."""
    g, pad, p, tab, home, st = plane_world
    full = traverse.plan(g, tab, home, pad, st, 390.0, 30.0, margin.inputs(p))
    mi = margin.inputs(p, t_dark_min=full.total_min * 0.6)
    res = traverse.plan(g, tab, home, pad, st, 390.0, 30.0, mi)
    assert res.value < full.value and res.order
    assert all(e["margin_min"] >= -0.01 for e in res.timeline if e["event"] != "turn_back")
    assert "daylight" in res.margin_terms


def test_trade_product(plane_world, tmp_path, settings):
    g, pad, p, tab, home, st = plane_world
    fields = {"con_104": dijkstra.return_field(
        g, physio.grade_table(physio.params("conservative", suit_kg=104,
                                            v1_rmse_deg=RMSE_STUB)), pad),
              "nom_104": home}  # fmt: skip
    tt = scenarios.trade_product(g, pad, fields, {104: home.t_min}, st, settings,
                                 public=tmp_path)  # fmt: skip
    validate(tt, "trade_table.schema.json")
    assert tt["rows"] == [30, 60] and tt["cols"] == load("crew")["suit_masses_kg"]
    c30, c60 = tt["cells"][0][1], tt["cells"][1][1]
    t_at = {s["id"]: float(fields["con_104"].t_min[s["rc"]]) for s in st}
    vals = {s["id"]: s["value"] for s in st}
    assert c60["science_value"] == pytest.approx(trade.science_value(t_at, vals, 60))
    assert c30["science_value"] <= c60["science_value"]
    assert tt["cells"][0][0]["science_value"] is None  # 80 kg not run: unknown stays null


def test_siting_scenario_is_the_rule_variant():
    """F8: the siting forward runs start at the access cells of the rule's scenario
    (site.yaml siting.score variant at the default suit), not the default scenario's."""
    assert scenarios.siting_scenario() == "con_104"


def test_siting_run(plane_world, tmp_path):
    g, pad, p, tab, home, st = plane_world
    doc = siting.run(g, st, RMSE_STUB, tmp_path / "engine", tmp_path / "public")
    validate(doc, "pad.schema.json")
    assert doc["proposal"]["adopted"] is False
    assert (tmp_path / "public/siting.png").exists() and (tmp_path / "engine/siting.tif").exists()
    meta = json.loads((tmp_path / "public/siting_png.json").read_text())
    assert len(meta["coordinates"]) == 4


# ------------------------------------------------------------------ CLI end to end


def _write_tif(path, arr, grid, dtype, nodata, res=None, x0=None, y0=None):
    from affine import Affine

    res = res or grid.res_m
    t = Affine(res, 0, grid.x0 if x0 is None else x0, 0, -res, grid.y0 if y0 is None else y0)
    with rasterio.open(path, "w", driver="GTiff", height=arr.shape[0], width=arr.shape[1],
                       count=1, dtype=dtype, crs=grid.crs, transform=t, nodata=nodata) as ds:
        ds.write(arr.astype(dtype), 1)  # fmt: skip


def test_main_on_synthetic_terrain(tmp_path):
    """make engine path: WS1-shaped inputs (dummy world) -> every product validates."""
    from pipeline.engine.geo import lonlat_of_xy
    from tools.validate_contracts import main as validate_tree

    grid, pad, _ = dummy_world(3.0, half_m=700.0)
    terr = tmp_path / "terrain"
    terr.mkdir()
    _write_tif(terr / "elev_3m.tif", np.nan_to_num(grid.elev, nan=-32767), grid, "float32",
               -32767)  # fmt: skip
    _write_tif(terr / "maxslope_3m.tif", np.nan_to_num(grid.maxslope, nan=-1), grid, "float32",
               -1)  # fmt: skip
    _write_tif(terr / "cellstate_3m.tif", grid.cellstate, grid, "uint8", 255)
    ridge = np.zeros((grid.shape[0] * 3, grid.shape[1] * 3), np.float32)
    ridge[:, 600] = 1.0  # one 1 m ridge column
    _write_tif(terr / "ridge_index.tif", ridge, grid, "float32", -9999, res=1.0)
    st = []
    for i, (r, c) in enumerate([(pad[0] - 80, pad[1] + 10), (pad[0] + 60, pad[1] - 40)]):
        lon, lat = lonlat_of_xy(*grid.xy_of_rc(r, c), grid.crs)
        st.append({"id": f"S{i + 1}", "name": f"Test {i + 1}", "lon": round(float(lon), 6),
                   "lat": round(float(lat), 6), "value": 0.5 + 0.1 * i, "objective": "",
                   "tasks": [], "dwell_min": 30, "t_home_min": {}, "in_partner_line": None,
                   "card": f"cards/S{i + 1}.json"})  # fmt: skip
    (terr / "stations.json").write_text(json.dumps(st))
    v1 = tmp_path / "v1.json"
    v1.write_text(json.dumps({"n": 10, "bias_deg": 0.1, "rmse_deg": RMSE_STUB, "r": 0.9,
                              "thresholds_deg": [10, 20], "confusion": {}}))  # fmt: skip
    out = tmp_path / "engine"
    rc = scenarios.main(["--terrain", str(terr), "--out", str(out), "--v1-json", str(v1),
                         "--scenarios", "nom_104", "con_104", "opt_104", "--siting",
                         "--no-conditions"])  # fmt: skip
    assert rc == 0
    pub = out / "public"
    for rel in ("scenarios/index.json", "scenarios/nom_104/isochrones.geojson",
                "scenarios/bands_104.geojson", "scenarios/nom_104/edges.geojson",
                "scenarios/nom_104/partner.geojson", "stations.json", "route_nom_104.geojson",
                "timeline_nom_104.json", "trade_table.json", "pad.json", "siting.png"):
        assert (pub / rel).exists(), rel  # fmt: skip
    # card timeline fragments (merged into cards/{S}.json by make web, not web files themselves)
    frag = json.loads((pub / "cards/S1.timeline.json").read_text())
    assert set(frag["timeline"]) == {"arrive", "leave", "turn_back"}
    assert frag["drag_note"] == load("haul")["drag_note"]  # SPEC F10 / D20 card note
    (pub / "cards").rename(tmp_path / "cards_fragments")
    assert validate_tree(["--data", str(pub), "--dummy", str(tmp_path / "none")]) == 0
    recs = json.loads((pub / "stations.json").read_text())
    assert all(r["t_home_min"]["nom_104"] is not None for r in recs)
    summ = json.loads((out / "summary.json").read_text())
    assert summ["routes"]["nom_104"]["order"]
    # F8 (C 14:58): pad.json's pad is pad_default; the siting result is only a proposal
    cfg = load("site")["pad_default"]
    pj = json.loads((pub / "pad.json").read_text())
    assert (pj["pad"]["lon"], pj["pad"]["lat"]) == (cfg["lon"], cfg["lat"])
    assert pj["proposal"]["adopted"] is False
    # --siting-only re-runs F8 + pad.json alone (one forward field set, no other product)
    (pub / "pad.json").unlink()
    before = (pub / "stations.json").stat().st_mtime_ns
    rc = scenarios.main(["--terrain", str(terr), "--out", str(out), "--v1-json", str(v1),
                         "--siting-only"])  # fmt: skip
    assert rc == 0
    assert json.loads((pub / "pad.json").read_text()) == pj
    assert (pub / "stations.json").stat().st_mtime_ns == before
    assert json.loads((out / "summary.json").read_text())["siting"]["pad"] == pj["pad"]


def test_conditions_inputs(monkeypatch):
    """CLI values win; otherwise WS4's margin_inputs (storm or latest tau); off -> None."""
    import pipeline.conditions.margins as ws4

    calls = []

    def fake(observer=None, dose="storm"):
        calls.append(dose)
        return {"t_dark_min": 500.0, "t_dark_source": "clock", "tau_dose_min": 80.0,
                "tau_dose_source": "rad", "eva_start_utc": "2026-11-14T10:51:18Z"}  # fmt: skip

    monkeypatch.setattr(ws4, "margin_inputs", fake)
    c = scenarios.conditions_inputs(None, None, "storm", True)
    assert (c["t_dark_min"], c["tau_dose_min"]) == (500.0, 80.0) and calls == ["storm"]
    assert c["tau_dose_source"] == "WS4: rad"
    c = scenarios.conditions_inputs(300.0, None, "latest", True)
    assert (c["t_dark_min"], c["t_dark_source"], c["tau_dose_min"]) == (300.0, "CLI", 80.0)
    assert calls[-1] == "latest"
    c = scenarios.conditions_inputs(None, None, "storm", False)
    assert c["t_dark_min"] is None and c["tau_dose_min"] is None
