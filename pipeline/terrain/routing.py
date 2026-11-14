"""3 m routing grids (F1, F2): mean elevation, max 1 m slope, cell state.

Cell states (contracts/README.md): 0 assessed, 1 blocked (max 1 m slope > nogo), 2 unknown
(any 1 m cell non-HiRISE, nodata or without a slope). Unknown wins over blocked. Unknown cells
are never entered by a route and are left out of every percentage (``mean_over_known``).
"""

from __future__ import annotations

import numpy as np

from . import coverage

ASSESSED, BLOCKED, UNKNOWN = 0, 1, 2


def _blocks(a: np.ndarray, k: int) -> np.ndarray:
    h, w = a.shape
    if h % k or w % k:
        raise ValueError(f"shape {a.shape} is not a multiple of {k}")
    return a.reshape(h // k, k, w // k, k).swapaxes(1, 2).reshape(h // k, w // k, k * k)


def routing_grids(dem1: np.ndarray, slope1: np.ndarray, mask1: np.ndarray, nogo_deg: float,
                  k: int = 3):
    """1 m arrays (aligned, multiples of k) -> (elev_k, maxslope_k, state_k)."""
    z = _blocks(dem1.astype(np.float32), k)
    s = _blocks(slope1.astype(np.float32), k)
    m = _blocks(mask1, k)
    hirise = (m == coverage.HIRISE).all(axis=2)
    complete = np.isfinite(z).all(axis=2) & np.isfinite(s).all(axis=2)
    known = hirise & complete
    with np.errstate(invalid="ignore"):
        elev = np.where(np.isfinite(z).all(axis=2), z.mean(axis=2), np.nan).astype(np.float32)
        mx = np.where(np.isfinite(s).all(axis=2), s.max(axis=2), np.nan).astype(np.float32)
    state = np.full(elev.shape, UNKNOWN, np.uint8)
    state[known] = ASSESSED
    state[known & (mx > nogo_deg)] = BLOCKED
    return elev, mx, state


def mean_over_known(values: np.ndarray, state: np.ndarray) -> float:
    keep = state != UNKNOWN
    return float(values[keep].mean()) if keep.any() else float("nan")
