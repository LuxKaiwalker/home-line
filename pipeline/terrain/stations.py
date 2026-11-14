"""Station placement filters and names (F7; SPEC 11 D26, D32). Pure functions; ``build.py
step_stations`` applies them to the scoring lattice.

* ``spacing_ok``: at least ``min_spacing_m`` (D32: 300 m) from every placed station.
* ``in_focus``: inside ``site.yaml aoi_focus`` (inclusive box).
* ``walkable_at``: the 3 m cell under the science point is assessed (state 0) in the D22 nominal
  cell states (``cellstate_3m.tif``); blocked, unknown and off-grid points are not walkable.
* ``finding_name``: a station found by the score is named by what the score found (D26), from
  its normalised components only, never by a geological claim.
* ``place_extras``: greedy, highest F7 value first, every filter and the spacing re-checked
  against all stations placed so far.
"""

from __future__ import annotations

import numpy as np

ASSESSED = 0


def spacing_ok(x, y, placed_xy, min_m: float) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    ok = np.ones(x.shape, bool)
    for px, py in placed_xy:
        ok &= np.hypot(x - px, y - py) >= min_m
    return ok


def in_focus(lon, lat, focus: dict) -> np.ndarray:
    lon = np.asarray(lon)
    lat = np.asarray(lat)
    return ((lon >= focus["west"]) & (lon <= focus["east"]) & (lat >= focus["south"])
            & (lat <= focus["north"]))


def walkable_at(state3: np.ndarray, g3, x, y) -> np.ndarray:
    r, c = g3.rc_of_xy(x, y)
    r, c = np.atleast_1d(r), np.atleast_1d(c)
    inside = (r >= 0) & (r < state3.shape[0]) & (c >= 0) & (c < state3.shape[1])
    out = np.zeros(r.shape, bool)
    out[inside] = state3[r[inside], c[inside]] == ASSESSED
    return out


def finding_name(crism_norm: dict, ridge_norm: float, *, min_norm: float,
                 index_words: dict) -> tuple[str, str]:
    """(name, finding) from the normalised components. The CRISM part uses the index with the
    larger normalised value; a component is named when it is >= ``min_norm``; parts are ordered
    by their F7 contribution (equal weights 0.4/0.4, so by normalised value)."""
    idx = max(crism_norm, key=lambda k: (crism_norm[k], k))
    parts = []
    if crism_norm[idx] >= min_norm:
        parts.append((crism_norm[idx], f"high {idx} {index_words[idx]} signal"))
    if ridge_norm >= min_norm:
        parts.append((ridge_norm, "dense ridge network"))
    parts.sort(key=lambda p: -p[0])
    name = " + ".join(p[1] for p in parts) or "F7 score without a dominant component"
    finding = (", ".join(f"{k} {v:.2f}" for k, v in sorted(crism_norm.items()))
               + f" (CRISM, normalised p2-p98), ridge density {ridge_norm:.2f} (normalised by "
               f"p98); named components >= {min_norm:g}")
    return name, finding


def place_extras(x, y, value, eligible, placed_xy, n_max: int, min_m: float) -> list[int]:
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    v = np.where(np.asarray(eligible, bool) & np.isfinite(value), value, -np.inf)
    placed = list(placed_xy)
    out: list[int] = []
    for i in np.argsort(-v, kind="stable"):
        if len(out) >= n_max or not np.isfinite(v[i]):
            break
        if spacing_ok(x[i:i + 1], y[i:i + 1], placed, min_m)[0]:
            out.append(int(i))
            placed.append((float(x[i]), float(y[i])))
    return out
