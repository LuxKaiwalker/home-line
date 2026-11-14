"""Far terrain mesh for the 3D view (WS8, F20): ``fp3d/far.f32.gz``.

One height grid at ``far.res_m`` (config/fp3d.yaml, 8 m per contracts/README.md) over the whole
near-chunk grid extent (same NW corner ``origin_xy_m``, so ``width = height = n * S / res``; the
dummy's 928 x 928). Each cell is the area mean of the best source that covers it completely
(sources in priority order, e.g. the 1 m DEM, then CTX 20 m, then MOLA-HRSC); cells no source covers
are filled from the nearest valid cell. Same byte layout as the near chunks
(see :mod:`pipeline.export.terrain_chunks`).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from affine import Affine

from pipeline.export.terrain_chunks import (
    FAR_FILE,
    ChunkGrid,
    encode_heights,
    fill_nodata,
    resample_mean,
)


def far_shape(grid: ChunkGrid, res_m: float) -> tuple[int, int]:
    n = int(round(grid.extent_m / res_m))
    if abs(n * res_m - grid.extent_m) > 1e-6:
        raise ValueError(f"far res {res_m} m does not divide the grid extent {grid.extent_m} m")
    return (n, n)


def far_cell_centres(grid: ChunkGrid, res_m: float) -> tuple[np.ndarray, np.ndarray]:
    """x of each column and y of each row (row 0 = north) of the far grid."""
    rows, cols = far_shape(grid, res_m)
    return (grid.x0 + (np.arange(cols) + 0.5) * res_m,
            grid.y0 - (np.arange(rows) + 0.5) * res_m)


def far_heights(sources: list[tuple[np.ndarray, Affine]], grid: ChunkGrid, res_m: float
                ) -> np.ndarray:
    """Far grid heights: per cell, the area mean from the first source covering it fully."""
    shape = far_shape(grid, res_m)
    out = np.full(shape, np.nan)
    for arr, tr in sources:
        todo = ~np.isfinite(out)
        if not todo.any():
            break
        v = resample_mean(arr, tr, grid.x0, grid.y0, res_m, shape)
        out[todo] = v[todo]
    filled, _ = fill_nodata(out)
    return filled


def export_far(sources: list[tuple[np.ndarray, Affine]], grid: ChunkGrid, res_m: float,
               out_dir: Path, quantum_m: float) -> dict:
    """Write ``<out_dir>/fp3d/far.f32.gz``; returns the index.json ``far`` entry (no bounds)."""
    h = far_heights(sources, grid, res_m)
    data = encode_heights(h, quantum_m)
    path = Path(out_dir) / FAR_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    rows, cols = h.shape
    return {"file": FAR_FILE, "res_m": float(res_m), "width": cols, "height": rows,
            "bytes": len(data)}
