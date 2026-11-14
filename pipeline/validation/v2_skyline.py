"""V2 skyline validation (F13): predicted vs detected skyline elevation angle per image column,
then median and P90 by distance class (near < 0.5 km, mid 0.5-2 km, far > 2 km;
horizon.yaml ``distance_classes_km``). Only the far-field figure may be quoted in the video
(SPEC F13); near-field misses are reported, not hidden.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import numpy as np

from pipeline.horizon import config as hcfg
from pipeline.horizon.cahvor import CameraModel, pixels_to_az_el
from pipeline.horizon.rays import HorizonProfile, classify_distance

CLASSES = ("near", "mid", "far")


def compare_columns(model: CameraModel, q, profile: HorizonProfile, sky_rows,
                    columns=None) -> dict:
    """Per-column record for one frame. ``sky_rows`` from sky.detect_skyline (NaN = none)."""
    rows = np.asarray(sky_rows, dtype=float)
    cols = np.arange(rows.size) if columns is None else np.asarray(columns)
    ok = np.isfinite(rows)
    cols, rows = cols[ok], rows[ok]
    az, el_det = pixels_to_az_el(model, q, np.column_stack([cols.astype(float), rows]))
    el_pred = profile.elevation_at(az)
    dist = profile.distance_at(az)
    return {
        "column": cols.tolist(), "row_detected": rows.tolist(), "az_deg": az.tolist(),
        "el_detected_deg": el_det.tolist(), "el_predicted_deg": el_pred.tolist(),
        "error_deg": (el_det - el_pred).tolist(), "distance_m": dist.tolist(),
        "distance_class": classify_distance(dist).tolist(),
    }


def summarise(records) -> dict:
    """Median (signed and absolute) and P90 of |error| per distance class over all frames."""
    err = np.concatenate([np.asarray(r["error_deg"], dtype=float) for r in records]) \
        if records else np.array([])
    cls = np.concatenate([np.asarray(r["distance_class"], dtype=object) for r in records]) \
        if records else np.array([], dtype=object)
    out = {}
    for c in CLASSES:
        e = err[(cls == c) & np.isfinite(err)]
        out[c] = {"n": int(e.size),
                  "median_deg": float(np.median(e)) if e.size else None,
                  "median_abs_deg": float(np.median(np.abs(e))) if e.size else None,
                  "p90_abs_deg": float(np.percentile(np.abs(e), 90)) if e.size else None}
    return out


def manual_check_sample(frame_ids, frac: float | None = None) -> list[str]:
    """Deterministic manual-check subset (horizon.yaml v2.manual_check_frac): the ceil(frac*n)
    frames with the smallest SHA-1 of their id (no RNG seed needed)."""
    f = hcfg.load()["v2"]["manual_check_frac"] if frac is None else frac
    ids = sorted(set(frame_ids), key=lambda s: hashlib.sha1(str(s).encode()).hexdigest())
    return sorted(ids[: math.ceil(f * len(ids))])


# --------------------------------------------------------------------------------------------
# validation/v2.json writer (contract v2.schema.json v1.0.0: summary + frames, open otherwise)
# --------------------------------------------------------------------------------------------

V2_OUT = hcfg.REPO / "data" / "interim" / "horizon" / "validation" / "v2.json"
MANUAL_CHECKS = hcfg.REPO / "data" / "interim" / "horizon" / "validation" / "manual_checks.json"
_ROUND = {"row_detected": 2, "az_deg": 3, "el_detected_deg": 4, "el_predicted_deg": 4,
          "error_deg": 4, "distance_m": 1}


def _rounded(rec: dict) -> dict:
    out = {}
    for k, v in rec.items():
        nd = _ROUND.get(k)
        out[k] = v if nd is None else [None if v_ is None or not np.isfinite(v_)
                                       else round(float(v_), nd) for v_ in v]
    return out


def evaluate_frame(frame: dict, profile: HorizonProfile | None, img) -> dict:
    """One ``frames[]`` entry (without manual-check fields). ``frame`` is a navcam_frames.json
    record; ``img`` the decoded image (array) or None. Failures are returned, never dropped."""
    from pipeline.horizon.cahvor import CameraModel as _CM  # noqa: PLC0415
    from pipeline.horizon.sky import detect_skyline  # noqa: PLC0415

    base = {"image_id": frame["image_id"], "sol": frame.get("sol"),
            "station": frame.get("station"), "stop_id": frame.get("stop_id"),
            "status": "failed", "failure": None, "hand_aligned": False}
    if img is None:
        return {**base, "failure": "image not cached"}
    if profile is None:
        return {**base, "failure": f"no horizon for stop {frame.get('stop_id')}"}
    det = detect_skyline(img)
    rows = np.where(det.in_ref_band, np.nan, det.rows)
    base["detected_frac"] = round(float(np.mean(np.isfinite(rows))), 4)
    in_ref = float(np.mean(det.in_ref_band))
    lim = hcfg.value(hcfg.load()["v2_frame_fail"]["max_in_ref_band_frac"])
    if in_ref > lim:
        return {**base, "failure": f"no clear sky at the top of the frame: boundary inside the "
                                   f"reference band in {in_ref:.0%} of columns (> {lim:.0%})"}
    if not np.isfinite(rows).any():
        return {**base, "failure": "no sky boundary detected (sky detector)"}
    cm = frame["camera_model"]
    model = _CM(cm["type"], cm["C"], cm["A"], cm["H"], cm["V"], O=cm.get("O"), R=cm.get("R"))
    rec = compare_columns(model, frame["attitude_quaternion"], profile, rows)
    if not np.isfinite(np.asarray(rec["error_deg"], dtype=float)).any():
        return {**base, "failure": "predicted skyline unknown in every detected column"}
    return {**base, "status": "ok", "summary": summarise([rec]), "columns": _rounded(rec)}


def build_v2(entries: list[dict], *, hand_aligned: bool = False,
             manual: dict | None = None) -> dict:
    """Assemble and validate validation/v2.json from per-frame entries (every frame tried).

    ``manual`` maps image_id -> bool (manual verdict on the detected skyline). ``available`` is
    false in the hand-aligned fallback (brief WS3) or with fewer than v2.min_stops stops; the
    summary values are then null (contract)."""
    from pipeline.horizon.contracts import validate  # noqa: PLC0415

    cfg = hcfg.load()
    manual = manual or {}
    sample = set(manual_check_sample([e["image_id"] for e in entries]))
    frames = []
    for e in entries:
        f = dict(e)
        f["manual_check"] = e["image_id"] in sample
        f["manual_ok"] = manual.get(e["image_id"])
        frames.append(f)
    ok = [f for f in frames if f["status"] == "ok" and f.get("manual_ok") is not False]
    n_stops = len({f.get("stop_id") or f["image_id"] for f in ok})
    available = (not hand_aligned) and n_stops >= cfg["v2"]["min_stops"]
    summary = summarise([f["columns"] for f in ok])
    if not available:
        summary = {c: {"n": summary[c]["n"], "median_deg": None, "median_abs_deg": None,
                       "p90_abs_deg": None} for c in CLASSES}
    method = "hand-aligned" if hand_aligned else (
        "automatic+manual_check" if any(v is not None for v in manual.values()) else "automatic")
    doc = {"available": bool(available), "method": method,
           "manual_check_frac": cfg["v2"]["manual_check_frac"],
           "distance_classes_km": list(cfg["distance_classes_km"]), "n_stops": n_stops,
           "n_frames_tried": len(frames), "n_frames_ok": len(ok),
           "min_stops": cfg["v2"]["min_stops"], "summary": summary, "frames": frames}
    validate(doc, "v2.schema.json")
    return doc


def station_skyline_error(doc: dict) -> dict:
    """{station: {near, mid, far}} = median |error| over that station's ok frames (card field
    skyline_error_deg; WS3 assumption: the card shows the median absolute error)."""
    by: dict[str, list] = {}
    for f in doc["frames"]:
        if f.get("station") and f["status"] == "ok" and f.get("manual_ok") is not False:
            by.setdefault(f["station"], []).append(f["columns"])
    return {s: {c: v["median_abs_deg"] for c, v in summarise(recs).items()}
            for s, recs in by.items()}


def write_v2(doc: dict, path=V2_OUT, *, record_manifest: bool = True) -> Path:
    """Write v2.json and record v2.n_stops, v2.{class}.{n,median_deg,median_abs_deg,p90_abs_deg}
    and skyline_error_deg.{S}.{class} (manifest file = web path validation/v2.json)."""
    from pipeline.provenance.manifest import record  # noqa: PLC0415

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, separators=(",", ":")))
    if record_manifest:
        rel = "validation/v2.json"
        record("v2.n_stops", doc["n_stops"], "1", file=rel, script=__file__)
        for c in CLASSES:
            for k in ("n", "median_deg", "median_abs_deg", "p90_abs_deg"):
                record(f"v2.{c}.{k}", doc["summary"][c][k], "1" if k == "n" else "deg",
                       file=rel, script=__file__)
        if doc["available"]:
            for s, errs in station_skyline_error(doc).items():
                for c, v in errs.items():
                    record(f"skyline_error_deg.{s}.{c}", v, "deg", file=rel, script=__file__)
    return path


def run_v2(frames_json=None, horizons_dir=None, out=V2_OUT, *, manual_json=MANUAL_CHECKS,
           record_manifest: bool = True) -> dict:
    """Every frame in navcam_frames.json against horizons/{stop_id}.json (navcam eye height)."""
    from PIL import Image  # noqa: PLC0415

    root = hcfg.REPO / "data" / "interim" / "horizon"
    frames_json = Path(frames_json or root / "navcam_frames.json")
    horizons_dir = Path(horizons_dir or root / "horizons")
    frames = json.loads(frames_json.read_text())["frames"]
    entries, profiles = [], {}
    for fr in frames:
        sid = fr.get("stop_id")
        if sid not in profiles:
            hp = horizons_dir / f"{sid}.json"
            profiles[sid] = HorizonProfile.read_json(hp) if hp.exists() else None
        p = hcfg.REPO / fr["local_path"]
        img = np.asarray(Image.open(p).convert("L")) if p.exists() else None
        entries.append(evaluate_frame(fr, profiles[sid], img))
    manual_path = Path(manual_json)
    manual = json.loads(manual_path.read_text()) if manual_path.exists() else {}
    doc = build_v2(entries, manual=manual)
    write_v2(doc, out, record_manifest=record_manifest)
    return doc


def write_composites(doc: dict, frames_json=None, horizons_dir=None, out_dir=None) -> int:
    """V2 check composites validation/overlays/{image_id}.jpg: frame + predicted skyline (overlay
    colour) + the detector's line (detected colour) for every frame with a stop horizon."""
    from PIL import Image  # noqa: PLC0415

    from pipeline.horizon.overlay import (  # noqa: PLC0415
        composite,
        frame_camera,
        render_overlay,
        skyline_pixels,
    )

    root = hcfg.REPO / "data" / "interim" / "horizon"
    frames = json.loads(Path(frames_json or root / "navcam_frames.json").read_text())["frames"]
    hdir = Path(horizons_dir or root / "horizons")
    odir = Path(out_dir or root / "validation" / "overlays")
    odir.mkdir(parents=True, exist_ok=True)
    det = {f["image_id"]: f for f in doc["frames"]}
    n = 0
    for fr in frames:
        hp, ip = hdir / f"{fr['stop_id']}.json", hcfg.REPO / fr["local_path"]
        if not (hp.exists() and ip.exists()):
            continue
        prof = HorizonProfile.read_json(hp)
        grey = np.asarray(Image.open(ip).convert("L"))
        size = (grey.shape[1], grey.shape[0])
        model, q = frame_camera(fr)
        ov = render_overlay(size, skyline_pixels(prof, model, q, size))
        rows = None
        e = det.get(fr["image_id"], {})
        if e.get("status") == "ok":
            rows = np.full(size[0], np.nan)
            c = e["columns"]
            rows[np.asarray(c["column"], dtype=int)] = [np.nan if r is None else r
                                                        for r in c["row_detected"]]
        composite(grey, ov, detected_rows=rows).save(odir / f"{fr['image_id']}.jpg", quality=85)
        n += 1
    return n


def main(argv=None) -> int:
    import argparse  # noqa: PLC0415

    ap = argparse.ArgumentParser(description="V2 skyline validation (F13)")
    ap.add_argument("--no-manifest", action="store_true")
    a = ap.parse_args(argv)
    doc = run_v2(record_manifest=not a.no_manifest)
    n = write_composites(doc)
    print(json.dumps({k: doc[k] for k in ("available", "method", "n_stops", "n_frames_tried",
                                          "n_frames_ok", "summary")}, indent=1))
    print(f"{n} check composites in data/interim/horizon/validation/overlays/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
