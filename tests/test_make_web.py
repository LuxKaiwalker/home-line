"""KATs for tools/make_web.py (`make web`, owner C): tile math, TileJSON, cell-state encoding,
refusals (dummy, synthetic, pre-H0), missing report, basemap budget, end-to-end on a tmp tree."""

from __future__ import annotations

import io
import json
import math
import os
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest
import yaml
from jsonschema import Draft202012Validator
from PIL import Image

from tools import make_web as mw

REPO = Path(__file__).resolve().parent.parent
CONTRACTS = REPO / "contracts"
SITE = yaml.safe_load((REPO / "config" / "site.yaml").read_text())
H0 = datetime(2026, 11, 14, 8, 0, tzinfo=UTC)
SETTINGS = {"format": "webp", "quality": 80, "method": 0, "maxzoom": 18, "budget_mb": 50,
            "tile_size_px": 256, "attribution": "HiRISE: NASA/JPL/University of Arizona"}


def schema(name: str) -> Draft202012Validator:
    return Draft202012Validator(json.loads((CONTRACTS / name).read_text()))


def errors(name: str, doc) -> list[str]:
    return [e.message for e in schema(name).iter_errors(doc)]


# --------------------------------------------------------------------------- tile math


def test_tile_lonlat_world_tile():
    w, s, e, n = mw.tile_lonlat(0, 0, 0)
    assert (w, e) == (-180.0, 180.0)
    assert n == pytest.approx(85.0511287798, abs=1e-9) and s == pytest.approx(-n)


def test_tile_lonlat_z1_south_east():
    assert mw.tile_lonlat(1, 1, 1) == pytest.approx((0.0, -85.0511287798, 180.0, 0.0))


def test_tilejson_bounds_and_zoom_bounds():
    """z1 world (4 tiles), z2 world (16 tiles) = full; z3 one tile = partial (focus only)."""
    tiles = ([(1, x, y) for x in (0, 1) for y in (0, 1)]
             + [(2, x, y) for x in range(4) for y in range(4)] + [(3, 4, 4)])
    doc = mw.tilejson_for(tiles, SETTINGS, "src")
    assert doc["minzoom"] == 1 and doc["maxzoom"] == 3
    assert doc["bounds"] == pytest.approx([-180, -85.051129, 180, 85.051129])
    assert doc["zoom_bounds"] == {"3": pytest.approx([0.0, -40.979898, 45.0, 0.0], abs=1e-5)}
    assert doc["tile_count"] == {"1": 4, "2": 16, "3": 1}
    assert doc["tiles"] == ["tiles/basemap/{z}/{x}/{y}.webp"]
    assert errors("tilejson.schema.json", doc) == []


# --------------------------------------------------------------------------- cell states


def decode(png: bytes) -> np.ndarray:
    return np.asarray(Image.open(io.BytesIO(png)).convert("RGBA")).astype(int)


def test_cellstate_encoding_round_trip():
    state = np.array([[0, 1], [2, 255]], dtype=np.uint8)
    png, pct = mw.encode_cellstate(state)
    rgba = decode(png)
    counts = rgba[..., 0] * 256 + rgba[..., 1]
    assert rgba[..., 3].tolist() == [[255, 255], [0, 0]]  # A = 0 unknown (2 and any other code)
    assert counts[rgba[..., 3] == 255].tolist() == [0, 1]
    assert (rgba[..., 2] == 0).all()
    assert pct == {"assessed": 25.0, "blocked": 25.0, "unknown": 50.0}


def test_lonlat_bounds_eqc_known_answer():
    """eqc: x = R cos(lat_ts) (lon - lon_0), y = R lat, so a 3,000 m wide raster spans
    3000 / (R cos 4.8 deg) rad of longitude and 1,500 m tall spans 1500 / R rad of latitude."""
    from rasterio.transform import Affine

    r = SITE["crs"]["mars_radius_m"]
    t = Affine(3.0, 0, 0.0, 0, -3.0, -284874.0)
    b = mw.lonlat_bounds(t, 1000, 500, SITE)
    dlon = math.degrees(3000 / (r * math.cos(math.radians(4.8))))
    assert b[0] == pytest.approx(137.39, abs=1e-6)
    assert b[2] - b[0] == pytest.approx(dlon, abs=2e-6)
    assert b[3] - b[1] == pytest.approx(math.degrees(1500 / r), abs=2e-6)
    assert b[3] == pytest.approx(math.degrees(-284874.0 / r), abs=1e-6)


# --------------------------------------------------------------------------- fixtures


def write_tile(path: Path, rgb=(120, 90, 60)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(len(str(path)))
    arr = np.clip(rng.normal(rgb, 25, (256, 256, 3)), 0, 255).astype(np.uint8)
    Image.fromarray(arr, "RGB").save(path)


def write_cellstate_tif(path: Path) -> None:
    import rasterio
    from rasterio.transform import Affine

    state = np.zeros((40, 50), dtype=np.uint8)
    state[:10, :] = 1
    state[30:, 40:] = 2
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", driver="GTiff", height=40, width=50, count=1, dtype="uint8",
                       crs=SITE["crs"]["analysis_proj"],
                       transform=Affine(3.0, 0, -100.0, 0, -3.0, -284800.0)) as ds:
        ds.write(state, 1)


def entry(file: str, value=1.0) -> dict:
    return {"value": value, "units": "1", "file": file, "script": "pipeline/x.py",
            "commit": "abc", "utc": "2026-11-14T10:00:00Z"}


@pytest.fixture
def tree(tmp_path: Path) -> dict[str, Path]:
    interim = tmp_path / "interim"
    rad = json.loads((REPO / "web/public/data-dummy/conditions/rad.json").read_text())
    rad.pop("dummy", None)
    (interim / "conditions").mkdir(parents=True)
    (interim / "conditions" / "rad.json").write_text(json.dumps(rad))
    for x, y in ((0, 0), (0, 1)):
        write_tile(interim / "terrain/tiles/basemap/13" / str(x) / f"{y}.png")
    write_tile(interim / "terrain/tiles/basemap/14/0/0.png")
    write_cellstate_tif(interim / "terrain" / "cellstate_3m.tif")
    (interim / "terrain" / "manifest_pending.json").write_text(
        json.dumps({"coreg.dx_m": entry("validation/coreg.json", 0.0)}))
    frags = interim / "manifest"
    frags.mkdir()
    (frags / "pipeline__conditions__rad.json").write_text(
        json.dumps({"rad.baseline_uGy_day": entry("conditions/rad.json", 152.3)}))
    dummy = tmp_path / "dummy"
    dummy.mkdir()
    public = tmp_path / "public"
    public.mkdir()
    (public / ".gitkeep").write_text("")
    (public / "stale.json").write_text("{}")
    return {"interim": interim, "public": public, "dummy": dummy, "frags": frags,
            "rec": tmp_path / "rec"}


def run(tree, **kw) -> tuple[int, list[str]]:
    lines: list[str] = []
    rc = mw.run(tree["interim"], tree["public"], dummy_tree=tree["dummy"],
                settings=kw.pop("settings", SETTINGS), site=SITE, h0=H0,
                record_dir=tree["rec"], out=lines.append, **kw)
    return rc, lines


# --------------------------------------------------------------------------- plan


def test_plan_missing_grouped_by_owner(tree):
    p = mw.plan(tree["interim"], settings=SETTINGS, dummy_tree=tree["dummy"], h0=H0)
    owners = {o for o, _, _ in p.missing}
    assert "WS2" in owners and "WS7" in owners and "WS4" in owners  # clock/rems/donki missing
    assert ("WS4", "conditions/clock.json", "data/interim/conditions/clock.json") in p.missing
    assert {c.dst.as_posix() for c in p.copies if c.kind == "copy"} == {"conditions/rad.json"}
    assert len(p.tiles) == 3 and not p.refused


@pytest.mark.parametrize("flag", ["dummy", "synthetic"])
def test_plan_refuses_flagged_json(tree, flag):
    (tree["interim"] / "vo").mkdir()
    (tree["interim"] / "vo" / "probe.json").write_text(json.dumps({flag: True}))
    p = mw.plan(tree["interim"], settings=SETTINGS, dummy_tree=tree["dummy"], h0=H0)
    assert any(f'"{flag}": true' in r for r in p.refused)


def test_plan_refuses_pre_h0_source(tree):
    src = tree["interim"] / "conditions" / "rad.json"
    t = datetime(2026, 11, 13, 12, tzinfo=UTC).timestamp()
    os.utime(src, (t, t))
    p = mw.plan(tree["interim"], settings=SETTINGS, dummy_tree=tree["dummy"], h0=H0)
    assert any("before H0" in r for r in p.refused)


def test_plan_skips_tiles_above_maxzoom(tree):
    p = mw.plan(tree["interim"], settings={**SETTINGS, "maxzoom": 13},
                dummy_tree=tree["dummy"], h0=H0)
    assert len(p.tiles) == 2 and any("above maxzoom 13" in s for s in p.skipped)


# --------------------------------------------------------------------------- run


def test_run_end_to_end(tree):
    rc, lines = run(tree)
    pub = tree["public"]
    assert rc == 0, "\n".join(lines)
    assert not (pub / "stale.json").exists() and (pub / ".gitkeep").exists()
    assert (pub / "conditions/rad.json").is_file()
    assert sorted(p.relative_to(pub).as_posix() for p in pub.glob("tiles/basemap/*/*/*")) == [
        "tiles/basemap/13/0/0.webp", "tiles/basemap/13/0/1.webp", "tiles/basemap/14/0/0.webp"]
    tj = json.loads((pub / mw.TILEJSON).read_text())
    assert errors("tilejson.schema.json", tj) == [] and tj["maxzoom"] == 14
    cs = json.loads((pub / mw.CELLSTATE_JSON).read_text())
    assert errors("cellstate.schema.json", cs) == []
    assert (cs["width"], cs["height"], cs["res_m"], cs["variant"]) == (50, 40, 3.0, "nominal")
    assert cs["pct"] == {"assessed": 70.0, "blocked": 25.0, "unknown": 5.0}
    rgba = decode((pub / mw.CELLSTATE_PNG).read_bytes())
    assert rgba.shape == (40, 50, 4) and (rgba[30:, 40:, 3] == 0).all()
    m = json.loads((pub / "manifest.json").read_text())
    assert m["dummy"] is False
    assert {"coreg.dx_m", "rad.baseline_uGy_day", "terrain.cellstate.pct.unknown"} <= set(m)
    src_t = (tree["interim"] / "conditions/rad.json").stat().st_mtime
    assert (pub / "conditions/rad.json").stat().st_mtime == pytest.approx(src_t)
    assert any(line.startswith("  WS2: 0 files present") for line in lines)


def test_run_drops_top_zoom_over_budget(tree):
    rc, lines = run(tree)
    assert rc == 0, "\n".join(lines)
    z = {k: sum(p.stat().st_size for p in tree["public"].glob(f"tiles/basemap/{k}/*/*.webp"))
         for k in (13, 14)}
    budget_mb = (z[13] + z[14] / 2) / 1e6  # z13 fits, z13 + z14 does not
    rc, lines = run(tree, settings={**SETTINGS, "budget_mb": budget_mb})
    assert rc == 0, "\n".join(lines)
    assert any("dropped z14" in s for s in lines)
    tj = json.loads((tree["public"] / mw.TILEJSON).read_text())
    assert tj["maxzoom"] == 13 and tj["tile_count"] == {"13": 2} and tj["zoom_bounds"] == {}
    assert not (tree["public"] / "tiles/basemap/14").exists()


def test_run_budget_below_one_zoom_fails(tree):
    with pytest.raises(RuntimeError, match="one zoom level alone"):
        run(tree, settings={**SETTINGS, "budget_mb": 1e-6})


def test_run_refuses_dummy_manifest_fragment(tree):
    bad = entry("x.json") | {"script": "tools/make_dummy.py", "commit": "dummy"}
    (tree["frags"] / "tools__make_dummy.json").write_text(json.dumps({"x.y": bad}))
    rc, lines = run(tree)
    assert rc == 1 and (tree["public"] / "stale.json").exists()  # public tree untouched
    assert any("dummy entries" in s for s in lines)


def test_run_ws1_fragment_wins_over_pending(tree):
    (tree["frags"] / mw.WS1_FRAGMENT).write_text(
        json.dumps({"coreg.dx_m": entry("validation/coreg.json", 0.0)}))
    rc, lines = run(tree)
    assert rc == 0, "\n".join(lines)  # no duplicate key: pending is not bridged
    assert not any("bridge" in s for s in lines)


def test_run_skip_owner_leaves_files_and_manifest_entries_out(tree):
    (tree["frags"] / "pipeline__conditions__rad.json").write_text(json.dumps({
        "rad.baseline_uGy_day": entry("conditions/rad.json", 152.3),
        "x.other": entry("vo/probe.json")}))
    rc, lines = run(tree, skip_owners=("WS4",))
    assert rc == 0, "\n".join(lines)
    assert not (tree["public"] / "conditions").exists()
    m = json.loads((tree["public"] / "manifest.json").read_text())
    assert "rad.baseline_uGy_day" not in m and "x.other" in m
    assert not any(line.startswith("  WS4:") for line in lines)


def test_dangling_references(tmp_path):
    pub = tmp_path
    (pub / "scenarios" / "a").mkdir(parents=True)
    (pub / "scenarios" / "a" / "isochrones.geojson").write_text("{}")
    (pub / "scenarios" / "index.json").write_text(json.dumps({"dummy": False, "scenarios": [
        {"id": "a", "files": {"isochrones": "scenarios/a/isochrones.geojson",
                              "partner": "scenarios/b/partner.geojson"}}]}))
    (pub / "stations.json").write_text(json.dumps([{"id": "S1", "card": "cards/S1.json"}]))
    assert mw.dangling(pub) == ["scenarios/b/partner.geojson (named in scenarios/index.json a)",
                                "cards/S1.json (named in stations.json S1)"]
