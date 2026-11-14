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

- 2026-11-14T09:49Z: `tools/make_dummy.py` per docs/dummy.md against contracts v1.0.0: deterministic (seed 20261114), offline, ~15 s; writes 135 files, 8.5 MiB to `web/public/data-dummy/` (fields 4.4 MiB, scenarios 3.7 MiB, fp3d 0.8 MiB). Every index file and every other object-shaped JSON file has `"dummy": true`.
- Files: `scenarios/index.json` (nom_104, opt_104, con_104), isochrones 1–60 min, `bands_104`, edges (physiology/slope/data), partner circles; `fields/index.json` + 17 PNGs (t_home, o2_home ×3 scenarios; home_bearing, 6 worst-case fields for nom_104; shared slope; `fix_interval_medium`); `stations.json`, `cards/S1–S3.json` + grey placeholder; `route_nom_104.geojson`, `timeline_nom_104.json`; `trade_table.json`; `pad.json`; `conditions/rad.json`; `nav/montecarlo_medium.json`, `nav/fixes.json`, `nav/tracks_medium.geojson`, `nav/fix_interval_summary.json`; `fp3d/index.json`, 45 near chunks + tan textures, `far.f32.gz`, `horizon_ring.json`; `manifest.json` (every dummy number, script `tools/make_dummy.py`).
- `make dummy` wired. `tests/test_make_dummy.py` (15 tests): determinism (two runs byte-identical), every file validates via `tools/validate_contracts.py` with no warnings, dummy tree fails as public data, size ≤ 10 MB, PNG encoding KATs (T_home = 0 at the pad, hole unknown, worst ≥ point), station T_home = field, RAD tripwire before peak + leash recomputes, nav r95 = 2% of distance, fp3d chunk sizes and 3D budget, committed tree = fresh run.
- ruff, pytest (86 passed), validate_contracts all green.

### Doing

- —

### Next

- Regenerate with `make dummy` if a contract or config format setting changes (the committed-tree test fails when the tree is stale).

### Blocked

- —

### Assumptions added

- Dummy-only constants (synthetic world, speeds 0.9/1.0/0.8 m/s, 0.25 L/min O2, storm shape) live at the top of `tools/make_dummy.py` with `DUMMY_` names; they are not in `config/` because they must never reach the real pipeline.
- Manifest `utc` is fixed at `2026-11-14T09:00:00Z` and `commit` is `"dummy"` so the output is byte-deterministic (after `h0_utc`, so the H0 check passes).
- Also generated `pad.json` and `nav/fix_interval_summary.json` (not listed in docs/dummy.md, but the contracts define them and pad.json requires `dummy`).
- Field index keys are `{scenario}/{name}`, `slope` (shared, `scenario: null`, file `fields/shared/slope.png`) and `fix_interval_medium` (`scenario: nom_104`).
- The synthetic terrain is defined over the whole planning extent (the 2 × 2 km tile places the features); the CTX strip runs N–S across the extent. Its cells keep valid T_home and are only labelled `data` at edges; the nodata hole and wall cells are unknown (A = 0).
- Timeline `o2_left_L` starts from `crew.yaml o2_budget.primary_L` (504 L); margin = EVA − reserve − t − T_home.
- Card landmarks are synthetic (`DUMMY synthetic hill`, `DUMMY synthetic wall`, `Pad`), since real ones need H0-verified coordinates.
- `fp3d/index.json` `chunk_grid` holds `cols`, `rows`, `chunk_px`, `res_m`, `origin_xy_m`, `crs`, `chunks[]`; the extra keys `height`, `far`, `horizon_ring` record byte order (little-endian float32), row order (north to south) and the pad-relative datum (WS8 may refine).

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

- 2026-11-14T10:05Z: M1 horizon ray engine (`pipeline/horizon/rays.py`, Numba, 1,440 rays, sampling 1 m / 20 m / 200 m from `horizon.yaml`, curvature d²/2R, coarser-band fallback, NaN = unknown) and CAHV/CAHVOR/CAHVORE projection + rover→site attitude chain (`pipeline/horizon/cahvor.py`). Ported from the pre-H0 reference code, checked against contracts v1.0.0 and the fresh discovery.md. KATs: curvature drop 58.9 m at 20 km; 100 m wall at 1 km from 1.7 m = 5.61°; flat plane = −dip within 0.01°; projection round trip < 0.5 px; attitude chain round trip.
- 2026-11-14T10:20Z: Navcam cache (`pipeline/horizon/navcam.py`): raw-image API (full NAV_LEFT_B frames, `extended=full::sample_type::eq`), cache `data/raw/navcam/` with `index.json`; stop order = S4 by its stations.yaml rule (drive end nearest sol 4200 → 107_2484, as discovery 3.2) then farthest-point over the 290 focus-area drive ends at 30 m spacing (116 stops). **Real-frame KATs pass** on 3 fresh API frames from 2 drive ends (107_2484, 125_2490): A-vector az/el vs `mast_az/mast_el` and rover yaw/pitch/roll vs MMGIS within 1°; C height inside the discovery 3.4 range. A cached-frames variant checks 3 more stops.
- 2026-11-14T10:35Z: sky detector (`pipeline/horizon/sky.py`) = the `horizon.yaml` rule + 2 px border + σ 2 px pre-smoothing (evidence below).
- 2026-11-14T10:55Z: far-field bands (`pipeline/horizon/bands.py`): MOLA-HRSC 84 km window (GTIFF_DIRECT_IO) and a 3-item CTX `geoid_adjusted_dem` mosaic (34 km disc, 70.8 % footprint), all reprojected to the analysis CRS in `data/interim/horizon/bands/`. One CTX item (P22_009505…P22_009571) is 55 m below MOLA-HRSC and was rejected by the alignment check; the next-best item replaced it. Band offsets (coarse − fine, median): CTX − dem_1m **+15.6 m** (p5/p95 −4.6/+43.1), MOLA − dem_1m +0.5 m, CTX − MOLA +2.9 m.
- 2026-11-14T11:05Z: WS1 `dem_1m.tif` (7,800² at 1 m, coreg dx = dy = 0) is on disk, so I started the real stop horizons: `horizons/v{site}_{drive}.json` at Navcam height for every stop with candidate frames; frame selection now keeps a frame only where the DEM-predicted skyline is testable (below the detector's reference band, inside the frame) in ≥ 50 % of columns. **Result: 49 frames at 36 stops** (`navcam_frames.json`, validates).
- 2026-11-14T11:10Z: first **automatic V2** (`pipeline/validation/v2_skyline.py`, `validation/v2.json` validates, manifest keys `v2.*`): 49 frames tried, 35 ok at 27 stops, 14 failed (no clear sky at the top of the frame; reported, not dropped). Median |error| near 0.095° (n 2,016 columns), mid 0.196° (n 951), **far 4.30° (n 26,861, P90 7.89°)**. 49 check composites in `data/interim/horizon/validation/overlays/`. The far figure is not quotable yet: see Blocked 1.
- `make horizons` wired (bands → navcam fetch with stop horizons → V2). 58 WS3 KATs pass; full suite 197 pass; ruff clean. Downloads: Navcam cache 51.1 MB (API JSON + JPG, from `index.json`); MOLA window ≈ 2.2 MB (discovery's measurement for this window; not re-measured); CTX windows 25 MB on disk (network bytes not measured, other agents share the machine counter).

### Doing

- —

### Next

- Station and pad horizons, panoramas with the 8 IAU landmarks, `horizon_ring.json` for WS8 and card fragments: waiting for `stations.json` and `pad.json` (WS1/WS2; not on disk yet).
- Manual check of the 10 sampled frames (`manual_check: true` in v2.json) once C decides Blocked 1.
- Hand the engine API (`bands.load_engine()`, `HorizonEngine.horizons(xs, ys, az_step_deg=1, min_dist_m=500)`), `sky.detect_skyline` and `navcam_frames.json` to WS9.

### Blocked

1. **V2 far class and D7 (C decides).** The chain itself checks out: 13 of 35 ok frames (12 stops) have median error within ±0.5° (e.g. NLB_824771281 at v120_1264: near 0.46°, mid 0.21°). But 21 frames have median error ≤ −2° (−3.2 to −7.6°), and all face north (az 335–30°). There the predicted skyline is the crater rim at 37–54 km (+1 to +1.5°), which is hidden by haze in the image, so the detector finds the lower visible terrain. Options: (a) the 20 % manual check marks such frames `manual_ok: false` ("far rim not visible"), and the far figure is computed over the rest; (b) switch to fully manual (D7); (c) report the far class as is. I have not decided; v2.json is automatic only.
2. **Duplicate far-field bands (C).** WS1 also built `data/interim/terrain/{ctx_20m,mola_hrsc_200m}.tif` (`farfield.json`) from the same 3 CTX items with the same rejection, and levels CTX to MOLA. I use my own (`data/interim/horizon/bands/`, not levelled), as the session prompt said. Which source is canonical? Switching is a path change in `horizon.yaml bands`.
3. **Navcam height (C).** Horizons at stops use `navcam_height_m` 1.9 above DEM ground. The per-frame C height above the rover-frame origin is 1.88–1.93 m on the fresh frames; the origin's height above the ground is unknown (discovery 3.4). This is left unchanged.

### Assumptions added

All in `config/horizon.yaml`, each with `assumed: true`:
- `band_fallback: coarser`: a sample with no data in its band falls back to the next coarser band.
- `navcam_selection`: NAV_LEFT_B full frames only; 30 m stop spacing; up to 4 frames per stop (widest azimuth spread); `stops_wanted` 36 (30 + 20 %); `max_stops_tried` 120 (all 116 stops); drive-end sol + 1; cache budget 150 MB. Geometric pre-test: top-centre pixel ≥ 0° and bottom-centre ≤ −5° in the site frame. It was 10° first, but that kept only 15 of 116 stops and most of those frames had no sky. Then `min_predicted_skyline_col_frac` 0.5 (DEM-predicted skyline testable in ≥ 50 % of columns).
- `sky_detector_params` (structured copy of the prose rule, 3× / top 10 %): `zero_median_guard` one DN; `border_px` 2 and `presmooth_sigma_px` 2.0. Evidence from fresh frames: row 0 is 235–254 DN, row 1 is ~20 DN above row 2, column 0 is ~25 DN darker and the last row is bright (12 frames). On 6 frames with visible sky, the rule as written (σ 0) fires on sky noise in 94–98 % of columns at about row 30. σ 2 traces the skyline on 4 of 6; on the other 2 the true skyline lies inside the reference band. Known failure: σ 2 can prefer a sharp near ridge over a faint hazy far rim (seen on 2 frames); σ 1 follows the rim but adds noise speckles.
- `v2_frame_fail.max_in_ref_band_frac` 0.5: a frame whose boundary sits in the reference band in > 50 % of columns is failed and reported.
- `bands`: CTX listing = D0's 500 STAC items at the pad; greedy footprint gain, max 3 items, ≥ 1 % gain; reject an item whose median offset to MOLA-HRSC is > 20 m; radii 34 km (CTX) and 84 km (MOLA-HRSC); 20 m and 200 m grids.
- `overlay`, `panorama`: colours and sizes (presentation only).
- Landmarks: the 8 IAU names verified by D0 (discovery 3.5). The informal names are dropped (no verified coordinate). Not used yet.

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

> **Manifest API for every workstream (F16, AGENTS.md rule 6).** Use it for every number the app
> shows:
>
> ```python
> from pipeline.provenance.manifest import record
> record("rad.storm_2024.peak_uGy_day", 8250.0, "uGy/day", "conditions/rad.json", __file__)
> #      key (dotted, unique, no spaces) value  units (None if not numeric)  web file  script
> ```
>
> - `record` adds `commit` (HEAD, `-dirty` if uncommitted code) and `utc` (ISO 8601 Z), validates
>   against `contracts/manifest.schema.json`, and writes a per-script fragment to
>   `data/interim/manifest/<script>.json`. Re-running your script overwrites your own keys.
> - Values: numpy is converted; NaN/inf are refused, so pass `None` for unknown.
> - `file`: the path under `web/public/data/` the number is shown from (e.g. `validation/v1.json`).
> - Prefix keys with your topic (`v1.`, `rad.`, `nav.`, `reachable_pct.` ...). Two scripts writing
>   the same key make the merge fail.
> - Merge (C / `make web`): `uv run python -m pipeline.provenance.manifest merge [--out PATH] [--dummy]`
>   writes `web/public/data/manifest.json`.
> - Tests: set `HOMELINE_MANIFEST_DIR` to a tmp dir (monkeypatch) so test records never land in
>   the shared `data/interim/manifest/`.
> - `record` refuses to write if the clock reads before H0. CI runs
>   `python -m pipeline.provenance.check_h0` (fails on any manifest `utc` or data mtime in
>   `web/public/data/` before H0 from `config/event.yaml`); add `--fragments data/interim/manifest`
>   to check the fragments locally.

### Done

- 2026-11-14T09:44Z: M1 manifest API (`pipeline/provenance/manifest.py`: `record`, `merge`, CLI) and
  `pipeline/provenance/check_h0.py` (H0 from `config/event.yaml`), H0 step in
  `.github/workflows/ci.yml`; 23 KATs pass (F16). Pushed 461c441.
- 2026-11-14T09:50Z: V1 tilt code (`pipeline/validation/v1_tilt.py`, F13): plane-fit DEM tilt over the
  footprint, bias/RMSE/r/confusion at 10/20 deg, MMGIS loader (negative `tilt` -> invalid,
  per discovery 3.1), WS1 coreg shift input, sensitivities (other footprint candidate, IMU from
  roll/pitch), manifest keys `v1.*`; `run_real` + CLI refuse to run while the footprint is open.
  KATs on synthetic data incl. the brief's 10% plane (bias 0).
- 2026-11-14T09:50Z: V1 scatter figure (`pipeline/validation/figures.py`, dependency-free SVG).
- 2026-11-14T09:50Z: KAT collector `python -m pipeline.provenance.kats` -> `data/interim/validation/kats.json`
  (one row per test: SPEC §9 area, features, outcome, reason; manifest keys `kats.summary.*`).
- Manifest records made under pytest go to a temp dir unless `HOMELINE_MANIFEST_DIR` is set, so
  no workstream's tests can leak into the shared `data/interim/manifest/`.
- `tests/test_provenance.py`: 51 KATs pass; full suite 122 pass; ruff clean.

### Doing

- — (waiting for WS1 `dem_1m.tif` + `coreg.json` and the footprint decision for the real V1)

### Next

- H4–H8: real V1 (`uv run python -m pipeline.validation.v1_tilt --mmgis <cached MSL_waypoints.json>`),
  RMSE to WS1 for the conservative limit.
- Reviewer audit every 4 h (units, CRS, nodata, manifest coverage).
- Freeze: `make clean all` from a clean checkout, provenance audit, sign-off.

### Blocked

1. **V1 footprint (S decides):** SPEC F13 / brief say "≈3 m footprint"; `config/site.yaml`
   `slope.compare_window_m` is 5. `config/validation.yaml` `v1.footprint_m` is `null` until S sets
   it; the other candidate is reported as a sensitivity. The real V1 run exits 2 until then.
2. **WS1 coreg shift sign (WS1/S):** V1 adds `coreg.json` (`dx_m`, `dy_m`) to the MMGIS
   positions (analysis-CRS x/y) to put them in the DEM frame. Please confirm that sign convention,
   or tell me the opposite. Also confirm the paths `data/interim/terrain/{dem_1m.tif,coreg.json}`.
3. **KAT contract (C):** the scorecard's KAT list (`validation/kats.json`) has no contract. Proposal:
   `pipeline/provenance/kats.schema.proposed.json`; please copy it to `contracts/kats.schema.json`
   and map `validation/kats.json` in `tools/validate_contracts.py`. `kats.py` uses the contract
   automatically once it exists.
4. **Makefile (C):** please wire `make web` to run
   `uv run python -m pipeline.provenance.manifest merge` and
   `uv run python -m pipeline.provenance.check_h0`, and add a target for
   `uv run python -m pipeline.provenance.kats --exit-zero` (KAT list for the scorecard).

### Assumptions added

- `config/validation.yaml` (new; no config file held V1 constants): `v1.confusion_thresholds_deg`
  [10, 20] (SPEC F13), `v1.footprint_m` null (open), `v1.footprint_candidates_m` [3, 5],
  `v1.dem_method: plane_fit_square` with `dem_method_assumed: true` (least-squares plane over the
  DEM cells whose centres fall in a footprint-sized square; any nodata cell excludes the drive end).
- V1 IMU tilt = MMGIS `tilt` (deg); negative or missing values are invalid and counted, not fixed.

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
