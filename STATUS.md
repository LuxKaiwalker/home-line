# STATUS

One section per session (AGENTS.md "Repo rules"). Each session updates only its own section at every milestone. Timestamps in UTC (ISO 8601 with Z, `config/event.yaml`).

## B0 Bootstrap

Branch: `main`

### Done

- 2026-11-14T09:34Z: SPEC.md, AGENTS.md, briefs/, docs/ exported from Notion; config/*.yaml (11 files) copied verbatim.
- Scaffold: pyproject (uv, Python 3.11), Makefile stubs, pipeline/ tree (SPEC §4.3), web/ Vite + TS skeleton, LICENSE, `data` -> ~/hl-data symlink.
- 2026-11-14T09:34Z: pushed skeleton to origin/main.
- 2026-11-14T09:39Z: contracts v1.0.0 (32 schemas, contracts/README.md), tools/validate_contracts.py, tests/test_contracts.py.
- CI workflow `.github/workflows/ci.yml`: ruff, pytest, tsc --noEmit, vite build, contract validation, no-dummy-in-public, 50 MB size check; all steps green locally.

### Doing

- —

### Next

- WS6 adds the H0 provenance check (`pipeline/provenance/check_h0.py`) to CI.
- Producers propose structures for the loose schemas (partner, route, horizon_ring, coverage, rems, clock, fp3d_index details) to C.

### Blocked

- —

### Assumptions added

- Web paths `validation/coverage.json` and `validation/coreg.json` (brief WS1 names the files only).
- `fp3d/index.json` key names `bounds`, `chunk_grid`, `height_scale` (SPEC §6.1 gives the content only).
- `nav/fix_interval_summary.json` is one file with a `set` field, as SPEC §6.2 writes it.

## M0 Dummy data

Branch: `m0-dummy`

### Done

- —

### Doing

- —

### Next

- —

### Blocked

- —

### Assumptions added

- —

## D0 Discovery

Branch: `d0-discovery`

### Done

- —

### Doing

- —

### Next

- —

### Blocked

- —

### Assumptions added

- —

## C Integration

Branch: `main`

### Done

- —

### Doing

- —

### Next

- —

### Blocked

- —

### Assumptions added

- —

## WS1 Terrain

Branch: `ws1-terrain`

### G0 report (DRAFT for S sign-off, 2026-11-14T09:58Z)

All numbers from today's fresh downloads (`data/raw/terrain/`, cache index `cache_index.json`) and
`data/interim/terrain/*.json`. Grids: analysis CRS (`site.yaml crs.analysis_proj`), pad = `pad_default`.

- **DEM:** merged DEM v3 rows 35993-44194 pulled once as 21 full-width row bands (722 MB on the
  wire), reprojected to `dem_1m.tif` (7,800 x 7,800 at 1 m, pad +/- 3,900 m), 100% valid.
  Pad elevation -3627.74 m (D0 nearest pixel: -3627.68 m).
- **Source mask (D3 = recommended default applied, AWAITING CONFIRMATION):** union of the STAC
  `mro_hirise_socet_dtms` footprint quads of the 4 pairs the merged DEM's Astropedia page lists
  (009149, 019698, 009650, 001488; 040770 is in STAC but not in the list). Quads cover 100% of the
  planning extent: HiRISE 100%, CTX/HRSC 0%, nodata 0%.
  - Evidence against over-trusting quads (quads are not valid-data outlines, D0 2.2): 1 m texture
    (RMS of 9 m high-pass over 25 m) inside the quads has median 0.111 m, p5 0.035 m; an upsampled
    CTX 20 m DEM has p95 0.055 m. **5.5% of the 30-min disc has texture below the CTX p95.** If
    those cells were called non-HiRISE (option C), assessed coverage would be 93.8% (30-min) and
    79.1% (60-min). Option B (all 5 STAC quads) = A (100%).
- **Coverage (3 m cell states, flat discs at 0.98 m/s):**
  | Disc | Radius | Assessed | Blocked (>20 deg) | Unknown |
  | --- | --- | --- | --- | --- |
  | 30 min | 1,764 m | 58.77% | 41.23% | 0.00% |
  | 60 min | 3,528 m | 68.64% | 31.36% | 0.00% |
- **Pad check:** known (assessed + blocked) = 100% of the 30-min disc >= 90%: **pass** under the
  data-coverage reading. Under a strict "state 0 only" reading it is 58.77%: **fail**. S/C to say
  which reading SPEC F1 means (see Blocked).
- **Blocked share is high:** 24.2% of 1 m HiRISE cells exceed 20 deg (Horn 3x3); the 5 m plane fit
  gives 23.7%, so it is not only 1 m noise. 17-20 deg ("beyond tested") is 9.1% of the 30-min disc.
  Ridge cells (> 0.75 m above the 15 m median): 1.4% of 1 m cells.
- **Co-registration** (grid search +/-200 m, 2 m, MAD, 537 MMGIS drive ends inside the window):
  best shift **dx = 0, dy = 0 m** (frame check passes); residual median -0.000 m, **MAD 0.037 m**,
  p5/p95 -0.128/+0.107 m. MAD rises to 0.13-0.15 m at +/-2 m, so the minimum is sharp.
  Inference (not verified): residuals this small suggest MMGIS `elev_geoid` is itself sampled from
  this DEM, so coreg is a frame check, not an independent accuracy check.
- **HiRISE cross-check (never used for routing):** merged - HiRISE median **-14.54 m** (009149,
  P90 |diff| 36.57 m) and **-9.43 m** (019698, P90 |diff| 15.34 m). Both HiRISE COGs also sit
  horizontally offset from the merged DEM (best shift 009149: +68/+34 m, MAD 3.57 m; 019698: -26/+32 m,
  MAD 1.41 m). D0 saw +11.6 m HiRISE - merged at the pad, same sign. The controlled HiRISE COGs are in
  a different frame from the merged DEM; the merged DEM agrees with the rover.
- **pad_default** (137.382, -4.806) is not reproduced by any centroid of the 176 drive ends with
  sol >= 4410 (approx. 2025-01-01): mean 174.8 m away, median 83.1 m, in-focus (148) mean 265.0 m,
  in-focus median 73.9 m. Not changed (C/user decide).

### Done

- Started 09:47Z; KATs first (ported): `tests/test_coverage.py`, `tests/test_coreg.py`, 26 pass.
- dem_1m, source_mask, coverage.json/.png, coreg.json, drive_ends_coreg.json, grid.json.
- 3 m routing grids for **WS2**: `elev_3m.tif`, `maxslope_3m.tif`, `cellstate_3m.tif`,
  `dataedge_3m.tif` (all 0: no unknown cells), `ridge_3m.tif`; plus `slope_1m.tif`, `slope_5m.tif`,
  `roughness_5m.tif`, `ridge_index.tif` (WS6 V1 can use `slope_1m.tif`). 2,468 x 2,468 at 3 m.
- `hirise_xcheck.json`; `crism_d2300_18m.tif`, `crism_sindex2_18m.tif` (89.2% valid).
- `stations.json` (values part, `data/interim/terrain/`): S1 137.391523, -4.810007 (value 0.8683);
  S2 137.383058, -4.776687 (0.7443); S4 = MMGIS 107_2484, sol 4200, 137.408864, -4.785707 (0.4750);
  S3, S5 null until S picks. Scoring normalisation in `stations.yaml scoring_assumptions` (assumed).
- Far field for **WS3**: `mola_hrsc_200m.tif` (pad +/- 83.8 km, 200 m, 100% valid, fetched with
  GTIFF_DIRECT_IO, 2.3 MB) and `ctx_20m.tif` (pad +/- 33.7 km, 20 m; 3 geoid-adjusted CTX items,
  each levelled to MOLA-HRSC by its median; **70.8% of the 33.7 km disc valid**, NaN elsewhere: use
  MOLA-HRSC there). One item rejected by QA (P22_009505__P22_009571: median -55.3 m vs MOLA-HRSC).
  Details in `farfield.json`.
- Ortho for **WS8**: `ortho_lrgb_1m.tif` (Gale HiRISE LRGB COG, RGBA on the dem_1m grid);
  registration check vs DEM hillshade in 3 boxes: shifts <= 2 px (1 m).
- Basemap: `data/interim/terrain/tiles/basemap/{z}/{x}/{y}.png`, XYZ z13-z18 (10 m to 0.32 m/px on
  Mars lon/lat, D4); z13-16 from the 1 m LRGB over the DEM window, z17-18 from 0.25 m over the focus
  area. **2,760 tiles, 292 MB** (largest tile < 1 MB). `basemap.json` has per-zoom counts.
  Source is the LRGB colour mosaic (100% focus coverage), not `ESP_019698_1750_RED` (84.6%).
- Downloads total: **1,050 MB** (DEM 722, HiRISE DTMs 178, CTX 71, LRGB 47, CRISM 9, MOLA 2).
- KATs: 27 pass (`tests/test_coverage.py`, `tests/test_coreg.py`); ruff clean; interim contracts OK.

### Doing

- Waiting for G0 sign-off (S) and decisions below.

### Next

- After V1 (WS6): `cellstate_3m_conservative.tif`.

### Blocked

- D3 confirmation (user, G0): STAC quads applied; texture evidence above.
- Pad-check reading (S/C): "assessed" = known data (pass, 100%) or state 0 only (fail, 58.77%)?
- `pad_default`: keep 137.382, -4.806 or move to a stated centroid (numbers above)? User decides.
- S3, S5 hand picks (S): positions not yet in `stations.yaml`.
- Basemap size (C): 292 MB of PNG tiles is a lot for git/Pages. Options: drop z18 (1,406 tiles),
  or switch to JPEG/WebP tiles (needs a brief/contract change; brief says PNG).
- Provenance: WS6 `manifest.py` not on main; entries go to
  `data/interim/terrain/manifest_pending.json` via `pipeline/terrain/prov.py`; re-run when it lands.

### Assumptions added

- `site.yaml`: `ctx_qa` (reject |median vs MOLA-HRSC| > 50 m, level to MOLA) assumed.
- `stations.yaml`: `scoring_assumptions` (normalisation, per-station CRISM index, 25 m pick cells,
  S2 300 m separation and same domain as S1) assumed; S to confirm before D8.
- `site.yaml`: `raw_fetch_margin_m` 200, `raw_fetch_chunk_rows` 400, `download_budget_bytes` 3 GB,
  `texture_check` (D3 evidence only) - all `assumed: true`; `dem_window_buffer_m` 200 (brief).
- Non-HiRISE valid cells are coded 2 (CTX and HRSC are not separable without footprints); code 3
  is never assigned.

## WS2 Engine

Branch: `ws2-engine`

### Done

- —

### Doing

- —

### Next

- —

### Blocked

- —

### Assumptions added

- —

## WS3 Horizon

Branch: `ws3-horizon`

### Done

- —

### Doing

- —

### Next

- —

### Blocked

- —

### Assumptions added

- —

## WS4 Conditions

Branch: `ws4-conditions`

### Done

- —

### Doing

- —

### Next

- —

### Blocked

- —

### Assumptions added

- —

## WS5 Web

Branch: `ws5-web`

### Done

- —

### Doing

- —

### Next

- —

### Blocked

- —

### Assumptions added

- —

## WS6 Provenance

Branch: `ws6-provenance`

### Done

- —

### Doing

- —

### Next

- —

### Blocked

- —

### Assumptions added

- —

## WS7 HUD

Branch: `ws7-hud`

### Done

- —

### Doing

- —

### Next

- —

### Blocked

- —

### Assumptions added

- —

## WS8 3D

Branch: `ws8-3d`

### Done

- —

### Doing

- —

### Next

- —

### Blocked

- —

### Assumptions added

- —

## WS9 Navigation

Branch: `ws9-nav`

### Done

- —

### Doing

- —

### Next

- —

### Blocked

- —

### Assumptions added

- —

## WS10 Visual odometry

Branch: `ws10-vo`

### Done

- —

### Doing

- —

### Next

- —

### Blocked

- —

### Assumptions added

- —
