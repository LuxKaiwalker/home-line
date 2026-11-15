"""Browser fields for the D21 picker pads (I2, instant browser path; D21 picker, F18/F19 encoding).

For every picker pad of ``scenarios/pads/index.json`` (default rank2, rank3, rank4) and its
scenario (the index ``scenario``, nom_104, default crew) this runs WS2's reverse Dijkstra exactly as
``pipeline.engine.padpick.full_run`` / ``scenarios.return_fields`` do (``dijkstra.return_field`` on
``grid.with_nogo(p.nogo_deg)`` with ``physio.grade_table(p)``, pad cell = ``scenarios.pad_rc`` of
the pad's lon/lat) and encodes the three fields the browser route planner reads with WS7's own
encoder and sampling (``pipeline.export.fields_png``: ``sample_centres``, ``write_field``,
``pointer_values``; the field passes through float32 as WS2's rasters do, so the official pad's
bytes would be reproduced exactly):

    fields/pads/{pad}/{scenario}/t_home.png    5 m index grid, scale 0.1 min
    fields/pads/{pad}/{scenario}/o2_home.png   5 m index grid, scale 0.01 L
    fields/pads/{pad}/{scenario}/pointer.png   WS2's native 3 m route grid + stencil

ADDITIVE ONLY (team lead 14:19 / clarification): no existing file changes. New rows are added to
``fields/index.json`` (keys ``pads/{pad}/{scenario}/{name}``, entry = the official shape plus
``pad``, ``lon``, ``lat``; the browser loads them with the same ``loadField`` / ``loadPointer``)
and to ``manifest.json`` (``fields.pads/{pad}/{scenario}/{name}.{sha256,known_pct,max}``, as
``fields_png`` records the official ones). An existing row is never changed: a row whose key
already exists must be equal (then it is kept byte for byte, so a rerun writes identical files),
otherwise the run stops before writing anything. Index rows are inserted in sorted key order with
the same JSON layout, so the old lines stay byte-identical.

Outputs: ``--out`` (default ``data/interim/export``, the ``make web`` source: PNGs + index rows +
the manifest fragment ``data/interim/manifest/tools__make_pad_fields.json``) and, with ``--web``
(default ``web/public/data``), the same PNGs and rows in the public tree. ``--no-web`` skips it.
A check report (pad cell T_home, every station's access cell T_home from the 3 m field vs the
decoded PNG) goes to ``<out>/fields/pads/report.json`` (interim only).

Run (heavy: three full-grid Dijkstras): ``make pad-fields`` or
``/tmp/hl-way/heavy uv run --no-sync python tools/make_pad_fields.py``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import sys
import time
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import numpy as np

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from pipeline.export import fields_png as fp  # noqa: E402

SCRIPT = "tools/make_pad_fields.py"
INTERIM = REPO / "data" / "interim"
WEB = REPO / "web" / "public" / "data"
PADS_INDEX = "scenarios/pads/index.json"
NAMES = ("t_home", "o2_home", "pointer")
DEFAULT_PADS = ("rank2", "rank3", "rank4")


class RowConflict(RuntimeError):
    """An existing index or manifest row would change (never allowed)."""


# ---------------------------------------------------------------------------- pure helpers ----
def key_of(pad: str, scenario: str, name: str) -> str:
    return f"pads/{pad}/{scenario}/{name}"


def as_raster_values(a: np.ndarray) -> np.ndarray:
    """What WS2's float raster holds and ``fields_png._read_tif`` reads back: float32, non-finite
    (unreached = inf) -> NaN (``scenarios.write_raster`` nodata), as float64."""
    v = np.asarray(a).astype(np.float32).astype(np.float64)
    v[~np.isfinite(v)] = np.nan
    return v


def merge_rows(old: Mapping[str, Any], new: Mapping[str, Any], what: str) -> dict[str, Any]:
    """``old`` plus ``new`` rows; an existing key must hold an equal row (kept as is)."""
    bad = [k for k, v in new.items() if k in old and old[k] != v]
    if bad:
        raise RowConflict(f"{what}: would change existing rows {bad[:5]} (refused, nothing "
                          "written)")
    out = dict(old)
    out.update({k: v for k, v in new.items() if k not in old})
    return out


def merged_index(old_idx: Mapping[str, Any], rows: Mapping[str, Any]) -> dict[str, Any]:
    """fields/index.json with ``rows`` added (sorted keys, as ``fields_png.build_index``)."""
    for k in ("bounds", "width", "height", "res_m"):
        if k not in old_idx:
            raise ValueError(f"fields/index.json lacks {k}")
    fields = merge_rows(old_idx["fields"], rows, "fields/index.json")
    return {**old_idx, "fields": {k: fields[k] for k in sorted(fields)}}


def index_text(idx: Mapping[str, Any]) -> str:
    return json.dumps(idx, indent=1) + "\n"  # fields_png.run's layout


def manifest_rows_equal(a: Mapping[str, Any], b: Mapping[str, Any]) -> bool:
    """Same recorded number (commit / utc are when, not what)."""
    return all(a.get(k) == b.get(k) for k in ("value", "units", "file", "script"))


def merged_manifest(old: Mapping[str, Any], rows: Mapping[str, Any]) -> dict[str, Any]:
    """manifest.json with ``rows`` added; an existing key must record the same number."""
    bad = [k for k, v in rows.items() if k in old and not manifest_rows_equal(old[k], v)]
    if bad:
        raise RowConflict(f"manifest.json: would change existing rows {bad[:5]} (refused)")
    out = dict(old)
    out.update({k: v for k, v in rows.items() if k not in old})
    dummy = out.pop("dummy", False)
    return {"dummy": dummy, **dict(sorted(out.items()))}


def manifest_text(m: Mapping[str, Any]) -> str:
    return json.dumps(m, indent=2, sort_keys=True, allow_nan=False) + "\n"  # manifest.py layout


def pixel_of(idx: Mapping[str, Any], lon: float, lat: float) -> tuple[int, int] | None:
    """The web decoder's FieldGrid.pixelOf (web/src/hud/fields.ts) on the index grid."""
    w, s, e, n = idx["bounds"]
    col = math.floor((lon - w) / (e - w) * idx["width"])
    row = math.floor((n - lat) / (n - s) * idx["height"])
    if col < 0 or row < 0 or col >= idx["width"] or row >= idx["height"]:
        return None
    return row, col


def manifest_values(rel: str, data: bytes, scale: float, units: str) -> dict[str, tuple]:
    """``{suffix: (value, units)}`` exactly as ``fields_png.write_field`` records them."""
    decoded = fp.decode_png(data, scale)
    known = decoded[np.isfinite(decoded)]
    out = {"sha256": (hashlib.sha256(data).hexdigest(), "sha256"),
           "known_pct": (round(100.0 * known.size / decoded.size, 2), "%")}
    if units not in fp.CATEGORICAL_UNITS:
        out["max"] = (round(float(known.max()), 6) if known.size else None, units)
    return out


# ------------------------------------------------------------------------------------ run ----
def pick_pads(pads_idx: Mapping[str, Any], ids: Sequence[str]) -> list[dict]:
    rows = {r["id"]: r for r in pads_idx["pads"]}
    out = []
    for pid in ids:
        r = rows.get(pid)
        if r is None:
            raise SystemExit(f"{PADS_INDEX} has no pad {pid!r}")
        if r.get("official"):
            raise SystemExit(f"{pid} is the official pad: its fields are fields/{{scenario}}/*")
        out.append(r)
    return out


def compute(interim: Path, pads: list[dict], scenario: str, log=print) -> dict[str, Any]:
    """Return fields + access cells per pad (the heavy part)."""
    from pipeline.engine import access, dijkstra, physio, stations
    from pipeline.engine.config import load
    from pipeline.engine.graph import load_ws1_grid
    from pipeline.engine.scenarios import pad_rc

    t0 = time.perf_counter()
    grid = load_ws1_grid(interim / "terrain")
    log(f"load_grid: {time.perf_counter() - t0:.1f} s")
    p = physio.scenario_params(scenario)
    gv, tab = grid.with_nogo(p.nogo_deg), physio.grade_table(p)
    st, _missing = stations.load_ws1_stations(interim / "terrain" / "stations.json")
    radius = float(load("variants")["route"]["access_radius_m"])
    out: dict[str, Any] = {"grid": grid, "pads": {}}
    for r in pads:
        t1 = time.perf_counter()
        rc = pad_rc(grid, (r["lon"], r["lat"]))
        f = dijkstra.return_field(gv, tab, rc)
        if not f.t_min[rc] == 0.0:
            raise RuntimeError(f"{r['id']}: T_home at the pad cell {rc} is {f.t_min[rc]}, not 0")
        stc = access.resolve(grid, {scenario: f}, [dict(x) for x in st], radius)
        acc = {s["id"]: s["access"][scenario] for s in stc}
        out["pads"][r["id"]] = {"rc": rc, "field": f, "access": acc}
        log(f"{r['id']}: return field at rc {rc} in {time.perf_counter() - t1:.1f} s")
    return out


def encode(interim: Path, comp: Mapping[str, Any], pads: list[dict], scenario: str,
           stage: Path) -> tuple[dict, dict]:
    """Write the PNGs under ``stage``/fields/pads/; return (index rows, manifest numbers)."""
    from pipeline.engine.graph import OFFSETS

    hud = fp._load_yaml("hud.yaml")
    grid_json = json.loads((interim / "terrain" / "grid.json").read_text())
    g5, g3 = grid_json["grids"]["fields_5m"], grid_json["grids"]["route_3m"]
    res5 = float(g5["res_m"])
    shape5 = (int(g5["height"]), int(g5["width"]))
    nw5 = (float(g5["nw_xy"][0]), float(g5["nw_xy"][1]))
    grid = comp["grid"]
    t = grid.transform
    nw3, res3 = (float(t.c), float(t.f)), float(t.a)
    h3, w3 = grid.shape
    if ((int(g3["width"]), int(g3["height"])) != (w3, h3) or not math.isclose(res3, g3["res_m"])
            or any(abs(a - b) > 1e-3 for a, b in zip(nw3, g3["nw_xy"], strict=True))):
        raise ValueError("WS2 routing grid is not grid.json route_3m")
    stencil = [[int(a), int(b)] for a, b in OFFSETS.tolist()]
    rows: dict[str, dict] = {}
    nums: dict[str, tuple] = {}
    for r in pads:
        pid = r["id"]
        f = comp["pads"][pid]["field"]
        extra = {"pad": pid, "lon": r["lon"], "lat": r["lat"]}
        vals = {
            "t_home": fp.sample_centres(as_raster_values(f.t_min), nw3, res3, nw5, res5, shape5),
            "o2_home": fp.sample_centres(as_raster_values(f.o2_l), nw3, res3, nw5, res5, shape5),
            "pointer": fp.pointer_values(np.asarray(f.ptr), len(stencil)),
        }
        for name in NAMES:
            key = key_of(pid, scenario, name)
            ex = dict(extra)
            if name == "pointer":
                ex.update({"bounds": [round(float(x), 6) for x in g3["bounds_lonlat"]],
                           "width": w3, "height": h3, "res_m": g3["res_m"], "stencil": stencil})
            e = fp.write_field(stage, key, vals[name], scenario, hud, extra=ex,
                               record_manifest=False)
            rows[key] = e
            data = (stage / e["file"]).read_bytes()
            for suf, v in manifest_values(e["file"], data, e["scale"], e["units"]).items():
                nums[f"fields.{key}.{suf}"] = (*v, e["file"])
    return rows, nums


def station_report(comp, pads, scenario, stage: Path, idx: Mapping[str, Any]) -> dict:
    """Pad cell and every station's access cell: 3 m engine T_home vs the decoded 5 m PNG."""
    rep: dict[str, Any] = {}
    for r in pads:
        pid = r["id"]
        t5 = fp.decode_png(stage / "fields" / "pads" / pid / scenario / "t_home.png", 0.1)
        px = pixel_of(idx, r["lon"], r["lat"])
        d = {"pad_rc_3m": list(comp["pads"][pid]["rc"]),
             "pad_png_t_home_min": float(t5[px]) if px else None, "stations": {}}
        for sid, a in sorted(comp["pads"][pid]["access"].items()):
            if a.rc is None:
                d["stations"][sid] = {"access": None, "reason": a.reason}
                continue
            q = pixel_of(idx, a.lon, a.lat)
            v = float(t5[q]) if q else None
            d["stations"][sid] = {
                "access_lon": a.lon, "access_lat": a.lat,
                "engine_t_home_min": round(float(a.t_home_min), 4),
                "png_t_home_min": None if v is None or not np.isfinite(v) else round(v, 4),
                "diff_min": None if v is None or not np.isfinite(v)
                else round(v - float(a.t_home_min), 4)}
        rep[pid] = d
    return rep


def publish(stage: Path, root: Path, rows: Mapping[str, Any], man_rows: Mapping[str, Any],
            pads: list[dict], scenario: str, *, write_manifest_json: bool) -> list[str]:
    """Copy the PNGs to ``root``/fields/pads/ and add the rows to its index (and manifest.json).
    Every check runs before the first write."""
    idx_path = root / "fields" / "index.json"
    new_idx_text = index_text(merged_index(json.loads(idx_path.read_text()), rows))
    man_path = root / "manifest.json"
    new_man_text = None
    if write_manifest_json:
        new_man_text = manifest_text(merged_manifest(json.loads(man_path.read_text()), man_rows))
    for r in pads:  # PNGs only ever under fields/pads/{pad}/{scenario}/
        dst = root / "fields" / "pads" / r["id"] / scenario
        dst.mkdir(parents=True, exist_ok=True)
        for name in NAMES:
            src = stage / "fields" / "pads" / r["id"] / scenario / f"{name}.png"
            if src.resolve() != (dst / f"{name}.png").resolve():
                shutil.copyfile(src, dst / f"{name}.png")
    changed = []
    if idx_path.read_text() != new_idx_text:
        idx_path.write_text(new_idx_text)
        changed.append(str(idx_path))
    if new_man_text is not None and man_path.read_text() != new_man_text:
        man_path.write_text(new_man_text)
        changed.append(str(man_path))
    return changed


def record_fragment(nums: Mapping[str, tuple], fragment_dir: Path | None) -> dict[str, Any]:
    """Manifest rows via pipeline.provenance (``make web`` merges the fragment); a key already in
    the fragment with the same number is kept (rerun = same bytes). Returns the rows."""
    from pipeline.provenance import manifest as mf

    frag_path = mf._fragment_dir(fragment_dir) / mf._fragment_name(SCRIPT)
    have = json.loads(frag_path.read_text()) if frag_path.exists() else {}
    rows = {}
    for k, (value, units, file) in sorted(nums.items()):
        want = {"value": value, "units": units, "file": file, "script": SCRIPT}
        if k in have and manifest_rows_equal(have[k], want):
            rows[k] = have[k]
        else:
            rows[k] = mf.record(k, value, units, file, SCRIPT, fragment_dir=fragment_dir)
    return rows


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--pads", nargs="*", default=list(DEFAULT_PADS))
    ap.add_argument("--interim", type=Path, default=INTERIM)
    ap.add_argument("--out", type=Path, default=None, help="default <interim>/export")
    ap.add_argument("--web", type=Path, default=WEB)
    ap.add_argument("--no-web", action="store_true")
    ap.add_argument("--fragments", type=Path, default=None,
                    help="manifest fragment dir (default data/interim/manifest)")
    a = ap.parse_args(argv)
    t0 = time.perf_counter()
    out = a.out or a.interim / "export"
    pads_idx = json.loads((a.web / PADS_INDEX).read_text())
    scenario = pads_idx["scenario"]
    pads = pick_pads(pads_idx, a.pads)
    comp = compute(a.interim, pads, scenario)
    stage = out  # PNGs land in the make-web source tree first
    rows, nums = encode(a.interim, comp, pads, scenario, stage)
    man_rows = record_fragment(nums, a.fragments)
    changed = publish(stage, out, rows, man_rows, pads, scenario, write_manifest_json=False)
    if not a.no_web:
        changed += publish(stage, a.web, rows, man_rows, pads, scenario,
                           write_manifest_json=True)
    idx = json.loads((out / "fields" / "index.json").read_text())
    rep = {"scenario": scenario, "pads": station_report(comp, pads, scenario, stage, idx),
           "sizes": {k: (stage / e["file"]).stat().st_size for k, e in rows.items()},
           "sha256": {k: v[0] for k, v in nums.items() if k.endswith(".sha256")},
           "run_s": round(time.perf_counter() - t0, 1)}
    (stage / "fields" / "pads" / "report.json").write_text(json.dumps(rep, indent=1) + "\n")
    for k, s in rep["sizes"].items():
        print(f"{k}: {s} bytes")
    for pid, d in rep["pads"].items():
        print(pid, "pad PNG T_home", d["pad_png_t_home_min"],
              {s: v.get("diff_min") for s, v in d["stations"].items()})
    print(f"changed: {changed or 'none'}; run {rep['run_s']} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
