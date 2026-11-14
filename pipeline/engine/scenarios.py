"""Scenario batch (F4-F6): return fields, isochrones, bands, edges, headline and the index.

Rasters go to data/interim/engine/{scenario}/ (t_home.tif min, o2_home.tif L, pointer.tif
int8 move index, see graph.OFFSETS; -1 = none). Web-facing files go to
data/interim/engine/public/ with the same relative paths as web/public/data/ (`make web` copies
them). Every displayed number goes through provenance.record.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import (
    access,
    cards,
    dijkstra,
    edges,
    envelope,
    haul,
    margin,
    physio,
    provenance,
    stations,
    trade,
    traverse,
)
from .config import ENGINE_DIR, INTERIM_DIR, load
from .geo import write_json, xy_of_lonlat
from .graph import Grid, load_ws1_grid
from .physio import MissingInput

SCRIPT = "pipeline/engine/scenarios.py"
PUBLIC = ENGINE_DIR / "public"


@dataclass
class Settings:
    isochrone_minutes: list[int]
    isochrone_fallback_step: int
    isochrone_budget_mb_gz: float
    simplify_m: float
    budgets: list[int]
    disc_speed_ms: float
    buffer_m: float
    v1_rmse_deg: float | None = None
    min_hole_m2: float = 0.0


def settings_from_config(v1_rmse_deg: float | None = None) -> Settings:
    """Every output setting from config (variants.yaml outputs, crew.yaml, site.yaml).

    The flat disc of the headline uses the anchor speed (0.98 m/s), as site.yaml
    planning_radius_m does ("flat 60-min disc at 0.98 m/s").
    """
    out = load("variants")["outputs"]
    iso = out["isochrone_minutes"]
    return Settings(
        isochrone_minutes=isochrone_levels(iso["min"], iso["max"], iso["step"]),
        isochrone_fallback_step=int(out["isochrone_fallback_step_min"]),
        isochrone_budget_mb_gz=float(out["isochrone_size_budget_mb_gz"]),
        simplify_m=float(out["simplify_tolerance_m"]),
        budgets=[int(b) for b in out["band_budgets_min"]],
        disc_speed_ms=float(load("crew")["anchor"]["speed_ms"]),
        buffer_m=float(load("site")["coverage"]["source_edge_buffer_m"]),
        v1_rmse_deg=v1_rmse_deg,
        min_hole_m2=float(out.get("display_min_hole_m2", 0.0)),
    )


def isochrone_levels(lo: int, hi: int, step: int) -> list[int]:
    """Contour minutes: multiples of ``step`` within [lo, hi] (step 1 -> 1..60; step 2 -> 2..60,
    so the 30/60-min budgets are always contours)."""
    return [m for m in range(int(lo), int(hi) + 1) if m % int(step) == 0]


def gz_mb(obj) -> float:
    """Size of the compact JSON, gzipped, in MB (10^6 bytes)."""
    import gzip
    import json

    raw = json.dumps(obj, separators=(",", ":")).encode()
    return len(gzip.compress(raw, compresslevel=9)) / 1e6


def isochrones_within_budget(grid: Grid, t_min, settings: Settings) -> tuple[dict, int, float]:
    """F5: 1-min isochrones unless they exceed the gz size budget, then the fallback step
    (its levels are a subset of the 1-min levels, so the features are reused). Holes below
    settings.min_hole_m2 are filled (display filter, C decision 2026-11-14 11:42).
    Returns (FeatureCollection, step used, gz MB)."""
    out = load("variants")["outputs"]["isochrone_minutes"]
    fc = envelope.isochrones(grid, t_min, settings.isochrone_minutes, settings.simplify_m,
                             settings.min_hole_m2)  # fmt: skip
    mb = gz_mb(fc)
    isochrones_within_budget.first_gz_mb = mb  # 1-min size, for the run summary
    step = int(out["step"])
    if mb > settings.isochrone_budget_mb_gz:
        step = settings.isochrone_fallback_step
        levels = set(isochrone_levels(out["min"], out["max"], step))
        missing = sorted(levels - {int(m) for m in settings.isochrone_minutes})
        feats = [f for f in fc["features"] if f["properties"]["minutes"] in levels]
        if missing:  # fallback level not in the 1-min set (not with the config values)
            feats += envelope.isochrones(grid, t_min, missing, settings.simplify_m,
                                         settings.min_hole_m2)["features"]  # fmt: skip
            feats.sort(key=lambda f: f["properties"]["minutes"])
        fc = {**fc, "features": feats}
        mb = gz_mb(fc)
    return fc, step, mb


def pad_rc(grid: Grid, lonlat: tuple[float, float] | None = None) -> tuple[int, int]:
    """Pad cell: lonlat if given, else site.yaml pad_default."""
    if lonlat is None:
        pad = load("site")["pad_default"]
        lonlat = (pad["lon"], pad["lat"])
    return grid.rc_of_xy(*xy_of_lonlat(lonlat[0], lonlat[1], grid.crs))


def runnable(sids, v1_rmse_deg: float | None) -> tuple[list[str], dict[str, str]]:
    """Split scenario ids into those that can run and those skipped with the MissingInput
    reason (the conservative variant needs WS6's V1 RMSE)."""
    ok, skipped = [], {}
    for sid in sids:
        try:
            physio.scenario_params(sid, v1_rmse_deg=v1_rmse_deg)
        except MissingInput as e:
            skipped[sid] = f"MissingInput: {e}"
            continue
        ok.append(sid)
    return ok, skipped


def v1_from_file(path: Path) -> dict:
    """WS6's V1 result (validation/v1.json): the slope RMSE that sets the conservative limit.
    Raises MissingInput if the file or its rmse_deg is missing."""
    import json

    path = Path(path)
    if not path.exists():
        raise MissingInput(f"V1 file {path} not found (WS6)")
    d = json.loads(path.read_text(encoding="utf-8"))
    if d.get("rmse_deg") is None:
        raise MissingInput(f"V1 file {path} has no rmse_deg")
    return {"rmse_deg": float(d["rmse_deg"]), "footprint_m": d.get("footprint_m"),
            "n": d.get("n"), "file": str(path)}  # fmt: skip


def write_raster(path: Path, arr: np.ndarray, grid: Grid, nodata) -> Path:
    import rasterio

    path.parent.mkdir(parents=True, exist_ok=True)
    data = np.where(np.isfinite(arr), arr, nodata) if arr.dtype.kind == "f" else arr
    with rasterio.open(
        path, "w", driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1,
        dtype=data.dtype, crs=grid.crs or None, transform=grid.transform, nodata=nodata,
        compress="deflate", tiled=True,
    ) as ds:  # fmt: skip
        ds.write(data, 1)
    return path


def return_fields(grid: Grid, pad, sids, settings: Settings, out_dir: Path = ENGINE_DIR,
                  ) -> dict[str, dijkstra.Field]:  # fmt: skip
    """One reverse Dijkstra per scenario on that variant's passability; writes the 3 rasters."""
    fields = {}
    for sid in sids:
        p = physio.scenario_params(sid, v1_rmse_deg=settings.v1_rmse_deg)
        g = grid.with_nogo(p.nogo_deg)
        f = dijkstra.return_field(g, physio.grade_table(p), pad)
        d = out_dir / sid
        write_raster(d / "t_home.tif", f.t_min.astype(np.float32), grid, np.float32(np.nan))
        write_raster(d / "o2_home.tif", f.o2_l.astype(np.float32), grid, np.float32(np.nan))
        write_raster(d / "pointer.tif", f.ptr, grid, -1)
        fields[sid] = f
    write_pointer_offsets(out_dir)
    return fields


def write_pointer_offsets(out_dir: Path) -> Path:
    """pointer.tif legend for WS7/WS9: value k -> next cell on the way home is
    (row + drow[k], col + dcol[k]); -1 = pad or unreached. Rows grow southwards."""
    import json

    from .graph import OFFSETS

    path = Path(out_dir) / "pointer_offsets.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "offsets_drow_dcol": OFFSETS.tolist(),
        "note": "pointer.tif (int8): next cell = (row + drow[k], col + dcol[k]); -1 = pad or "
                "unreached; rows grow southwards (north-up grid)",
    }, indent=1), encoding="utf-8")  # fmt: skip
    return path


def web_products(grid: Grid, pad, fields: dict[str, dijkstra.Field], settings: Settings,
                 public: Path = PUBLIC, default: str | None = None) -> dict:  # fmt: skip
    """Isochrones, edges, bands, headline and scenarios/index.json for the scenarios given."""
    var = load("variants")
    default = default or var["scenarios"]["default"]
    by_suit: dict[int, dict[str, np.ndarray]] = {}
    iso_info: dict[str, dict] = {}
    for sid, f in fields.items():
        variant, suit = physio.parse_scenario(sid)
        by_suit.setdefault(suit, {})[variant] = f.t_min
        iso, step, mb = isochrones_within_budget(grid, f.t_min, settings)
        _write_web(public, f"scenarios/{sid}/isochrones.geojson", iso, "isochrones.schema.json")
        provenance.record(f"isochrone_step_min.{sid}", step, "min",
                          f"scenarios/{sid}/isochrones.geojson", SCRIPT)  # fmt: skip
        iso_info[sid] = {"step_min": step, "gz_mb": round(mb, 3),
                         "gz_mb_1min": round(isochrones_within_budget.first_gz_mb, 3),
                         "min_hole_m2": settings.min_hole_m2}  # fmt: skip
        cg = grid.with_nogo(physio.scenario_params(sid, v1_rmse_deg=settings.v1_rmse_deg).nogo_deg)
        _write_web(public, f"scenarios/{sid}/edges.geojson",
                   edges.edges(cg, f.t_min, settings.budgets, settings.buffer_m,
                               settings.simplify_m), "edges.schema.json")  # fmt: skip
    for suit, tv in by_suit.items():
        _write_web(public, f"scenarios/bands_{suit}.geojson",
                   envelope.bands(grid, tv, settings.budgets, settings.simplify_m),
                   "bands.schema.json")  # fmt: skip
    budget = settings.budgets[0]
    entries = []
    for sid, f in fields.items():
        variant, suit = physio.parse_scenario(sid)
        own = envelope.reachable_pct(grid, f.t_min, pad, budget, settings.disc_speed_ms)
        rng = [
            envelope.reachable_pct(grid, by_suit[suit][v], pad, budget, settings.disc_speed_ms)
            if v in by_suit[suit] else None
            for v in ("conservative", "optimistic")
        ]  # fmt: skip
        own_r = None if own is None else round(own, 1)
        rng_r = [None if x is None else round(x, 1) for x in rng]
        file = "scenarios/index.json"
        if own_r is not None:
            provenance.record(f"reachable_pct.{sid}.{budget}", own_r, "%", file, SCRIPT)
        for end, val in zip(("low", "high"), rng_r, strict=True):
            if val is not None:
                provenance.record(f"reachable_pct_range.{sid}.{budget}.{end}", val, "%", file,
                                  SCRIPT)  # fmt: skip
        entries.append({
            "id": sid, "variant": variant, "suit_kg": suit,
            "files": {
                "isochrones": f"scenarios/{sid}/isochrones.geojson",
                "bands": f"scenarios/bands_{suit}.geojson",
                "edges": f"scenarios/{sid}/edges.geojson",
                "partner": f"scenarios/nom_{suit}/partner.geojson",  # haul runs nominal only
            },
            "headline": {"budget_min": budget, "reachable_pct": own_r, "range_pct": rng_r},
        })  # fmt: skip
    index = {"dummy": False, "default": default, "scenarios": entries}
    _write_web(public, "scenarios/index.json", index, "scenarios_index.schema.json")
    web_products.iso_info = iso_info  # sizes for the run summary
    return index


def _write_web(public: Path, rel: str, obj, schema: str) -> Path:
    """Validate, write and record the file-level manifest key file.<rel>."""
    path = write_json(public / rel, obj, schema)
    provenance.record_file(rel, path, SCRIPT)
    return path


def partner_fields(grid: Grid, pad, ridge_index, suit_kg: int, settings: Settings,
                   out_dir: Path = ENGINE_DIR) -> dict[tuple[str, float], np.ndarray]:  # fmt: skip
    """Nominal-variant haul fields: (suited, bound) casualty x haul.yaml partner_cases (D20: cart
    only; no drag fields), ridges masked."""
    h = load("haul")
    p = physio.params("nominal", suit_kg=suit_kg)
    hg = haul.haul_grid(grid.with_nogo(p.nogo_deg), ridge_index)
    out = {}
    for m_ic in (haul.suited_casualty_kg(suit_kg), h["casualty_kg"]["bound"]):
        for name in haul.partner_cases():
            c = haul.case(name, m_ic)
            f = dijkstra.return_field(hg, haul.grade_table(p, c), pad)
            tag = f"nom_{suit_kg}_{name}_{int(m_ic)}"
            write_raster(out_dir / "haul" / tag / "t_haul.tif", f.t_min.astype(np.float32),
                         grid, np.float32(np.nan))  # fmt: skip
            out[(name, float(m_ic))] = f.t_min
    return out


def partner_product(grid: Grid, fields, suit_kg: int, settings: Settings,
                    public: Path = PUBLIC) -> dict:  # fmt: skip
    """partner.geojson (cart line, D20) plus the drag finding as a foreign member
    ``drag_finding`` (flat ground, haul.drag_flat). Manifest keys haul.drag.flat.nom_{suit}.*,
    and haul.drag.flat.* for the default suit (the numbers SPEC §11 D20 cites)."""
    fc = haul.partner(grid, fields, settings.simplify_m)
    d = haul.drag_flat(suit_kg)
    fc["drag_finding"] = {**{k: (round(v, 3) if isinstance(v, float) else v)
                             for k, v in d.items()},
                          "note": "Dragging is reported, not drawn (D20): on flat ground the drag "
                                  "force exceeds the rescuer's boot traction."}  # fmt: skip
    rel = f"scenarios/nom_{suit_kg}/partner.geojson"
    _write_web(public, rel, fc, "partner.schema.json")
    units = {"force_N": "N", "traction_limit_N": "N", "max_mass_kg": "kg", "casualty_kg": "kg",
             "rescuer_system_kg": "kg", "mu": "1", "boot_mu": "1"}  # fmt: skip
    prefixes = [f"haul.drag.flat.nom_{suit_kg}"]
    if suit_kg == load("crew")["default_suit_kg"]:
        prefixes.append("haul.drag.flat")
    for pre in prefixes:
        for k, u in units.items():
            provenance.record(f"{pre}.{k}", fc["drag_finding"][k], u, rel, SCRIPT)
        provenance.record(f"{pre}.feasible", d["feasible"], None, rel, SCRIPT)
    return fc


def siting_scenario() -> str:
    """Scenario whose access cells start the F8 forward runs: the site.yaml siting rule's
    variant at the default suit (con_104)."""
    from . import siting

    pre = {v: k for k, v in physio.VARIANT_PREFIX.items()}[siting.rule_from_config().variant]
    return f"{pre}_{load('crew')['default_suit_kg']}"


def diagnostics(grid: Grid, pad, fields: dict[str, dijkstra.Field], settings: Settings) -> dict:
    """Sanity numbers per scenario (internal, not shown in the app): reachable % of the
    assessed flat disc and envelope area / flat-circle area at every budget, edge cause shares
    by length, reached cells and the largest finite T_home."""
    out = {}
    for sid, f in fields.items():
        cg = grid.with_nogo(physio.scenario_params(sid, v1_rmse_deg=settings.v1_rmse_deg).nogo_deg)
        fin = np.isfinite(f.t_min)
        d = {"reached_cells": int(fin.sum()), "passable_cells": int(cg.passable.sum()),
             "t_home_max_min": round(float(f.t_min[fin].max()), 1), "budgets": {}}  # fmt: skip
        for b in settings.budgets:
            radius = settings.disc_speed_ms * b * 60.0
            pct = envelope.reachable_pct(grid, f.t_min, pad, b, settings.disc_speed_ms)
            area = float(envelope.envelope_mask(f.t_min, b).sum()) * grid.res_m**2
            disc = envelope.flat_disc(grid, pad, radius)
            lengths = dict.fromkeys(edges.CAUSES, 0.0)
            for line, cause in edges.edge_lines(cg, f.t_min, b, settings.buffer_m):
                lengths[cause] += line.length
            tot = sum(lengths.values()) or 1.0
            d["budgets"][str(b)] = {
                "flat_disc_radius_m": round(radius, 1),
                "reachable_pct_assessed_disc": None if pct is None else round(pct, 2),
                "flat_circle_ratio": round(area / (np.pi * radius**2), 4),
                "disc_blocked_pct_variant": round(
                    100.0 * float((disc & ~cg.passable).sum()) / float(disc.sum()), 2),
                "edge_length_km": {k: round(v / 1000.0, 2) for k, v in lengths.items()},
                "edge_cause_share_pct": {k: round(100.0 * v / tot, 1) for k, v in lengths.items()},
            }  # fmt: skip
        out[sid] = d
    return out


def stations_product(grid: Grid, fields, partner_t, public: Path = PUBLIC,
                     terrain_dir: Path = INTERIM_DIR / "terrain") -> tuple:  # fmt: skip
    """stations.json = WS1's stations + T_home per scenario at the access cell (access.py,
    user decision 11:40), the access block and the partner-line flag. Stations without a
    position are left out (the contract needs lon/lat) and returned in ``missing``. The science
    lon/lat is never moved."""
    st, missing = stations.load_ws1_stations(terrain_dir / "stations.json")
    stations.attach_cells(grid, st)
    access.resolve(grid, fields, st, access.radius_m())
    recs = stations.station_records(st, fields, partner_t, load("haul")["contour_min"])
    _write_web(public, "stations.json", recs, "stations.schema.json")
    f = "stations.json"
    for r in recs:
        for sid, v in r["t_home_min"].items():
            if v is not None:
                provenance.record(f"t_home_min.{r['id']}.{sid}", v, "min", f, SCRIPT)
        for sid, a in r.get("access", {}).items():
            for k, u in (("dist_m", "m"), ("lon", "deg"), ("lat", "deg"), ("o2_home_L", "L")):
                if a.get(k) is not None:
                    provenance.record(f"access.{r['id']}.{sid}.{k}", a[k], u, f, SCRIPT)
            w = a.get("walk_in") or {}
            for k, u in (("rise_m", "m"), ("mean_slope_deg", "deg"), ("max_slope_deg", "deg"),
                         ("max_terrain_slope_deg", "deg")):  # fmt: skip
                if w.get(k) is not None:
                    provenance.record(f"access.{r['id']}.{sid}.walk_in.{k}", w[k], u, f, SCRIPT)
        if r["in_partner_line"] is not None:
            provenance.record(f"in_partner_line.{r['id']}", r["in_partner_line"], None, f,
                              SCRIPT)  # fmt: skip
    return st, recs, missing


def route_budget_min() -> float:
    spec = load("variants")["route"]["budget"]
    if spec != "crew.eva_h":
        raise ValueError(f"cannot parse variants.route.budget {spec!r}")
    return float(load("crew")["eva_h"]) * 60.0


def ridge_3m(ridge_index: np.ndarray, factor: int) -> np.ndarray:
    """Max-aggregate WS1's ridge_index (1 m) onto the routing grid: a 3 m cell is ridge if any
    of its 1 m cells is (haul.yaml mask_ridges). factor = route res / ridge res."""
    r = np.asarray(ridge_index, dtype=np.float64)
    if factor == 1:
        return r
    h, w = r.shape[0] // factor, r.shape[1] // factor
    r = np.where(np.isfinite(r), r, -np.inf)[: h * factor, : w * factor]
    return r.reshape(h, factor, w, factor).max(axis=(1, 3))


def trade_product(grid: Grid, pad, fields, partner_by_suit, station_list, settings: Settings,
                  public: Path = PUBLIC) -> dict | None:  # fmt: skip
    """trade_table.json (F11): rows = walkback budgets, cols = suit masses.

    science_value: sum of station values with conservative T_home <= budget (SPEC F11);
    reachable_pct: nominal variant, % of the assessed flat disc (as the headline);
    partner_area_km2: area of the partner line (haul.yaml contour_min, cart case, suited
    casualty at that suit). A cell whose input is missing stays null."""
    rows = settings.budgets
    cols = list(load("crew")["suit_masses_kg"])
    cmin = load("haul")["contour_min"]
    values = {s["id"]: s.get("value") for s in station_list}
    cells = {}
    for b in rows:
        for m in cols:
            con, nom = fields.get(f"con_{m}"), fields.get(f"nom_{m}")
            sv = None
            if con is not None and station_list and all(v is not None for v in values.values()):
                t_at = {s["id"]: _t_access(s, f"con_{m}", con) for s in station_list}
                sv = round(trade.science_value(t_at, values, b), 4)
            pct = None
            if nom is not None:
                pct = envelope.reachable_pct(grid, nom.t_min, pad, b, settings.disc_speed_ms)
                pct = None if pct is None else round(pct, 1)
            area = None
            pt = partner_by_suit.get(m)
            if pt is not None:
                area = round(float(envelope.envelope_mask(pt, cmin).sum()) * grid.res_m**2
                             / 1e6, 4)  # fmt: skip
            cells[(b, m)] = {"science_value": sv, "reachable_pct": pct, "partner_area_km2": area}
    tt = trade.table(rows, cols, cells)
    _write_web(public, "trade_table.json", tt, "trade_table.schema.json")
    for (b, m), c in cells.items():
        for k, u in (("science_value", "score"), ("reachable_pct", "%"),
                     ("partner_area_km2", "km2")):  # fmt: skip
            if c[k] is not None:
                provenance.record(f"trade.{b}.{m}.{k}", c[k], u, "trade_table.json", SCRIPT)
    return tt


def _t_access(s: dict, sid: str, f: dijkstra.Field) -> float:
    """T_home at the station's access cell in scenario sid (inf if none); falls back to the
    station cell when access.resolve has not run."""
    acc = s.get("access")
    if acc is None:
        return float(f.t_min[s["rc"]])
    a = acc.get(sid)
    return np.inf if a is None or a.t_home_min is None else float(a.t_home_min)


def conditions_inputs(t_dark_min: float | None, tau_dose_min: float | None, dose: str,
                      use_ws4: bool) -> dict:  # fmt: skip
    """Daylight and dose-leash margin terms: CLI values win; otherwise WS4's
    pipeline.conditions.margins (clock.json t_dark at the pad, rad.json leash tau at the storm
    peak or the latest rate). A term WS4 cannot provide stays None (left out of the margin)."""
    out = {"t_dark_min": t_dark_min, "t_dark_source": "CLI" if t_dark_min is not None else None,
           "tau_dose_min": tau_dose_min,
           "tau_dose_source": "CLI" if tau_dose_min is not None else None,
           "dose": dose}  # fmt: skip
    if use_ws4 and (t_dark_min is None or tau_dose_min is None):
        try:
            from pipeline.conditions.margins import margin_inputs

            ws4 = margin_inputs(None, dose)
        except (ImportError, FileNotFoundError, KeyError) as e:
            print(f"WS4 margins unavailable ({e!r}); missing terms are left out")
            return out
        for k in ("t_dark_min", "tau_dose_min"):
            if out[k] is None and ws4.get(k) is not None:
                out[k] = float(ws4[k])
                out[k.replace("_min", "_source")] = "WS4: " + str(ws4.get(
                    k.replace("_min", "_source")))  # fmt: skip
        out["eva_start_utc"] = ws4.get("eva_start_utc")
    return out


def main(argv=None) -> int:
    import json
    import time

    import rasterio

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--terrain", type=Path, default=INTERIM_DIR / "terrain")
    ap.add_argument("--scenarios", nargs="*", default=None)
    ap.add_argument("--out", type=Path, default=ENGINE_DIR,
                    help="engine output dir; web files go to <out>/public")
    ap.add_argument("--v1-json", type=Path, default=INTERIM_DIR / "validation" / "v1.json",
                    help="WS6 V1 result: rmse_deg sets the conservative slope limit")  # fmt: skip
    ap.add_argument("--t-dark-min", type=float, default=None,
                    help="WS4 daylight: minutes from EVA start to dark (margin term)")  # fmt: skip
    ap.add_argument("--tau-dose-min", type=float, default=None,
                    help="WS4 dose leash tau_dose, min (margin term)")  # fmt: skip
    ap.add_argument("--dose", choices=("storm", "latest"), default="storm",
                    help="WS4 dose leash: storm peak (default, SPEC storm replay) or latest RAD")
    ap.add_argument("--no-conditions", action="store_true",
                    help="do not read WS4 margins (only the --t-dark-min/--tau-dose-min flags)")
    ap.add_argument("--route-scenarios", nargs="*", default=None,
                    help="scenarios to plan a traverse for (default: the default scenario)")
    ap.add_argument("--no-partner", action="store_true")
    ap.add_argument("--siting", action="store_true",
                    help="also run F8 siting (needs stations with values); writes pad.json")
    ap.add_argument("--pad", nargs=2, type=float, metavar=("LON", "LAT"), default=None,
                    help="pad override (e.g. the F8 pad once S accepts it); default site.yaml")
    a = ap.parse_args(argv)
    out, pub = a.out, a.out / "public"
    need = [a.terrain / f for f in ("elev_3m.tif", "maxslope_3m.tif", "cellstate_3m.tif")]
    if not all(f.exists() for f in need):
        print(f"engine: WS1 routing grids missing in {a.terrain}: {[f.name for f in need]}")
        return 2
    v1 = None
    try:
        v1 = v1_from_file(a.v1_json)
        print(f"V1 from {a.v1_json}: rmse {v1['rmse_deg']:.3f} deg")
    except MissingInput as e:
        print(f"no V1 yet ({e}); conservative scenarios are skipped")
    rmse = None if v1 is None else v1["rmse_deg"]
    settings = settings_from_config(rmse)
    sids, skipped = runnable(a.scenarios or load("variants")["scenarios"]["ids"], rmse)
    for sid, why in skipped.items():
        print(f"skip {sid}: {why}")
    tick = time.perf_counter()
    timing: dict[str, float] = {}

    def lap(name):
        nonlocal tick
        now = time.perf_counter()
        timing[name] = round(now - tick, 1)
        tick = now
        print(f"{name}: {timing[name]} s", flush=True)

    grid = load_ws1_grid(a.terrain)
    pad = pad_rc(grid, tuple(a.pad) if a.pad else None)
    lap("load_grid")
    fields = return_fields(grid, pad, sids, settings, out_dir=out)
    lap("return_fields")
    web_products(grid, pad, fields, settings, public=pub)
    lap("web_products")
    diag = diagnostics(grid, pad, fields, settings)
    lap("diagnostics")

    partner_by_suit: dict[int, np.ndarray] = {}
    if not a.no_partner:
        with rasterio.open(a.terrain / "ridge_index.tif") as ds:
            ridge = ds.read(1, masked=True).filled(np.nan).astype(np.float64)
            factor = int(round(grid.res_m / ds.res[0]))
        ridge = ridge_3m(ridge, factor)[: grid.shape[0], : grid.shape[1]]
        for suit in sorted({physio.parse_scenario(s)[1] for s in sids if s.startswith("nom_")}):
            pf = partner_fields(grid, pad, ridge, suit, settings, out_dir=out)
            partner_product(grid, pf, suit, settings, public=pub)
            partner_by_suit[suit] = pf.get(("cart", float(haul.suited_casualty_kg(suit))))
        lap("partner")

    default = load("variants")["scenarios"]["default"]
    st, recs, missing = [], [], []
    if (a.terrain / "stations.json").exists():
        partner_t = partner_by_suit.get(physio.parse_scenario(default)[1])
        st, recs, missing = stations_product(grid, fields, partner_t, public=pub,
                                               terrain_dir=a.terrain)
        lap("stations")

    cond = conditions_inputs(a.t_dark_min, a.tau_dose_min, a.dose, not a.no_conditions)
    print(f"margins: t_dark {cond['t_dark_min']} min ({cond['t_dark_source']}); "
          f"tau_dose {cond['tau_dose_min']} min ({cond['tau_dose_source']})")
    routes = {}
    budget = route_budget_min()
    ck = float(load("variants")["route"]["o2_checkpoint_min"])
    for sid in a.route_scenarios or [default]:
        if sid not in fields or not st or any(s.get("value") is None for s in st):
            print(f"route {sid}: skipped (no field, no stations or a station without value)")
            continue
        p = physio.scenario_params(sid, v1_rmse_deg=rmse)
        mi = margin.inputs(p, cond["t_dark_min"], cond["tau_dose_min"])
        suit = physio.parse_scenario(sid)[1]
        rst, no_access = access.routing_stations(st, sid)
        res = traverse.plan(grid.with_nogo(p.nogo_deg), physio.grade_table(p), fields[sid], pad,
                            rst, budget, ck, mi, partner_by_suit.get(suit),
                            load("haul")["contour_min"])  # fmt: skip
        res.unreachable = res.unreachable + list(no_access)
        traverse.write(res, sid, pub)
        routes[sid] = {"order": res.order, "unreachable": res.unreachable,
                       "no_access": no_access,
                       "access_dist_m": {s["id"]: s["access_dist_m"] for s in rst},
                       "total_min": round(res.total_min, 2), "value": round(res.value, 4),
                       "margin_terms": res.margin_terms}  # fmt: skip
        print(f"route {sid}: {res.order} {res.total_min:.1f} min; terms {res.margin_terms}; "
              f"no access cell: {no_access}")
        if sid == default:
            hcfg = load("haul")
            frags = cards.fragments(st, res, sid, partner_by_suit.get(suit),
                                    float(haul.suited_casualty_kg(suit)), "cart",
                                    float(hcfg["contour_min"]), access.radius_m())  # fmt: skip
            cards.write(frags, pub)
            routes[sid]["cards"] = sorted(frags)
    lap("routes")

    if st:
        trade_product(grid, pad, fields, partner_by_suit, st, settings, public=pub)
        lap("trade")
    siting_info = None
    if a.siting and st and all(s.get("value") is not None for s in st):
        from . import siting

        try:
            ssid = siting_scenario()
            sst, s_none = access.routing_stations(st, ssid)
            print(f"siting: forward runs from the {ssid} access cells of {[s['id'] for s in sst]}"
                  f"; no access cell: {s_none}")
            if not sst:
                raise MissingInput(f"no station has an access cell in {ssid}")
            siting_doc = siting.run(grid, sst, rmse, out, pub)
            siting_info = {"scenario": ssid, "stations": [s["id"] for s in sst],
                           "no_access": s_none, "pad": siting_doc["pad"],
                           "alternatives": siting_doc["alternatives"],
                           "hop_options": siting_doc["hop_options"]}  # fmt: skip
        except MissingInput as e:  # conservative rule variant needs V1
            print(f"siting skipped: {e}")
        lap("siting")

    summary = {
        "note": "WS2 engine run summary (internal, not a web contract; sanity numbers only)",
        "scenarios_run": sids, "skipped": skipped, "stations_without_position": missing,
        "v1": v1, "margin_inputs": cond, "pad_rc": [int(pad[0]), int(pad[1])],
        "grid_shape": list(grid.shape),
        "res_m": grid.res_m, "timing_s": timing, "diagnostics": diag, "routes": routes,
        "isochrones": getattr(web_products, "iso_info", {}), "siting": siting_info,
    }  # fmt: skip
    summ = out / "summary.json"
    summ.parent.mkdir(parents=True, exist_ok=True)
    summ.write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(f"wrote {summ}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
