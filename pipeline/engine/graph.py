"""Routing grid and the 16-neighbour directed move set (SPEC F4, D6).

The graph is implicit: every cell of the 3 m grid links to its 8 neighbours and 8 knight moves.
Edge time t(x->y) = length / v*(theta_xy), theta_xy from the elevation difference over the
horizontal length (physio.GradeTable). A move is allowed only if both end cells are passable
and every cell its straight segment crosses is passable (no corner cutting, no knight jumps
over a one-cell wall). Cell states follow contracts/README.md (cellstate_3m.tif).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

ASSESSED, BLOCKED, UNKNOWN = 0, 1, 2

# (drow, dcol); rows grow southwards, cols eastwards.
OFFSETS = np.array(
    [
        (-1, 0), (1, 0), (0, -1), (0, 1),
        (-1, -1), (-1, 1), (1, -1), (1, 1),
        (-2, -1), (-2, 1), (2, -1), (2, 1),
        (-1, -2), (-1, 2), (1, -2), (1, 2),
    ],
    dtype=np.int64,
)  # fmt: skip


def _crossings() -> tuple[np.ndarray, np.ndarray]:
    """Intermediate cells (relative to the move's origin) each move's segment passes through."""
    cross = np.zeros((16, 2, 2), dtype=np.int64)
    n = np.zeros(16, dtype=np.int64)
    for k, (di, dj) in enumerate(OFFSETS):
        if abs(di) == 1 and abs(dj) == 1:
            cells = [(di, 0), (0, dj)]
        elif abs(di) == 2:
            cells = [(di // 2, 0), (di // 2, dj)]
        elif abs(dj) == 2:
            cells = [(0, dj // 2), (di, dj // 2)]
        else:
            cells = []
        for m, c in enumerate(cells):
            cross[k, m] = c
        n[k] = len(cells)
    return cross, n


CROSS, NCROSS = _crossings()
UNIT_LENGTH = np.hypot(OFFSETS[:, 0], OFFSETS[:, 1]).astype(np.float64)


@dataclass
class Grid:
    """A routing grid in the analysis CRS (north-up, square cells)."""

    elev: np.ndarray  # float64, metres
    passable: np.ndarray  # bool
    res_m: float
    x0: float  # west edge, analysis-CRS metres
    y0: float  # north edge
    crs: str
    cellstate: np.ndarray | None = None  # uint8 (0 assessed, 1 blocked, 2 unknown)
    maxslope: np.ndarray | None = None  # degrees

    @property
    def shape(self) -> tuple[int, int]:
        return self.elev.shape

    def xy_of_rc(self, r, c):
        """Cell-centre coordinates."""
        x = self.x0 + (np.asarray(c) + 0.5) * self.res_m
        y = self.y0 - (np.asarray(r) + 0.5) * self.res_m
        return x, y

    def rc_of_xy(self, x, y) -> tuple[int, int]:
        c = int(np.floor((x - self.x0) / self.res_m))
        r = int(np.floor((self.y0 - y) / self.res_m))
        if not (0 <= r < self.shape[0] and 0 <= c < self.shape[1]):
            raise ValueError(f"point ({x}, {y}) outside the grid")
        return r, c

    @property
    def transform(self):
        from affine import Affine

        return Affine(self.res_m, 0.0, self.x0, 0.0, -self.res_m, self.y0)

    def with_nogo(self, nogo_deg: float) -> Grid:
        """Copy whose passable mask uses a variant's slope limit (needs cellstate + maxslope)."""
        if self.cellstate is None or self.maxslope is None:
            raise ValueError("grid has no cellstate/maxslope to re-derive passability")
        g = Grid(**self.__dict__)
        g.passable = passable_mask(self.cellstate, self.maxslope, nogo_deg, self.elev)
        return g


def passable_mask(cellstate, maxslope, nogo_deg: float, elev=None) -> np.ndarray:
    """Passable = not unknown, max 1 m slope within the variant's limit, finite elevation.

    WS1's ``blocked`` state is drawn at one limit; each variant has its own (variants.yaml
    nogo_deg), so blocked is re-derived here from maxslope_3m.
    """
    ok = (np.asarray(cellstate) != UNKNOWN) & (np.asarray(maxslope) <= nogo_deg)
    ok &= np.isfinite(maxslope)
    if elev is not None:
        ok &= np.isfinite(elev)
    return ok


def load_ws1_grid(terrain_dir: Path) -> Grid:
    """Read WS1's elev_3m.tif, maxslope_3m.tif, cellstate_3m.tif (contracts/README.md)."""
    import rasterio

    def read(name):
        with rasterio.open(terrain_dir / name) as ds:
            band = ds.read(1, masked=True)
            return np.ma.filled(band.astype(np.float64), np.nan), ds

    elev, ds = read("elev_3m.tif")
    maxslope, _ = read("maxslope_3m.tif")
    with rasterio.open(terrain_dir / "cellstate_3m.tif") as cs:
        cellstate = cs.read(1).astype(np.uint8)
    t = ds.transform
    if abs(t.a + t.e) > 1e-9 or t.b != 0 or t.d != 0:
        raise ValueError("routing grid must be north-up with square cells")
    return Grid(
        elev=elev,
        passable=cellstate == ASSESSED,  # WS1's own limit; call with_nogo() per variant
        res_m=float(t.a),
        x0=float(t.c),
        y0=float(t.f),
        crs=ds.crs.to_string() if ds.crs else "",
        cellstate=cellstate,
        maxslope=maxslope,
    )
