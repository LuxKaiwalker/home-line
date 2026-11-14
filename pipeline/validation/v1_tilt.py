"""V1 footing validation (F13): DEM tilt over the rover footprint vs IMU tilt at drive ends.

For every co-registered Curiosity drive end in the focus area (``config/site.yaml`` ``aoi_focus``),
fit a least-squares plane to the DEM cells whose centres lie in a square of side ``footprint_m``
centred on the drive end (``config/validation.yaml`` ``v1.dem_method``), and compare its tilt with
the rover's IMU tilt (MMGIS). Reports bias (mean DEM - IMU), RMSE, Pearson r and a 2x2 confusion
matrix per threshold (``v1.confusion_thresholds_deg``; positive = tilt >= threshold, DEM is the
prediction, IMU the reference). Drive ends whose footprint touches nodata or leaves the DEM are
excluded and counted, never filled. Caveat (SPEC F13): the rover chose gentle ground.

The RMSE goes to WS1 for the conservative no-go limit (``20 - v1_rmse_deg``, config/site.yaml).

``footprint_m`` is open (config/validation.yaml, STATUS WS6 Blocked): the real run refuses to start
while it is null. The array API (``dem_tilt_at``, ``compare``) takes it as an argument.
"""

from __future__ import annotations

import json
import math
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import yaml

from pipeline.provenance.manifest import record

REPO = Path(__file__).resolve().parents[2]
CONFIG_DIR = REPO / "config"
DEFAULT_OUT = REPO / "data" / "interim" / "validation" / "v1.json"
DEFAULT_SVG = DEFAULT_OUT.with_suffix(".svg")
# Paths under web/public/data/ (contracts/README.md); `make web` copies the files unchanged.
WEB_JSON = "validation/v1.json"
WEB_SVG = "validation/v1.svg"
CAVEAT = "The rover chose gentle ground."  # SPEC F13


class V1Blocked(RuntimeError):
    """A V1 input or decision is missing (see STATUS.md WS6 Blocked)."""


# --------------------------------------------------------------------------- config


def _v1_config() -> dict[str, Any]:
    return yaml.safe_load((CONFIG_DIR / "validation.yaml").read_text())["v1"]


@lru_cache(maxsize=1)
def _site() -> dict[str, Any]:
    return yaml.safe_load((CONFIG_DIR / "site.yaml").read_text())


def confusion_thresholds() -> tuple[float, ...]:
    return tuple(float(t) for t in _v1_config()["confusion_thresholds_deg"])


def footprint_m() -> float:
    """The V1 footprint side (m) from config; raises V1Blocked while it is undecided."""
    fp = _v1_config().get("footprint_m")
    if fp is None:
        raise V1Blocked(
            "config/validation.yaml v1.footprint_m is null: the V1 footprint is open "
            "(SPEC F13 '≈3 m' vs site.yaml slope.compare_window_m); S decides"
        )
    return float(fp)


# --------------------------------------------------------------------------- geometry


def tilt_from_roll_pitch(roll_deg, pitch_deg):
    """Tilt of the body z-axis from vertical: cos(tilt) = cos(roll) * cos(pitch)."""
    c = np.cos(np.radians(roll_deg)) * np.cos(np.radians(pitch_deg))
    return np.degrees(np.arccos(np.clip(c, -1.0, 1.0)))


def in_focus(lon, lat, aoi: dict[str, float] | None = None) -> np.ndarray:
    """Boolean mask of points inside the focus area (inclusive bounds)."""
    a = aoi or _site()["aoi_focus"]
    lon, lat = np.asarray(lon, float), np.asarray(lat, float)
    return (lon >= a["west"]) & (lon <= a["east"]) & (lat >= a["south"]) & (lat <= a["north"])


def lonlat_to_xy(lon, lat) -> tuple[np.ndarray, np.ndarray]:
    """Mars 2000 planetocentric lon/lat -> analysis CRS metres (config/site.yaml crs)."""
    from pyproj import Transformer

    crs = _site()["crs"]
    geo = f"+proj=longlat +R={crs['mars_radius_m']} +no_defs"
    tr = Transformer.from_crs(geo, crs["analysis_proj"], always_xy=True)
    x, y = tr.transform(np.asarray(lon, float), np.asarray(lat, float))
    return np.atleast_1d(np.asarray(x)), np.atleast_1d(np.asarray(y))


def dem_tilt_at(dem, transform, x, y, footprint_m: float, nodata: float | None = None):
    """Plane-fit tilt (deg) of ``dem`` over a ``footprint_m`` square centred at each (x, y).

    ``transform`` is a north-up affine (rasterio ``Affine``) mapping (col, row) -> (x, y).
    Returns NaN where the footprint leaves the DEM, touches nodata/NaN, or spans < 3 cells per axis.
    """
    dem = np.asarray(dem, dtype=np.float64)
    x, y = np.atleast_1d(np.asarray(x, float)), np.atleast_1d(np.asarray(y, float))
    if transform.b != 0 or transform.d != 0:
        raise ValueError("dem_tilt_at needs a north-up (unrotated) transform")
    hx = footprint_m / (2 * abs(transform.a))
    hy = footprint_m / (2 * abs(transform.e))
    out = np.full(x.shape, np.nan)
    nrows, ncols = dem.shape
    eps = 1e-9
    for i, (xi, yi) in enumerate(zip(x, y, strict=True)):
        # fractional col/row of the point (cell corners at integers, centres at +0.5)
        cf, rf = (xi - transform.c) / transform.a, (yi - transform.f) / transform.e
        c0, c1 = math.ceil(cf - 0.5 - hx - eps), math.floor(cf - 0.5 + hx + eps)
        r0, r1 = math.ceil(rf - 0.5 - hy - eps), math.floor(rf - 0.5 + hy + eps)
        if c0 < 0 or r0 < 0 or c1 >= ncols or r1 >= nrows or c1 - c0 < 2 or r1 - r0 < 2:
            continue
        win = dem[r0 : r1 + 1, c0 : c1 + 1]
        if not np.all(np.isfinite(win)) or (nodata is not None and np.any(win == nodata)):
            continue
        cc, rr = np.meshgrid(np.arange(c0, c1 + 1) + 0.5, np.arange(r0, r1 + 1) + 0.5)
        gx, gy = transform.c + transform.a * cc, transform.f + transform.e * rr
        a = np.column_stack([gx.ravel() - xi, gy.ravel() - yi, np.ones(gx.size)])
        (dzdx, dzdy, _), *_ = np.linalg.lstsq(a, win.ravel(), rcond=None)
        out[i] = math.degrees(math.atan(math.hypot(dzdx, dzdy)))
    return out


# --------------------------------------------------------------------------- statistics


def compare(dem_tilt, imu_tilt, thresholds_deg) -> dict[str, Any]:
    """Bias (mean DEM - IMU), RMSE, Pearson r and per-threshold confusion matrices.

    Pairs with a NaN on either side are excluded and counted in ``n_excluded``. ``r`` is None
    when undefined (n < 3 or zero variance); bias and RMSE are None when n = 0.
    """
    d_all = np.asarray(dem_tilt, float).ravel()
    i_all = np.asarray(imu_tilt, float).ravel()
    ok = np.isfinite(d_all) & np.isfinite(i_all)
    d, m = d_all[ok], i_all[ok]
    n = int(d.size)
    resid = d - m
    r = None
    if n >= 3 and np.std(d) > 0 and np.std(m) > 0:
        r = float(np.corrcoef(d, m)[0, 1])
    confusion = {}
    for t in thresholds_deg:
        ds, ms = d >= t, m >= t
        confusion[f"{t:g}"] = {
            "tp": int(np.sum(ds & ms)),
            "fp": int(np.sum(ds & ~ms)),
            "fn": int(np.sum(~ds & ms)),
            "tn": int(np.sum(~ds & ~ms)),
        }
    return {
        "n": n,
        "n_excluded": int(d_all.size - n),
        "bias_deg": float(resid.mean()) if n else None,
        "rmse_deg": float(np.sqrt(np.mean(resid**2))) if n else None,
        "r": r,
        "thresholds_deg": [float(t) for t in thresholds_deg],
        "confusion": confusion,
        "points": [[float(a), float(b)] for a, b in zip(d, m, strict=True)],
    }


# --------------------------------------------------------------------------- output


def write_result(
    result: dict[str, Any],
    out_path: str | os.PathLike[str] = DEFAULT_OUT,
    svg_path: str | os.PathLike[str] | None = DEFAULT_SVG,
    *,
    footprint_m: float,
    dem_file: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Write ``v1.json`` (+ the scatter SVG) and record every displayed number in the manifest.

    Keys: ``v1.{bias_deg,rmse_deg,r,n,n_excluded,footprint_m}``, ``v1.confusion.<thr>.<cell>``,
    ``v1.n_drive_ends`` / ``v1.n_in_focus`` when present; ``file`` = the web data path.
    """
    from pipeline.validation.figures import v1_scatter_svg

    out_path = Path(out_path)
    doc = {
        **result,
        "footprint_m": float(footprint_m),
        "dem_method": _v1_config()["dem_method"],
        "dem_file": dem_file,
        "bias_definition": "mean(DEM tilt - IMU tilt)",
        "positive_class": "tilt >= threshold (DEM = prediction, IMU = reference)",
        "caveat": CAVEAT,
        **(extra or {}),
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc, indent=2, allow_nan=False) + "\n")

    def rec(key: str, value: Any, units: str | None) -> None:
        record(key, value, units, WEB_JSON, __file__)

    for key, units in (("bias_deg", "deg"), ("rmse_deg", "deg"), ("r", "1"), ("n", "count"),
                       ("n_excluded", "count"), ("footprint_m", "m"),
                       ("n_drive_ends", "count"), ("n_in_focus", "count")):
        if key in doc:
            rec(f"v1.{key}", doc[key], units)
    for thr, cm in doc["confusion"].items():
        for cell, v in cm.items():
            rec(f"v1.confusion.{thr}.{cell}", v, "count")
    if svg_path is not None:
        v1_scatter_svg(doc, svg_path)
    return doc


def run(
    dem_path: str | os.PathLike[str],
    lon,
    lat,
    imu_tilt_deg,
    out_path: str | os.PathLike[str] = DEFAULT_OUT,
    svg_path: str | os.PathLike[str] | None = DEFAULT_SVG,
    *,
    footprint_m: float,
) -> dict[str, Any]:
    """V1 on arrays: DEM GeoTIFF in the analysis CRS + co-registered drive ends (lon/lat) + IMU
    tilt (deg). Drive ends outside the focus area are dropped before counting."""
    import rasterio

    from pipeline.provenance.manifest import _rel

    lon, lat = np.atleast_1d(np.asarray(lon, float)), np.atleast_1d(np.asarray(lat, float))
    imu = np.atleast_1d(np.asarray(imu_tilt_deg, float))
    keep = in_focus(lon, lat)
    x, y = lonlat_to_xy(lon[keep], lat[keep])
    with rasterio.open(dem_path) as src:
        want = _site()["crs"]["analysis_proj"]
        if src.crs is None or _norm_proj(src.crs.to_proj4()) != _norm_proj(want):
            raise ValueError(f"DEM CRS {src.crs} is not the analysis CRS {want!r}")
        dem = src.read(1, masked=False).astype(np.float64)
        tilt = dem_tilt_at(dem, src.transform, x, y, footprint_m, nodata=src.nodata)
    res = compare(tilt, imu[keep], confusion_thresholds())
    extra = {"n_drive_ends": int(keep.size), "n_in_focus": int(keep.sum()),
             "aoi_focus": dict(_site()["aoi_focus"])}
    return write_result(res, out_path, svg_path, footprint_m=footprint_m,
                        dem_file=_rel(dem_path), extra=extra)


def _norm_proj(p: str) -> str:
    return " ".join(sorted(t for t in p.split() if t not in ("+no_defs", "+no_defs=True")))
