"""I2: browser fields for the D21 picker pads (tools/make_pad_fields.py).

Known answers on synthetic inputs (row merge never changes an existing row, the in-memory field
encodes to the same bytes as WS2's raster path), then checks of the committed web tree: the added
rows, the PNGs decoded with the web decoder's rules (web/src/hud/fields.ts), the pad cell and the
stations against the engine's published per-pad timelines, and that nothing existing changed.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
from jsonschema import Draft202012Validator

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))

import make_pad_fields as mpf  # noqa: E402

from pipeline.export import fields_png as fp  # noqa: E402

WEB = REPO / "web" / "public" / "data"
SCHEMA = json.loads((REPO / "contracts" / "fields_index.schema.json").read_text())
PADS = ("rank2", "rank3", "rank4")
SC = "nom_104"


# ------------------------------------------------------------------------- known answers ----
def _idx(fields):
    return {"dummy": False, "bounds": [0.0, 0.0, 1.0, 1.0], "width": 4, "height": 4,
            "res_m": 5.0, "fields": fields}


def test_merge_adds_rows_and_keeps_old_lines_byte_identical():
    old = _idx({"nom_104/t_home": {"file": "fields/nom_104/t_home.png", "scale": 0.1,
                                   "units": "min", "scenario": "nom_104"},
                "slope": {"file": "fields/shared/slope.png", "scale": 0.01, "units": "deg",
                          "scenario": None}})
    row = {"file": "fields/pads/rank2/nom_104/t_home.png", "scale": 0.1, "units": "min",
           "scenario": "nom_104", "pad": "rank2", "lon": 1.0, "lat": 2.0}
    new = mpf.merged_index(old, {"pads/rank2/nom_104/t_home": row})
    assert list(new["fields"]) == ["nom_104/t_home", "pads/rank2/nom_104/t_home", "slope"]
    a, b = mpf.index_text(old).splitlines(), mpf.index_text(new).splitlines()
    # only added lines: the old text is a subsequence of the new one
    it = iter(b)
    assert all(line in it for line in a)
    assert len(b) > len(a)
    Draft202012Validator(SCHEMA).validate(new)
    # rerun with the same row: identical; a changed existing row: refused
    assert mpf.merged_index(new, {"pads/rank2/nom_104/t_home": row}) == new
    with pytest.raises(mpf.RowConflict):
        mpf.merged_index(new, {"nom_104/t_home": {**old["fields"]["nom_104/t_home"],
                                                  "scale": 0.2}})


def test_manifest_merge_keeps_existing_rows():
    e = {"value": 1.0, "units": "%", "file": "f.png", "script": "s", "commit": "a", "utc": "x"}
    old = {"dummy": False, "a.b": e}
    new = mpf.merged_manifest(old, {"a.b": {**e, "commit": "b", "utc": "y"},
                                    "fields.pads/rank2/nom_104/t_home.max": e})
    assert new["a.b"] == e  # same number: the old row is kept byte for byte
    assert list(new) == ["dummy", "a.b", "fields.pads/rank2/nom_104/t_home.max"]
    with pytest.raises(mpf.RowConflict):
        mpf.merged_manifest(old, {"a.b": {**e, "value": 2.0}})


def test_in_memory_field_encodes_like_ws2_raster(tmp_path):
    """as_raster_values == WS2's float32 raster read back by fields_png._read_tif."""
    pytest.importorskip("rasterio")
    from rasterio.transform import from_origin

    from pipeline.engine.scenarios import write_raster

    class G:
        crs = "+proj=eqc +R=3396190 +units=m +no_defs"
        transform = from_origin(100.0, 200.0, 3.0, 3.0)

    rng = np.random.default_rng(1)
    t = rng.uniform(0, 300, (40, 50))
    t[3, 4] = np.inf  # unreached
    t[5, 6] = 0.0
    t[7, 8] = 12.25  # a half step: float32 vs float64 rounding must agree with the raster path
    write_raster(tmp_path / "t.tif", t.astype(np.float32), G, np.float32(np.nan))
    a, nw, res = fp._read_tif(tmp_path / "t.tif")
    shape = (20, 24)
    via_tif = fp.sample_centres(a, nw, res, (101.0, 199.0), 5.0, shape)
    mem = fp.sample_centres(mpf.as_raster_values(t), (100.0, 200.0), 3.0, (101.0, 199.0), 5.0,
                            shape)
    assert fp.encode_png(via_tif, 0.1, compress_level=9) == fp.encode_png(mem, 0.1,
                                                                         compress_level=9)


def test_pixel_of_matches_web_decoder_rule():
    idx = _idx({})
    assert mpf.pixel_of(idx, 0.0, 1.0) == (0, 0)  # NW corner
    assert mpf.pixel_of(idx, 0.99, 0.01) == (3, 3)
    assert mpf.pixel_of(idx, 1.0, 0.5) is None  # east edge is outside (floor = width)


# --------------------------------------------------------------------- committed web tree ----
INDEX = json.loads((WEB / "fields" / "index.json").read_text())
MANIFEST = json.loads((WEB / "manifest.json").read_text())
HAVE = all(mpf.key_of(p, SC, "t_home") in INDEX["fields"] for p in PADS)
need_rows = pytest.mark.skipif(not HAVE, reason="no picker-pad rows in fields/index.json yet")


def _pads_index():
    return {r["id"]: r for r in json.loads((WEB / mpf.PADS_INDEX).read_text())["pads"]}


@need_rows
def test_rows_shape_like_the_official_entries():
    Draft202012Validator(SCHEMA).validate(INDEX)
    pads = _pads_index()
    for pid in PADS:
        for name in mpf.NAMES:
            e = INDEX["fields"][mpf.key_of(pid, SC, name)]
            off = INDEX["fields"][f"{SC}/{name}"]
            assert e["file"] == f"fields/pads/{pid}/{SC}/{name}.png"
            assert (WEB / e["file"]).is_file()
            assert (e["scale"], e["units"], e["scenario"]) == (off["scale"], off["units"], SC)
            assert (e["pad"], e["lon"], e["lat"]) == (pid, pads[pid]["lon"], pads[pid]["lat"])
            for k in ("bounds", "width", "height", "res_m", "stencil"):
                assert e.get(k) == off.get(k), (pid, name, k)  # pointer: same 3 m grid
            assert (WEB / e["file"]).stat().st_size < 1.25 * (WEB / off["file"]).stat().st_size
            for suf in ("sha256", "known_pct") + (("max",) if name != "pointer" else ()):
                m = MANIFEST[f"fields.{mpf.key_of(pid, SC, name)}.{suf}"]
                assert m["file"] == e["file"] and m["script"] == mpf.SCRIPT


def test_every_recorded_field_png_hash_matches_its_file():
    """Every fields.*.sha256 row (the official fields and the pad fields) hashes its file: the
    existing PNGs are byte-identical to what the unchanged manifest rows recorded."""
    rows = {k: v for k, v in MANIFEST.items() if k.startswith("fields.") and k.endswith(".sha256")}
    assert any(k.startswith(f"fields.{SC}/") for k in rows)
    for k, v in rows.items():
        assert hashlib.sha256((WEB / v["file"]).read_bytes()).hexdigest() == v["value"], k


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True,
                          check=True).stdout


def _base() -> str | None:
    try:
        return _git("merge-base", "HEAD", "origin/main").strip() or None
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


@pytest.mark.skipif(_base() is None, reason="no git checkout with origin/main")
def test_existing_data_unchanged_against_main():
    """vs the merge base with origin/main: in web/public/data only new files, plus added rows
    in fields/index.json and manifest.json (every old row equal, no line removed)."""
    base = _base()
    st = [ln.split("\t") for ln in _git("diff", "--name-status", base, "--",
                                        "web/public/data").splitlines()]
    for s, path, *_ in st:
        if s == "A":
            assert path.startswith("web/public/data/fields/pads/"), path
        else:
            assert s == "M" and path in ("web/public/data/fields/index.json",
                                         "web/public/data/manifest.json"), (s, path)
            diff = _git("diff", "-U0", base, "--", path).splitlines()
            removed = [d for d in diff if d.startswith("-") and not d.startswith("---")]
            assert removed == [], (path, removed[:3])
    old_idx = json.loads(_git("show", f"{base}:web/public/data/fields/index.json"))
    for k, v in old_idx.items():
        if k != "fields":
            assert INDEX[k] == v
    for k, v in old_idx["fields"].items():
        assert INDEX["fields"][k] == v, k
    assert all(k.startswith("pads/") for k in set(INDEX["fields"]) - set(old_idx["fields"]))
    for path in ("tests/fixtures/values_baseline.json",):  # value snapshot: rows added only
        diff = _git("diff", "-U0", base, "--", path).splitlines()
        assert not [d for d in diff if d.startswith("-") and not d.startswith("---")], path
        assert all(d[1:].strip().startswith('"manifest:fields.pads/') for d in diff
                   if d.startswith("+") and not d.startswith("+++")), path
    old_man = json.loads(_git("show", f"{base}:web/public/data/manifest.json"))
    for k, v in old_man.items():
        assert MANIFEST[k] == v, k
    assert all(k.startswith("fields.pads/") for k in set(MANIFEST) - set(old_man))


def _decode(pid: str, name: str = "t_home") -> np.ndarray:
    e = INDEX["fields"][mpf.key_of(pid, SC, name)]
    return fp.decode_png(WEB / e["file"], e["scale"])


@need_rows
@pytest.mark.parametrize("pid", PADS)
def test_pad_cell_is_home(pid):
    t = _decode(pid)
    assert t.shape == (INDEX["height"], INDEX["width"])
    r = INDEX["fields"][mpf.key_of(pid, SC, "t_home")]
    px = mpf.pixel_of(INDEX, r["lon"], r["lat"])
    # the 5 m pixel samples the 3 m cell under its centre, at most ~4 m from the pad cell
    assert 0.0 <= t[px] <= 0.2
    assert 0.0 <= np.nanmin(t) <= 0.2
    o2 = _decode(pid, "o2_home")
    assert np.array_equal(np.isfinite(o2), np.isfinite(t))
    assert 0.0 <= o2[px] <= 0.5
    # the pointer stops at the pad: the pad's 3 m cell has no move (A = 0)
    pe = INDEX["fields"][mpf.key_of(pid, SC, "pointer")]
    ptr = fp.decode_png(WEB / pe["file"], 1)
    w, s, e, n = pe["bounds"]
    col = int(np.floor((r["lon"] - w) / (e - w) * pe["width"]))
    row = int(np.floor((n - r["lat"]) / (n - s) * pe["height"]))
    assert np.isnan(ptr[row, col])
    # every reached cell 20..40 cells from the pad (a ring sample) walks home to the pad cell
    starts = [(row + dr, col + dc) for dr in range(-40, 41, 10) for dc in range(-40, 41, 10)
              if 20 <= max(abs(dr), abs(dc)) and np.isfinite(ptr[row + dr, col + dc])]
    assert len(starts) >= 10
    for r0, c0 in starts:
        path, why = fp.follow_pointer(ptr, pe["stencil"], r0, c0)
        assert (why, path[-1]) == ("stop", (row, col)), (r0, c0)


@need_rows
@pytest.mark.parametrize("pid", PADS)
def test_station_t_home_matches_published_timeline(pid):
    """Every station on the pad's published route (engine D21 run): T_home on arrival (the
    engine's 3 m field at the access cell) vs the decoded PNG at the access point."""
    rel = f"scenarios/pads/{pid}/"
    tl = json.loads((WEB / rel / f"timeline_{SC}.json").read_text())
    route = json.loads((WEB / rel / f"route_{SC}.geojson").read_text())
    start = {f["properties"]["from"]: f["geometry"]["coordinates"][0]
             for f in route["features"] if f["geometry"]["type"] == "LineString"}
    t = _decode(pid)
    arrive = [e for e in tl if e["event"] == "arrive"]
    assert len(arrive) >= 3
    for ev in arrive:
        lon, lat = start[ev["station"]]
        v = t[mpf.pixel_of(INDEX, lon, lat)]
        assert np.isfinite(v), ev["station"]
        # within one encoding step (0.1 min; measured <= 0.05: the 5 m pixel samples the 3 m
        # cell under its centre, at most ~4 m from the access cell)
        assert abs(v - ev["t_home_min"]) <= 0.1 + 1e-9, (pid, ev["station"], v, ev["t_home_min"])


INTERIM = REPO / "data" / "interim"


@need_rows
@pytest.mark.skipif(not (INTERIM / "engine" / "pads" / "rank2" / SC / "t_home.tif").exists(),
                    reason="no WS2 D21 pad rasters (data/interim/engine/pads)")
@pytest.mark.parametrize("pid", PADS)
def test_same_bytes_as_fields_png_on_ws2_d21_pad_rasters(pid):
    """WS2's D21 run wrote each picker pad's return field (padpick.write_products); encoded by
    fields_png's own path (tif -> sample_centres -> encode) they give exactly the committed PNGs."""
    g = json.loads((INTERIM / "terrain" / "grid.json").read_text())["grids"]["fields_5m"]
    shape, nw5 = (g["height"], g["width"]), tuple(g["nw_xy"])
    for name in ("t_home", "o2_home"):
        a, nw, res = fp._read_tif(INTERIM / "engine" / "pads" / pid / SC / f"{name}.tif")
        e = INDEX["fields"][mpf.key_of(pid, SC, name)]
        b = fp.encode_png(fp.sample_centres(a, nw, res, nw5, g["res_m"], shape), e["scale"],
                          compress_level=9)
        assert b == (WEB / e["file"]).read_bytes(), (pid, name)
