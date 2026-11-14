"""Ortho texture chunks for the 3D view (WS8, F20): ``fp3d/near_tex/{i}_{j}.jpg``.

One JPEG per written near chunk, covering exactly that chunk's square (row 0 = north, column 0 =
west), ``texture.chunk_px`` pixels per side (config/fp3d.yaml). Each texel is the area mean of the
ortho over the texel. Source: WS1 ``ortho_lrgb_1m.tif`` (HiRISE LRGB mosaic, 8-bit RGB + alpha;
colour where the colour strip covers, greyscale elsewhere, as SPEC F20 asks). A texel is valid
only when every source pixel under it has alpha > 0; invalid texels get ``nodata_rgb`` (the
untextured ground colour), never invented detail. A chunk with no ortho at all gets no texture
(the client draws it untextured). Input values are 8-bit DN and clipped to 0..255.
"""

from __future__ import annotations

import io
from pathlib import Path

import numpy as np
from affine import Affine
from PIL import Image

from pipeline.export.terrain_chunks import TEX_DIR, ChunkGrid, resample_mean


def chunk_texture(rgb: np.ndarray, tr: Affine, grid: ChunkGrid, i: int, j: int, *, tex_px: int,
                  nodata_rgb: tuple[int, int, int] | list[int]) -> tuple[Image.Image, int]:
    """RGB texture of chunk (i, j) from a (3, H, W) float array with NaN = no data.

    Returns (image, number of no-data texels). Raises ValueError when the chunk has no ortho."""
    w, _, _, n = grid.chunk_bounds_xy(i, j)
    res = grid.size_m / tex_px
    bands = np.stack([resample_mean(rgb[b], tr, w, n, res, (tex_px, tex_px)) for b in range(3)],
                     axis=2)
    ok = np.isfinite(bands).all(axis=2)
    if not ok.any():
        raise ValueError(f"chunk {i}_{j}: no ortho")
    out = np.empty_like(bands)
    out[ok] = bands[ok]
    out[~ok] = np.asarray(nodata_rgb, dtype=float)
    img = Image.fromarray(np.clip(np.round(out), 0, 255).astype(np.uint8), mode="RGB")
    return img, int((~ok).sum())


def encode_jpeg(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=int(quality), optimize=True)
    return buf.getvalue()


def export_textures(rgb: np.ndarray, tr: Affine, grid: ChunkGrid, chunks: list[tuple[int, int]],
                    out_dir: Path, *, tex_px: int, quality: int,
                    nodata_rgb: tuple[int, int, int] | list[int]) -> list[dict]:
    """Write ``<out_dir>/fp3d/near_tex/{i}_{j}.jpg``; returns [{i, j, tex, bytes, nodata_px}]."""
    out_dir = Path(out_dir)
    (out_dir / TEX_DIR).mkdir(parents=True, exist_ok=True)
    out = []
    for i, j in chunks:
        try:
            img, nod = chunk_texture(rgb, tr, grid, i, j, tex_px=tex_px, nodata_rgb=nodata_rgb)
        except ValueError:
            continue
        rel = f"{TEX_DIR}/{i}_{j}.jpg"
        data = encode_jpeg(img, quality)
        (out_dir / rel).write_bytes(data)
        out.append({"i": i, "j": j, "tex": rel, "bytes": len(data), "nodata_px": nod})
    return out


def read_rgba(path: Path, grid: ChunkGrid, chunks: list[tuple[int, int]], margin_px: int = 2
              ) -> tuple[np.ndarray, Affine]:
    """Read the window of an RGB(+alpha) ortho covering ``chunks`` as (3, H, W) float32 with NaN
    where alpha == 0 (or the RGB nodata value). Pixels outside the file are NaN."""
    import rasterio
    from rasterio.windows import from_bounds

    xs = [grid.chunk_bounds_xy(i, j) for i, j in chunks]
    w = min(b[0] for b in xs)
    s = min(b[1] for b in xs)
    e = max(b[2] for b in xs)
    n = max(b[3] for b in xs)
    with rasterio.open(path) as ds:
        win = from_bounds(w, s, e, n, ds.transform).round_offsets().round_lengths()
        win = rasterio.windows.Window(win.col_off - margin_px, win.row_off - margin_px,
                                      win.width + 2 * margin_px, win.height + 2 * margin_px)
        a = ds.read(window=win, boundless=True, fill_value=0, masked=False)
        tr = ds.window_transform(win)
        rgb = a[:3].astype(np.float32)
        if ds.count >= 4:
            bad = a[3] == 0
        elif ds.nodata is not None:
            bad = (a[:3] == ds.nodata).all(axis=0)
        else:
            bad = np.zeros(a.shape[1:], dtype=bool)
        rgb[:, bad] = np.nan
    return rgb, tr


def export_textures_from_file(path: Path, grid: ChunkGrid, chunks: list[tuple[int, int]],
                              out_dir: Path, *, tex_px: int, quality: int,
                              nodata_rgb: tuple[int, int, int] | list[int]) -> list[dict]:
    """Per chunk: read its window of the ortho (bounded memory) and write the texture."""
    out = []
    for ij in chunks:
        rgb, tr = read_rgba(path, grid, [ij])
        out += export_textures(rgb, tr, grid, [ij], out_dir, tex_px=tex_px, quality=quality,
                               nodata_rgb=nodata_rgb)
    return out
