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

Branch: `c-integration` (merged to `main` by the orchestrator)

### Done

- 2026-11-14T10:35Z: **contracts v1.1.0** (additive; consumer notes in contracts/README.md "Changes"):
  - `partner` (WS2 Q7): feature properties `case`, `casualty_kg`, `contour_min`, `style` (const
    `dashed`), `default_visible` (const `false`), `caption`, `feasible`, `area_km2`; optional.
  - `route` (WS2 Q7): leg properties `leg`, `from`, `to`, `t_min`, `o2_L`, `length_m`,
    `t_start_min`, `t_end_min`, `times_min[]`; optional.
  - `timeline` (WS2 Q7): `margin_binding` (`O2`/`daylight`/`dose`/null), `in_partner_line`, plus
    `o2_tasks_left_L` and `o2_margin_min_planning_rate` (WS2's code writes them); `turn_back` and
    the other event names documented; optional.
  - `rad`: `leash.tau_min_at_latest`, `formula`, `D_allow_note`, `table[]`, `d_allow_range_mgy`,
    `d_allow_step_mgy`; optional.
  - New: `siting_png.schema.json` (`siting_png.json`, WS2), `tilejson.schema.json`
    (`tiles/basemap/tilejson.json`), `cellstate.schema.json` (`terrain/cellstate.json` +
    `terrain/cellstate.png`, F1 cell states: A = 0 unknown).
  - Checked against WS2's code: WS2's engine tests (origin/ws2-engine 4c54e5e) pass with v1.1.0;
    WS2's real run (10:30Z) and WS4's real `rad.json` validate.
  - `SCHEMA_MAP` rows mirrored in `web/src/data/contracts.ts`; version assertions in
    `tests/test_contracts.py` and `web/src/data/contracts.test.ts` accept 1.0.0/1.1.0;
    `web/src/data/loader.test.ts` uses another uncovered path (tilejson is now covered).
  - Dummy tree: `terrain/cellstate.{png,json}` added (5 m, `"dummy": true`); `make dummy`
    regenerated, every other file byte-identical.
- 2026-11-14T10:35Z: **`tools/make_web.py`, `make web`, `make web-plan`** (KATs
  `tests/test_make_web.py`, 17 pass): copies `data/interim/**` to the contract paths in
  `web/public/data/` (table in contracts/README.md "`make web` sources"); refuses `"dummy"` /
  `"synthetic": true`, sources in `data-dummy/`, sources written before H0 and dummy manifest
  fragments, before touching the public tree; keeps producer mtimes; merges the manifest
  (WS6 `merge`), runs `validate_contracts` and `check_h0`; lists missing outputs by owner, files
  named by an index but absent, and size per folder. `--skip-owner WSn` leaves an owner and its
  manifest entries out. WS6 Blocked 4 (make web runs merge + check_h0) done.
- 2026-11-14T10:35Z: **Basemap (WS1 Blocked "basemap size") decided by C:** WebP quality 80,
  z13–18 all kept: **2,760 tiles, 33.1 MB** (from 292 MB PNG). `config/web.yaml` (new, C):
  format, quality, maxzoom 18, budget 50 MB (above it make web drops the top zoom, z18 first).
  `tiles/basemap/tilejson.json`: bounds = z13–16 extent, `zoom_bounds` for z17/z18 (focus only).
- 2026-11-14T10:35Z: **Real web data committed (WS2 skipped):** `make web --skip-owner WS2`:
  2,773 files, **36.3 MB** (tiles 33.1, validation 2.4, terrain 0.6, manifest 0.1, conditions
  0.1, vo); all validate, no dummy flag, largest file 1.6 MB (`validation/v2.json`), H0 check OK, manifest 299 keys.
  Present: WS1 (coverage, coreg, cell states, basemap), WS3 `validation/v2.json`, WS4
  `conditions/{rad,clock,rems,donki}.json`, WS10 `vo/probe.json`.
  Missing: WS3 cards + `fp3d/horizon_ring.json`; WS6 `validation/{v1.json,v1.svg,kats.json}`;
  WS7 fields; WS8 fp3d; WS9 nav/localisation/fix-interval; WS10 `vo/drift.json`.

### Doing

- —

### Next

- Re-run `make web` (with WS2) once WS2 cuts the isochrone size (below), then at each gate.

### Blocked

- **WS2 web files not committed (size).** WS2's run at 10:30Z validates, but
  `scenarios/` is **159.5 MB** for 6 scenarios: `isochrones.geojson` 18.8–23.9 MB each
  (nom_104: 19.3 MB, 2.7 MB gzipped, over `variants.yaml isochrone_size_budget_mb_gz` 1.5),
  `bands_*` 4.2–4.6 MB, `edges` 2.2–3.1 MB. WS2: please bring each isochrone file within the
  budget (the 2-min fallback, or coarser simplification/coordinate rounding per config) before C
  commits WS2's web files. Also: `route_nom_104.geojson` is empty and no `pad.json` /
  `siting.png` yet (expected while stations are unreachable under nominal; reported only).

### Answers to questions for C

- WS2 Q6: WS2 writes the web `stations.json` (`data/interim/engine/public/stations.json`);
  make web copies it. Station cards (`cards/{id}.json`) have no named producer yet: make web takes
  them from `data/interim/horizon/public/cards/` (WS3 card fragments); C to settle with WS3/WS5
  before G2.
- WS2 Q7: done in v1.1.0 (above). Siting: one grey PNG + `siting_png.json`, no tiles.
- WS2 Q8 (F11 partner area / reachable % choice) is a science choice: S.
- WS5 basemap: read `tiles/basemap/tilejson.json` (contract `tilejson.schema.json`; tile URLs are
  relative to the data root). Fields map one to one to `BasemapSource`.
- WS5 unknown terrain: hatch from `terrain/cellstate.png` (A = 0 unknown) placed on
  `terrain/cellstate.json bounds`; same decoder as the field alpha.
- WS5 D9 slider: there is no `leash.d_allow_slider_mgy`. Read `config/conditions.yaml`
  `leash.d_allow_range_mgy` ([min, max]) and `leash.d_allow_step_mgy` at build time (config.ts),
  and τ per step from `rad.json leash.table` (contract v1.1.0; its first/last rows are the range).
- WS5 / WS6 KAT list: `validation/kats.json` has a contract (`kats.schema.json`, mapped); make web
  copies `data/interim/validation/kats.json` once `make kats` has run.
- WS1 provenance: WS6's `manifest.record` is on main; please switch `pipeline/terrain/prov.py`
  to it. Until then make web merges `terrain/manifest_pending.json` as WS1's fragment
  (`pipeline__terrain__build.json`; once that fragment exists, the bridge stops).
- WS3: write card images to `data/interim/horizon/public/cards/{station}/{panorama,overlay}.png`
  and the 3D ring to `data/interim/horizon/public/fp3d/horizon_ring.json`.
- WS7/WS8: write web files under `data/interim/export/` mirroring the web tree
  (`export/fields/…`, `export/fp3d/…`). WS9: `data/interim/navigation/{nav,localisation,fields}/`
  as `pipeline/navigation/real.py` does now.

### Assumptions added

- `config/web.yaml` (new, C): `web_export.basemap` format webp, quality 80, method 4, maxzoom 18,
  budget_mb 50, tile_size_px 256, attribution; format/quality/method/budget `assumed`.
- Web paths `siting_png.json`, `tiles/basemap/tilejson.json`, `terrain/cellstate.{png,json}`.
- Cell states are published at the routing grid's own 3 m (no resampling); codes other than 0/1
  are drawn unknown.

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

- 2026-11-14T09:47Z: F3 `physio.py` exactly per variants.yaml/crew.yaml (a(M), k, Minetti downhill clamp, governor, O2, heat, grade lookup table). KATs `tests/test_physio.py` 65/65 pass (anchor 19 +- 1, monotonic in grade and mass, v* <= v_safe, downhill minimum in -10..-15 %, O2 budget recomputes).
- 2026-11-14T09:49Z: F4/D6 16-neighbour directed graph (no corner cutting / knight jumps) + Numba heap Dijkstra, reverse (return field) and forward. KATs `tests/test_router.py` 32/32 pass (flat T = d/v +- 1 % on all 16 rays, circular envelope within the 16-neighbour lattice bound 1.0275, 10 % plane farther downhill, uphill speed = governor, > 20 deg wall never crossed, unknown never entered, forward/reverse duality). Speed: 2600 x 2600 grid (full 3.7 km planning disc at 3 m) ~7 s per field, so no scipy fallback needed.
- 2026-11-14T09:52Z: on synthetic grids (all KATs pass, 165 WS2 tests total, full suite 235 green):
  - F4/F5/F6 isochrones 1..60 min (2-min fallback above 1.5 MB gz), bands per suit x variant x 30/60, edge causes (dummy world: wall = slope, hole = data), headline on the assessed flat disc, `scenarios/index.json`; rasters `engine/{sid}/t_home.tif`, `o2_home.tif`, `pointer.tif` + `engine/pointer_offsets.json` (legend for WS7/WS9).
  - F10 haul (`tests/test_haul.py` 22/22: 343 kg force by hand, Mars/Moon 2.29, never faster than walking, masked ridges never crossed); partner.geojson dashed, off by default.
  - F8 siting per `site.yaml siting` -> `siting.tif`, `siting.png` + `siting_png.json`, `pad.json` (contract v1.0.0), rover-hop option.
  - F9 exact DP (= brute force on 8 stations) with the SPEC F4 margin check on every leg vertex; route legs with per-vertex `times_min`; timeline with depart/arrive/leave/return, O2 checkpoints every 30 min, turn-back rows, `o2_left_L`, `t_home_min`, `margin_min` + `margin_binding`.
  - F11 trade table. `make engine` = `python -m pipeline.engine.scenarios` (e2e test on WS1-shaped synthetic GeoTIFFs: every product passes `tools/validate_contracts.py`).

- 2026-11-14T10:05Z (session 2): provenance now goes through WS6 `pipeline.provenance.manifest.record` (fragments `data/interim/manifest/pipeline__engine__*.json`); `manifest_fragment.json` dropped. Pushed a5508f6.
- 2026-11-14T10:20Z: S review (docs/review/2026-11-14-ist2-and-o2-margin.md) implemented, KATs first. Pushed 4c54e5e.
  - **IST-2 weight-span check** (`physio.ist2_weight_span`, `tests/test_physio.py`): same grade, 0.12 g vs 0.32 g, 121 + 80.7 kg, per kg subject mass, speed sweep 0.56-0.97 m/s. Model is not retuned.
    | Variant (eta) | 20 % band | 8.7 inside? | 30 % band | 17.0 inside? |
    | --- | --- | --- | --- | --- |
    | optimistic (0.25) | 6.43-11.13 | yes | 9.42-16.31 | **no** (17.0 > 16.31) |
    | **nominal (0.225)** | 7.14-12.37 | **yes** | 10.47-18.13 | **yes** |
    | conservative (0.20) | 8.04-13.92 | yes | 11.77-20.39 | yes |
    Speeds that reproduce IST-2 exactly (nominal): 0.68 m/s at 20 %, 0.91 m/s at 30 %. Only k depends on g, so the band is the vertical-work term alone; IST-2's 30 % value sits near the top of the band (steep grades cost more than vertical work, as S noted).
  - **Level -> grade increment: "not validated"** (`variants.yaml ist2.level_to_grade_validated: false`, `physio.level_to_grade_increment`). Nominal 104 kg at 0.98 m/s: +23.8 / +34.9 mL/kg/min at 20 / 30 %. No measured reference found in the repo or config.
  - **O2 margin** (`margin.py`, `crew.yaml o2_margin`, all sourced): `margin_min = (O2_left - O2_return_route - O2_station_tasks - O2_reserve) / 1.35`, "minutes at maximum effort"; station work 0.84 L/min (1,000 BTU/hr); reserve 30 min x 1.35 = 40.5 L. Timeline rows add `o2_tasks_left_L` and `o2_margin_min_planning_rate` (O2 term at 1,200 BTU/hr = 1.004 L/min).
- 2026-11-14T10:30Z: **real run** `make engine` on WS1's grid (2,468 x 2,468 at 3 m), commit 4c54e5e, 13 min 18 s (return fields 26 s, isochrones/edges/bands 730 s). Scenarios opt_80/104/120, nom_80/104/120; con_* skipped (no `validation/v1.json`). Margins from WS4 `pipeline.conditions.margins`: t_dark 578.63 min (flat horizon, pad), **tau_dose 85.9 min = storm peak** (20 May 2024, D_allow 0.5 mGy). All public files pass `tools/validate_contracts.py` (0 errors). Outputs in `data/interim/engine/` (rasters for WS7/WS9: `{sid}/t_home.tif`, `o2_home.tif`, `pointer.tif`, `pointer_offsets.json`) and `data/interim/engine/public/`.
  - **Headline nom_104: reachable 12.4 % of the assessed 30-min flat disc (r 1,764 m), range [con pending V1, opt 17.5 %].** 60-min: 11.2 %. Other suits (30 min): nom_80 12.9, nom_120 12.1; opt 18.2 / 17.5 / 17.1.
  - Edge causes nom_104 (share of edge length): 30 min slope 99.4 %, physiology 0.6 %, data 0 % (117.5 km of edge); 60 min slope 97.8 %, physiology 2.2 %, data 0 %. No unknown cells and 100 % HiRISE, so no `data` edges.
  - Disc blocked share (nominal, > 20 deg): 41.2 % (30-min disc), 31.4 % (60-min). Reached cells 3.59 M; max finite T_home 296.7 min.
  - **Stations: S1, S2 and S4 all sit on blocked cells** (cell state 1; max slope 57.2, 40.5, 23.6 deg). Not snapped. T_home nominal = null for all three; optimistic (25 deg) reaches only S4: 52.2 / 55.6 / 58.0 min (80 / 104 / 120 kg). S4's 7x7 neighbourhood has a nominal T_home of 59.7 min; S1 and S2 have no passable cell within 3 cells (nominal). S3 and S5 have no position (S picks).
  - **Route nom_104: empty** (no reachable station), so the timeline is depart/return at t = 0 (margin 85.9 min, binding: dose). No route or binding margin to report for nom_104.
  - Partner line (nominal, 60 min, ridge-masked): nom_104 cart 179 kg 1.23 km2, drag 179 kg 0.0002 km2, cart 343 kg 0.93 km2, drag 343 kg infeasible. Trade table: reachable % filled, partner area filled, science_value null (needs con_* T_home).
  - Sizes: public tree 153 MB; isochrones fall back to 2-min steps and are still **2.6-3.4 MB gz** (19-24 MB raw) per scenario, over the 1.5 MB budget; bands 4.2-4.6 MB; edges 2.2-3.1 MB; partner 1.1-1.4 MB; `data/interim/engine/` 351 MB total. Cause: thousands of small blocked holes (nom_104 60-min contour has 6,355 holes).
- 2026-11-14T11:05Z (session 3): **access-cell rule** (user 11:40), KATs first (`pipeline/engine/tests/test_access.py`, 8 pass: wall station -> walkable cell at exactly 30 m; none within radius -> null + reason; assessed-but-sealed pocket -> null + reason; station on walkable cell -> access = science point, dist 0; nearest wins; card fragments match the timeline). `pipeline/engine/access.py`: access cell = nearest cell with WS1 state assessed (0) **and** finite T_home in the scenario, within `variants.yaml route.access_radius_m` 50 (assumed, flagged). Science lon/lat never moved. Walk-in leg **not modelled**; reported straight-line: dist, rise, mean slope, max along-track slope (3 m samples, bilinear on elev_3m), max WS1 max-slope of cells crossed. Per scenario, since the reachable set differs by variant.
- 2026-11-14T11:05Z: **isochrone display filter** (C 11:42): `variants.yaml outputs.display_min_hole_m2` 100 (assumed, note in config); holes are filled before simplification; routing, T_home, bands and edges unchanged. 1-min isochrones with the filter are 2.25-2.92 MB gz (> 1.5), so the **2-min fallback** is used: 1.15-1.49 MB gz (nom_104 1.18). The fallback now reuses the even-minute 1-min features (no second contouring; run 6 min instead of 13). **Edges**: one MultiLineString per (budget, cause), lossless (nom_104 2.31 -> 1.48 MB raw; KAT: same pieces).
- 2026-11-14T11:05Z: **card timeline part** (C 11:42): `data/interim/engine/public/cards/{S}.timeline.json` (`pipeline/engine/cards.py`): `timeline` {arrive, leave, turn_back}, `margin_binding`, `contingency` (cart haul time from the access cell, F10); extras `station`, `scenario`, `on_route`, `margin_min`, `t_home_min`, `o2_home_L`, `science` {lon, lat}, `access` {lon, lat, dist_m, reason, walk_in, radius_m, rule}. The card-owned keys are checked against the card schema's sub-schemas; manifest keys `card.{S}.*` (file `cards/{S}.json`).
- 2026-11-14T11:05Z: **real run** `make engine` (commit 3bad2dd, 6 min 7 s), opt/nom x 80/104/120; con_* skipped (no V1). WS4 margins: t_dark 578.63 min; **tau_dose 85.9 min (storm peak, default)**. All public files validate (0 errors; the card fragments are not web files). Engine manifest fragments were cleared before the run (old keys archived), so no stale keys.
  - Headline unchanged: nom_104 **12.4 %** of the assessed 30-min disc (range [con pending V1, opt 17.5 %]); 60-min 11.2 %. Edge causes nom_104 30 min: slope 99.4 %, physiology 0.6 %, data 0 %.
  - **Access cells (nom_104)**:
    | Station | Science lon, lat | Access lon, lat | access_dist_m | Walk-in rise / mean / max along / max terrain slope | T_home nom_104 | O2_home |
    | --- | --- | --- | --- | --- | --- | --- |
    | S1 | 137.391523, -4.810007 | null | null | - | null: "38 assessed cells within 50 m, none with a walk home in this scenario" (same in all 6 scenarios) | null |
    | S2 | 137.383058, -4.776687 | 137.382736, -4.777025 | 27.6 | +7.79 m / 15.8 / 22.0 / 43.4 deg | 71.01 min | 95.56 L |
    | S4 | 137.408864, -4.785707 | 137.408842, -4.785679 | 2.1 | +0.59 m / 15.9 / 15.9 / 23.7 deg | 59.93 min | 77.72 L |
    Optimistic: S2 access 24.1 m (T_home 55.6 / 60.7 / 64.2 min at 80 / 104 / 120 kg), S4 2.1 m. S3, S5: no position (S).
  - **G1 route `route_nom_104`: pad -> S4 -> S2 -> pad, 209.7 min** (walk 149.7 + 2 x 30 dwell), legs 2,357 / 1,741 / 2,122 m, 48.4 / 30.3 / 71.0 min. Only 2 stations: S1 has no access cell, S3/S5 unpositioned, so no 3-station route yet. Timeline: arrive S4 48.4, leave 78.4, arrive S2 108.7, leave 138.7, return 209.7; O2 left at return 267.7 L. **Binding margin: dose** everywhere (storm tau 85.9 - T_home): 25.97 min at S4, **14.89 min at S2 (lowest)**. With `--dose latest` (tau 3,771.6 min, scratch run, not published) the same route is chosen and **O2 binds**: 224.1 min at S4, 168.3 at S2. Turn-back (latest leave, O2 term): S4 438.6 min, S2 409.2 min, i.e. after the 6.5 h EVA budget (see question 13). Both stations are outside the 60-min partner line (cart haul from the access cell 99 / 108 min).
  - **Sizes** (public tree, 6 scenarios): **79.5 MB raw, 12.1 MB gz** (was 159.5 / 22.0). Isochrones 7.7-9.9 MB raw (1.15-1.49 gz); bands 4.2-4.6 raw (0.58-0.65 gz); edges 1.4-2.0 raw (0.26-0.36 gz); partner 1.1-1.4 raw; rest < 0.05. Largest file 9.95 MB (opt_80 isochrones). With con_* expect about 107 MB raw / 16 MB gz. Git stores blobs zlib-compressed, so repo growth is about the gz column (under 25 MB); the **raw** tree is over 25 MB and cannot get there losslessly (see question 10).

### Doing

- Waiting for V1 (con_*), S (S3/S5 positions, S1 access, questions) and C (card merge, sizes).

### Next

- On V1 (WS6 `validation/v1.json`): `make engine` again for con_* (range low end, trade science_value, siting rule).
- Once S3/S5 have positions (or S1 gets an access cell): re-run for a 3-station nom_104 route. F8 siting + `pad.json` on V1 (the brief has no nom-only interim, so not produced).
- WS7/WS9: real rasters are ready in `data/interim/engine/{sid}/`.

### Blocked

- **3-station G1 route (S/WS1):** with the access-cell rule only S2 and S4 are routable; S1's 38 assessed cells within 50 m are all sealed off (no walk home in any scenario). S to pick S3/S5 positions, or move S1, or widen the radius (assumed 50 m; not changed by WS2).
- con_* scenarios, the headline range low end, trade `science_value` and F8 siting wait on WS6's V1 RMSE (S's footprint decision).
- Questions for S (science):
  1. **alpha encoding (C note, model unchanged).** IST-2's weight span is a gravity change (0.12 -> 0.32 g on 201.7 kg = 395.6 N). At Mars g that weight equals 106.6 kg of carried mass, not `delta_mass_kg` 60.
     | | alpha (mL/kg/min per kg per m/s) | a(M) nom 80 / 104 / 120 kg suit | level VO2 at 0.98 m/s, nom 80 / 104 / 120 | level v* nom 80 / 104 / 120 (m/s) | headline 30 min nom_80 / nom_120 |
     | --- | --- | --- | --- | --- | --- |
     | before (60 kg) | 0.03231 | 12.296 / 13.071 / 13.588 | 18.05 / 18.81 / 19.32 | 0.976 / 0.918 / 0.883 | 12.91 / 12.12 % |
     | after (106.6 kg, anchor speed) | 0.01818 (x 0.563) | 12.720 / 13.156 / 13.447 | 18.47 / 18.89 / 19.18 | 0.943 / 0.912 / 0.892 | 12.78 / 12.15 % |
     With IST-2's own per-subject speeds instead of 0.98 m/s, alpha = 0.0184-0.0318. The 80-120 kg level-cost spread shrinks from 1.27 to 0.71 mL/kg/min; 60-min headline nom_80 12.63 -> 12.29 %, nom_120 10.29 -> 10.40 %. Adopt (set `delta_mass_kg` to a weight-span encoding) or keep?
  2. **O2_station_tasks interpretation (please confirm).** Implemented as the task O2 still to do at the station the crew is working at (0 while walking). The O2 margin on arrival therefore equals the one on leaving. Daylight and dose terms are unchanged (SPEC F4).
  3. **Margin change on the only real route** (opt_104 -> S4, 131.9 min, scratch run, not published). O2 term: start 373.3 -> 343.3 min (-30.0, the 40.5 L reserve); arrive S4 260.5 -> 230.8 (-29.7); return 271.2 -> 230.8 (-40.3). Latest turn-back at S4: 523 min (daylight) -> 447 min (O2). Each 30-min station now costs 11.7 L more (0.84 vs 0.45 L/min) = 8.7 min. On the nom_104 field (no route), the O2 term on the 30- / 60-min contours drops by a median 24.5 / 19.3 min. **The binding margin does not change.** With the storm tau (85.9 min) the dose term (85.9 - T_home) binds everywhere within 60 min; with `--dose latest` (3,771.6 min) the O2 term binds on the S4 route (230.8 min).
  4. O2 conversion mismatch: `o2_budget` uses 20.1 J/mL (4.80 kcal/L), while the review conversion gives 5.02 kcal/L at RER 0.85. With 5.02 kcal/L, primary_L would be 482 L instead of 504 L. Not changed.
  5. Earlier open: haul drag case infeasible (old Q3), casualty mass (Q4), flat-disc speed (Q5). Old Q1 and Q2 are answered by the review.
- Questions for C (code/contracts):
  6. Who writes the web `stations.json`? WS2 writes `data/interim/engine/public/stations.json` with `t_home_min` and `in_partner_line` from WS1's stations.
  7. Proposed for contracts v1.1 (loose schemas accept them now): `partner.geojson` properties `{case, casualty_kg, contour_min, style, default_visible, caption, feasible, area_km2}`; route leg properties `{leg, from, to, t_min, o2_L, length_m, t_start_min, t_end_min, times_min[]}`; timeline rows `margin_binding`, `o2_tasks_left_L`, `o2_margin_min_planning_rate`, optional `in_partner_line`, plus `turn_back` events. `siting_png.json` has no schema.
  8. F11 partner_area_km2 uses the 60-min cart line (suited casualty) in both rows; reachable_pct uses the nominal variant. OK?
  9. WS5 scorecard shows `crew.o2_reserve_frac` as "O2 reserve in the route margin". It is no longer used; the reserve is `crew.o2_margin.reserve_min_at_effort_cap` (30 min at 1.35 L/min = 40.5 L). Please ask WS5 to switch the row.
  10. **Sizes / coordinate precision.** Losslessly I merged edge pieces (MultiLineString). Two more cuts need a C decision: (a) 5 decimals (0.59 m on Mars, below the 2 m simplification) saves 9 % raw / 16 % gz (79.5 -> 72.5 MB raw, 12.0 -> 10.1 gz), but SPEC §6 and contracts/README say 6 decimals, so not applied; (b) the same < 100 m2 hole filter on `bands_*` cuts them 13.1 -> 5.8 MB raw (1.84 -> 0.9 gz), but bands are the main F4 layer and edges would still trace the dropped islands, so not applied.
  11. **Card merge.** WS2 writes `engine/public/cards/{S}.timeline.json`; `tools/make_web.py RULES` has no rule for it yet and no merge into `cards/{S}.json`. Note `SCHEMA_MAP` pattern `cards/*.json` also matches `*.timeline.json` if the fragments ever land in the web tree. The card contract's `margin_binding` enum has no null: S1 (no access cell) has null times and a null binding; please allow null (as the timeline schema does) or say what a card without a route should carry.
  12. **stations.json extras (stations schema is open):** `access_radius_m`, `access_lon`, `access_lat`, `access_dist_m`, `access_reason` (default scenario), `access` {scenario: {lon, lat, dist_m, t_home_min, o2_home_L, reason, walk_in {dist_m, rise_m, mean_slope_deg, max_slope_deg, max_terrain_slope_deg, modelled: false}}}. `lon`/`lat` stay the science point; `t_home_min` is at the access cell. Timeline station rows: `access_dist_m`; route legs: `to_access_dist_m`. Optional in a v1.2 note?
- Question for S: 13. **Turn-back beyond the EVA budget.** The SPEC F4 margin has no EVA-duration term, so the latest turn-back (O2 term) is 409-439 min, after the 6.5 h (390 min) budget. Cap turn_back at `crew.eva_h` - T_home, or keep it as the physical limit?
- **For WS5 (answer to Q9, not editing web/):** `web/src/config.ts` line 94 still cites `crew.yaml o2_reserve_frac` (0.2) for the scorecard. The engine does not use it. The route margin's reserve is `crew.yaml o2_margin.reserve_min_at_effort_cap` = 30 min at the effort rate 1.35 L/min = **40.5 L** (S review). Please show that row instead.

### Assumptions added

- `variants.yaml route.o2_checkpoint_min` 30 and `budget: crew.eva_h` (assumed; SPEC F9 text). `route.o2_margin_rate` and `dwell_vo2` were removed and replaced by `crew.yaml o2_margin` (sourced: S review, ICES-2026-127, NTRS 20140009556).
- **Reserve in use:** the margin uses the fixed `o2_margin.reserve_min_at_effort_cap` (40.5 L) only. `crew.o2_reserve_frac` (r = 0.2) is no longer used anywhere in the engine (`MarginInputs.reserve_frac` = 0; `margin.legacy_inputs` is kept only for the before/after comparison). `crew.reserve_min` (30) stays the EVA-time reserve of SPEC §1.4; the engine does not use it.
- `variants.yaml ist2.weight_span` and `g_earth_ms2` 9.80665 (sourced: Norcross et al. 2010; CGPM). `speed_sweep_n` 42 is numerical resolution only.
- `variants.yaml numerics.grade_table_step_deg` 0.01 (assumed: true; lookup resolution, KAT error < 1e-4).
- `haul.yaml g_moon` 1.62 m/s^2 (assumed; standard lunar g, only for the Mars/Moon KAT).
- The DP bounds O2 used before a departure by the effort-capped rate (station work at 0.84 is below 1.35 L/min, so the bound holds). The DP stays exact; the timeline reports the actual margins.
- Pre-H0 station snapping is not used: a station with no walk home gets null.
- `variants.yaml route.access_radius_m` 50 (assumed: user chose the access-cell rule 2026-11-14 11:40; radius assumed). Walkable = WS1 state assessed and reachable in the scenario. Walk-in leg not modelled.
- `variants.yaml outputs.display_min_hole_m2` 100 (C decision 11:42, display only).
- Card contingency uses the cart case with the suited casualty (the partner-line case), from the access cell.
- Engine CLI: `--dose storm|latest` (default storm, the SPEC storm replay) and `--no-conditions`. CLI `--t-dark-min` and `--tau-dose-min` override WS4.

## WS3 Horizon

Branch: `ws3-horizon`

### Done

- 2026-11-14T09:55Z: M1 horizon ray engine (`pipeline/horizon/rays.py`, Numba, 1,440 rays, sampling 1 m / 20 m / 200 m from `horizon.yaml`, curvature d²/2R, coarser-band fallback, NaN = unknown) and CAHV/CAHVOR/CAHVORE projection + rover→site attitude chain (`pipeline/horizon/cahvor.py`). Ported from the pre-H0 reference code, checked against contracts v1.0.0 and the fresh discovery.md. KATs: curvature drop 58.9 m at 20 km; 100 m wall at 1 km from 1.7 m = 5.61°; flat plane = −dip within 0.01°; projection round trip < 0.5 px; attitude chain round trip.
- 2026-11-14T10:01Z: Navcam cache (`pipeline/horizon/navcam.py`): raw-image API (full NAV_LEFT_B frames, `extended=full::sample_type::eq`), cache `data/raw/navcam/` with `index.json`; stop order = S4 by its stations.yaml rule (drive end nearest sol 4200 → 107_2484, as discovery 3.2) then farthest-point over the 290 focus-area drive ends at 30 m spacing (116 stops). **Real-frame KATs pass** on 3 fresh API frames from 2 drive ends (107_2484, 125_2490): A-vector az/el vs `mast_az/mast_el` and rover yaw/pitch/roll vs MMGIS within 1°; C height inside the discovery 3.4 range. A cached-frames variant checks 3 more stops.
- 2026-11-14T10:01Z: sky detector (`pipeline/horizon/sky.py`) = the `horizon.yaml` rule + 2 px border + σ 2 px pre-smoothing (evidence below).
- 2026-11-14T10:04Z: far-field bands (`pipeline/horizon/bands.py`): MOLA-HRSC 84 km window (GTIFF_DIRECT_IO) and a 3-item CTX `geoid_adjusted_dem` mosaic (34 km disc, 70.8 % footprint), all reprojected to the analysis CRS in `data/interim/horizon/bands/`. One CTX item (P22_009505…P22_009571) is 55 m below MOLA-HRSC and was rejected by the alignment check; the next-best item replaced it. Band offsets (coarse − fine, median): CTX − dem_1m **+15.6 m** (p5/p95 −4.6/+43.1), MOLA − dem_1m +0.5 m, CTX − MOLA +2.9 m.
- 2026-11-14T10:11Z: WS1 `dem_1m.tif` (7,800² at 1 m, coreg dx = dy = 0) is on disk, so I started the real stop horizons: `horizons/v{site}_{drive}.json` at Navcam height for every stop with candidate frames; frame selection now keeps a frame only where the DEM-predicted skyline is testable (below the detector's reference band, inside the frame) in ≥ 50 % of columns. **Result: 49 frames at 36 stops** (`navcam_frames.json`, validates).
- 2026-11-14T10:11Z: first **automatic V2** (`pipeline/validation/v2_skyline.py`, `validation/v2.json` validates, manifest keys `v2.*`): 49 frames tried, 35 ok at 27 stops, 14 failed (no clear sky at the top of the frame; reported, not dropped). Median |error| near 0.095° (n 2,016 columns), mid 0.196° (n 951), **far 4.30° (n 26,861, P90 7.89°)**. 49 check composites in `data/interim/horizon/validation/overlays/`. The far figure is not quotable yet: see Blocked 1.
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

- 2026-11-14T10:00Z: Mars24 clock + sun API (`pipeline/conditions/marstime.py`, `sun.py`). KATs `tests/test_clock.py`: both GISS worked examples (A-1..D-6, incl. sun Z/A), Ls 2026-08-25 = 341.56 (brief 341.6 +/- 0.2), MY 39 / Ls 21.7 at H0, Navcam label LMST <= 10 s on 3 frames (sols 5041, 5069, 5073; error <= 1.5 s), MSL sol numbers, all D0 discovery frames within 10 s.
- 2026-11-14T10:10Z: RAD L2 cached via CDAS REST (`fetch.py`, cache index `data/raw/conditions/index.json`); CDAS parser, storm numbers, tripwire, leash (`rad.py`, `tripwire.py`). KATs `tests/test_rad.py` (synthetic analytic + real):
  - **Real storm (TOTAL_DOSE_E):** baseline 152.3 uGy/day (578 samples, 12-19 May); **peak 8377.9 uGy/day = 8.38 mGy/day** at 2024-05-20T06:19:52Z (sample midpoint); **excess 1.733 mGy** (onset 05:15:52Z, end = window end, rate still 160 > 152 on 22 May); dose equivalent 1.733 mSv at Q = 1; **tripwire 2024-05-20T05:57:07Z** (before the peak); **tau_dose at peak 85.9 min** (0.349 mGy/h, D_allow 0.5 mGy).
  - Latest RAD: 190.9 uGy/day at 2026-11-11T16:45:49Z, lag 2.7 days.
- 2026-11-14T10:15Z: `clock.json` (H0 record, weekend sols 5073-5075 with sunrise/sunset, Horizons light time 11.014 -> 10.873 min, simulated EVA block with sun series and t_dark), `donki.json` (CME 58, ENLIL 57, notifications 60, SEP 6, IPS 6; "context only, not a trigger"), `rems.json`, `make conditions` (+ `make conditions-fetch`). All outputs validate against contracts v1.0.0; every displayed number goes to the manifest (`data/interim/manifest/pipeline__conditions__*.json`).

- 2026-11-14T10:25Z: REMS climatology (`rems.py`): PDS `mslrem_1001` MODRDR, MY 36-38, Ls 10-35 (sols 3045-3098, 3714-3767, 4382-4435), 200 rows/sol by byte range; 162 sols fetched, 159 used. Medians (p10-p90) of daily extremes: air min -74.5 degC (-77.3 to -72.5), air max -19.5 degC (-27.4 to -13.9); pressure 792-862 Pa (daily min/max medians); UV A+B+C max 9.49 W/m2. Feed latest sol 4995 (2026-08-25) shown with label "stale since 25 Aug 2026".
- Downloads: WS4 cache 17.0 MB in 171 files (RAD 0.44 MB, REMS feed 1.7 MB, REMS PDS ~14.4 MB, DONKI 0.5 MB, Horizons 0.01 MB).

### Doing

- —

### Next

- Sun API hand-off to WS7/WS8 (documented below); per-station daylight once WS3 horizons land in `data/interim/horizon/horizons/` (`make conditions` picks them up; `eva.t_dark_min_by_observer`).
- G's answers to the questions below.

### For WS2 (margins; SPEC F4)

- One command: `uv run --no-sync python -m pipeline.conditions.margins --flags` prints `--t-dark-min 578.63 --tau-dose-min 85.9` (now). Options: `--observer S1` (daylight against that station's F12 horizon, once WS3 files exist), `--dose latest` (quiet-sun tau at the latest RAD rate, ~3772 min) instead of the storm-peak default. JSON without `--flags`; Python: `pipeline.conditions.margins.margin_inputs(observer, dose)`.
- Files: `data/interim/conditions/clock.json` `eva.t_dark_min` (minutes from the simulated EVA start, 09:00 LMST on sol 5074 = 2026-11-14T10:51:18Z, to sunset on a flat horizon at the pad) and `eva.t_dark_min_by_observer[id]`; `data/interim/conditions/rad.json` `leash.tau_min_at_peak` / `leash.tau_min_at_latest`, plus `leash.table` (one row per 0.05 mGy slider step).
- Sun API: `from pipeline.conditions import sun`; `sun.sun_position(utc, lat, lon_e)`, `sun.sun_at_lmst(ref_utc, lmst_h, lat, lon_e)`, `sun.t_dark_min(eva_start, lat, lon_e, horizon_deg=0.0 | profile=<F12 horizon dict>)`, `sun.eva_start_utc()`.

### Blocked

- Questions for G (RAD/REMS sign-off):
  1. **RAD column: `TOTAL_DOSE_E` is used, pending G's confirmation.** It is the only column that reproduces the expected storm numbers (B: 7.35 mGy/day, 1.57 mGy). Not marked confirmed.
  2. RAD time tag = observation start is D0's inference (START_TIME = first EPOCH), not stated in the metadata. A centre tag would shift every time by ~8 min (tripwire, onset, peak), not the peak/excess values.
  3. Excess integral ends at the storm-window end (the rate is still 160 vs 152 uGy/day on 22 May 23:50). Accept, or extend the window?
  4. REMS ground temperature: the sampled PDS daily **minimum** is a median 17.2 degC colder than the outreach feed's `min_gts_temp` on the same sols (air min agrees within 0.2 degC; maxima 2.6-2.9 degC lower, as expected from row sampling). Confidence-level columns are not applied. Should ground temperature be dropped from the panel, or filtered by `GTS_CONFIDENCE_LEVEL` (which code values are good)? Until answered, treat the ground minimum as unverified.

### Assumptions added

- **`config/conditions.yaml clock.gale_lon_east_deg` 137.39 -> 137.4085** (docs/discovery.md §4.5: MSL label LMST matches Mars24 at 137.4085 E, median |error| 0.23 s; 137.39 gave a systematic +4.4 s). G to review. `site.yaml analysis_proj lon_0=137.39` is untouched (projection origin, not the clock).
- `rad.dose_variable` DOSIMETRY_TOTAL_f, `rad.dose_component` TOTAL_DOSE_E (pending G), `rad.time_tag` start (inferred), `rad.sample_duration`, `rad.tripwire.fires_at` ("end of the last qualifying sample"), `rad.event_bounds`; `leash.d_allow_range_mgy` [0.25, 1.0] (D9), `leash.d_allow_step_mgy` 0.05 (assumed).
- `clock.eva_start_lmst_h` 9.0 and `clock.eva_sol_ref_utc` = H0 (assumed: nothing in SPEC fixes the simulated EVA start; C/S to confirm), `clock.sun_horizon_elevation_deg` 0, `clock.sun_series_step_min` 5, `clock.mars_year_epoch_utc` 1955-04-11, `clock.msl_landing_utc` 2012-08-06T05:17:57Z; sun latitude = `site.yaml pad_default`.
- REMS: `pds_mars_years` [36, 37, 38], `pds_rows_per_sol` 200, `pds_min_lmst_coverage_h` 18; DONKI `window_utc` 12-23 May 2024 (+IPS endpoint); Horizons `step` 1 h.
- KAT notes: GISS example 2 prints LTST 0.00025 h and declination -13.42065, but its own formulas on its own inputs give 0.00020 h and -13.42040; tested with 1e-4 h / 5e-4 deg tolerance (example 1 matches to 2e-5). Ls KAT evaluated at 12:00 UTC on 2026-08-25 (the brief gives a date only).

## WS5 Web

Branch: `ws5-web`

### Done

- 2026-11-14T10:03Z: M1 web shell on contracts v1.0.0, developed on `VITE_DATA=dummy` (F5, F6, F15, F17). vitest wired (`npm test`): 179 tests in 16 files, all green; `tsc --noEmit` clean; `vite build` 1.8 MB without data (brief: < 5 MB).
  - Data layer: one loader validates every JSON file against its contract schema (browser checker mirrors `tools/validate_contracts.py` SCHEMA_MAP row by row; test fails if they drift or contracts use an unsupported keyword), refuses paths no contract covers, refuses `dummy: true` in real mode. Every dummy JSON file validates in the browser checker.
  - Provenance: every on-screen number goes through `<Num>` → manifest entry by named key, else by same file + same value; unbacked numbers are outlined and counted in a dev-mode badge. All views on dummy data: 0 unbacked numbers. Scorecard lists the manifest and flags entries before `h0_utc`.
  - Routes `/`, `/station/:id`, `/trade`, `/conditions`, `/scorecard`, `/cuff`, `/about`; mount slots `/hud` (web/src/hud/index.ts), `/hud3d` (web/src/fp3d/index.ts), `/nav` (web/src/nav/index.ts): export `mount(el, ctx)`; placeholder until the module exists.
  - Console: map (MapLibre, Mars lon/lat, offline style), Mars scale bar (R from site.yaml; KATs), layer toggles, legend, 30/60-min bands (conservative inner / optimistic outer, selected variant bold), edge-cause lines + labels, hatched unknowns (alpha of the shared slope field), stations + pad (pad.json, else site.yaml default), route and partner line behind toggles (partner off by default). Headline reachable % with range.
  - F5 budget slider: stops = `minutes` present in isochrones.geojson (1-min, D2), MapLibre filter on `minutes`. F6 scenario picker: variant × suit mass from scenarios/index.json; missing combos disabled.
  - Station card, trade table, conditions (RAD now + lag, storm chart with onset/tripwire, leash), cuff card (route card + A6 per station, print CSS), scorecard (V1, V2, coverage, coreg, RAD checks vs config ranges, assumptions from config, real/modelled/simulated, manifest), about page.
  - Real mode (empty `web/public/data/`): every view shows "not available yet", no errors.
  - `.github/workflows/pages.yml` written (see Blocked): deploys only after `ci` succeeds on a push to main, real data only, refuses dummy, checks no dummy flag in dist and < 5 MB without data.

### Doing

- —

### Next

- G1: real band layer, route and RAD chart as soon as WS2/WS4 write `web/public/data/` via `make web`.
- Station card polish once WS3 overlays land; HUD-on-card strip if WS7 is not green at G2.
- About page: licences and SI statement text (needs the team).

### Blocked

- (user) GitHub Pages: repo `LuxKaiwalker/home-line` is private and `gh` is not logged in; Pages needs a paid plan or a public repo by submission. Workflow is ready but cannot deploy yet.
- (C / WS6) `.github/workflows/` is owned by WS6 + C: please review `pages.yml`, and add `npm test` (vitest) to the `web` job in `ci.yml` (WS5 did not edit ci.yml).
- (C / WS1) Basemap: contracts v1.0 leave the tile layout, zoom range and bounds of `tiles/basemap/` to WS1, and no schema covers a tilejson. The console shows a placeholder background until C adds the layout (or a tilejson schema) to the contract.
- (C / WS4) D9 dose slider: `config/conditions.yaml` has the 0.25–1.0 range only as a comment. WS5 reads `leash.d_allow_slider_mgy: {min, max, step}` when it exists; until then the slider is hidden (no invented range).
- (C / WS6) KAT pass list on the scorecard: no web contract in v1.0 (WS6 has `kats.schema.proposed.json`). Scorecard says so.

### Assumptions added

- Contract gaps (for C): no web artefact for cell states / source mask, so hatched unknowns use the alpha of the shared `slope` field (A = 0 = no terrain value); this does not mark non-HiRISE (CTX) cells as unknown. Loose schemas (coverage, rems, clock, v2 summary, v1 confusion, donki records) are shown as generic key/value tables until producers fix their structure.
- Manifest keys are not fixed by contracts v1.0; `<Num>` resolves a named key first, then an entry with the same file and value.
- Presentation-only constants (colours, line widths, legend bin step 10 min, label spacing) live in `web/src/theme.ts`, not config/ (WS5 owns no config file).
- D9 leash off the default allowance: τ is recomputed in the browser with `leash.formula` from config and the manifest-backed rate, labelled "computed in the browser"; at the default allowance the page shows rad.json's own value. KAT: recomputes 85.7 min at 0.5 mGy.

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

- **X8 data probe (brief step 1), 10:13 UTC.** `pipeline/navigation/vo_probe.py` (ported from the pre-H0 reference code, re-run fresh), KATs in `tests/test_vo.py` (26 pass). Output `data/interim/vo/probe.json`, valid against `vo_probe.schema.json`; manifest keys `nav.vo_probe.*`. 8.3 MB downloaded to `data/raw/vo/` (raw-API metadata, MMGIS waypoints, 10 pairs of 256² frames per drive for a decode/feature check).
- The 5 most recent MMGIS drives, all site 125. "During" = `prev_end < drive < end` at the same site. Spacing = 3-D distance between consecutive pose `xyz` (site frame).

  | Sol | Drive (prev → end) | MMGIS m | 256² L/R pairs | Spacing median (max) | Longest run ≤ 2 m | CAHVOR + attitude | Full-res pairs | Mast az/el |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | 5073 | 125_2274 → 125_2490 | 27.9 | 35 | 0.946 m (1.13) | 35 | all | 2 (1 pose) | 90° / −29° |
  | 5070 | 125_2082 → 125_2274 | 28.7 | 31 | 0.945 m (1.02) | 31 | all | 2 (1 pose) | 0° / −29° |
  | 5069 | 125_1326 → 125_2082 | 101.3 | 124 | 0.953 m (1.20) | 124 | all | 2 (1 pose) | 90° / −29° |
  | 5045 | 125_1194 → 125_1326 | 12.6 | 21 | 0.933 m (1.19) | 21 | all | 4 (2 poses) | 90° / −29° |
  | 5041 | 125_558 → 125_1194 | 83.9 | 106 (103 poses) | 0.985 m (1.29) | 103 | all | 2 (1 pose) | 90° / −29° |

  Contract `stereo_pairs` counts all non-thumbnail pairs (256² + full res: 37, 33, 126, 25, 108). Frames decode at 256 × 256; ORB (defaults) finds ~440 keypoints per left frame, median L/R fundamental inliers 151–234, frame-to-frame 34–112 (min 19): indicative only, not a VO result.
- **Go rule (`nav.yaml vo_probe.go_rule`), mechanical result: go**, met on 5/5 drives at 256² and 0/5 at full resolution. **D16 is N's decision**; WS10 stops here until N records it.

### Doing

- — (stopped after the probe, waiting for D16)

### Next

- On go: brief step 2 (stereo VO at 256², drift per drive → `vo/drift.json`, calibrated set for WS9). On no-go: stop.

### Blocked

- D16 (go/no-go) — N.

### Assumptions added

- Probe conventions (code, not config): a stereo pair = L and R with the same spacecraft clock, `subframe_rect` and `scale_factor`; API `sample_type: thumbnail` (64²) never counts; pairs at one (site, drive) are one pose; runs are counted within one resolution class; a step across a site change is unknown.
- Each drive's previous end is on an earlier sol, so only the end sol was queried; frames from intermediate sols would be missed (can only undercount).
- Caveat for step 2: 256² only (f ≈ 306 px); the mast looks right and down (az 90°, el −29°) on 4 drives and forward on sol 5070, so VO sees near-field ground.

## Decision log (fresh run, recorded by C)

| Time (CET) | Item | Decision | By |
| --- | --- | --- | --- |
| 2026-11-14 11:00 | WS2 Q1–2 (IST-2 check, O₂ margin units) | Per docs/review/2026-11-14-ist2-and-o2-margin.md | S (via user) |
| 2026-11-14 11:15 | Canonical far-field bands | WS1's `terrain/ctx_20m.tif` + `mola_hrsc_200m.tif` (CTX levelled to MOLA); WS3 switches its path | C |
| 2026-11-14 11:24 | D3 Source mask origin | A: STAC footprint quads (SPEC §11) | User |
| 2026-11-14 11:24 | D16 X8 visual odometry | Go at 256² only; stop rule per SPEC §2.4 | User (for N) |
| 2026-11-14 11:24 | `pad_default` | Keep unchanged (drive-end centroids 74–265 m away, reported by WS1) | User |
| 2026-11-14 11:40 | Stations on blocked cells (S1 57°, S2 40°, S4 24° max slope) | **Access-cell rule**: keep each station's science coordinate; route to the nearest walkable cell within `access_radius_m` (50 m, assumed) and show both points plus the walk-in distance on the card; no snapping | User |
| 2026-11-14 11:42 | Isochrone display size (nom_104 2.7 MB gz vs 1.5 MB budget) | Display filter: drop holes < 100 m² (measured 1.19 MB gz); keep 1-min steps if within budget, else the 2-min fallback | C |
| 2026-11-14 11:42 | Station card producer | WS3 writes `horizon/public/cards/{S}.json` fragments (navcam, skyline error, panorama, landmarks); WS2 writes the timeline/margin part; `make web` (C) merges into `cards/{S}.json` | C |
| 2026-11-14 11:42 | Basemap | WebP q80, z13–18, 33.1 MB (`config/web.yaml`) | C |
