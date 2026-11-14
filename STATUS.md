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

- 2026-11-14T11:20Z: **Station cards merged by `make web`** (C decision 11:42; KATs
  `tests/test_make_web.py`, 39 pass): `cards/{S}.json` = WS3 `horizon/public/cards/{S}.json` +
  WS2 `engine/public/cards/{S}.timeline.json`, key by key, nothing computed; `parts` records both
  sources. A station lacking a part gets no card and no images (missing under the absent owner);
  parts that disagree (station, a key set twice, science point, WS3 observer not at WS2's access
  cell) stop the run. The `*.timeline.json` parts never reach the web tree (`SCHEMA_MAP` unchanged).
  **Result: S1, S2, S4 built.** S1: no access cell, null times, `margin_binding` null; S2: dose
  14.89 min, access 27.6 m; S4: dose 25.97 min, access 2.1 m. Far skyline errors 4.24 / 3.18 /
  6.50 deg (near/mid null; D7 pending).
- 2026-11-14T11:20Z: `make web` manifest: an entry citing a web file that the run does not write
  (skipped owner, missing output, card not built) is left out; a skipped owner's entries citing
  its `data/interim/` source too (WS8's `data/interim/export/fp3d/index.json` keys leaked before).
- 2026-11-14T11:20Z: **contracts v1.1.1** (additive; contracts/README.md "Changes"):
  - `card`: `margin_binding` may be null; optional access block (`science`, `access` {lon, lat,
    dist_m = access_dist_m, t_home_min, o2_home_L, reason, walk_in (not modelled), radius_m,
    rule}), `scenario`, `on_route`, `margin_min`, `t_home_min`, `o2_home_L`, WS3 extras.
  - `stations` (WS2 Q12): `access_radius_m`, `access_lon/lat`, `access_dist_m`, `access_reason`,
    `access` {scenario: record}; `timeline` rows `access_dist_m`; `route` legs `to_access_dist_m`.
  - `horizon_ring`: WS3's layout (object; observer, az_step_deg, max_range_m, az_deg, elev_deg
    required; dist_m, z_m, east_m, north_m, source, min_range_m optional). Dummy ring validates
    unchanged (no `make dummy` needed).
  - `fields_index`: WS7's pointer proposal, per-entry `bounds`/`width`/`height`/`res_m` +
    `stencil` (pointer on WS2's 3 m grid; README notes the own grid).
  - Real WS2 stations/timeline/route and WS3 ring validate. Version assertions in
    `tests/test_contracts.py` and `web/src/data/contracts.test.ts` accept 1.1.1.
- 2026-11-14T11:20Z: **Real web data committed (WS8, WS9 skipped):** `make web --skip-owner WS8
  --skip-owner WS9`: 2,831 files, **146.7 MB** (scenarios 79.5, tiles 33.1, fields 28.4,
  validation 2.4, cards 2.2, terrain 0.6, rest < 0.3). All validate, no dummy flag, H0 check OK,
  no dangling reference, largest file 9.95 MB (`scenarios/opt_80/isochrones.geojson`), manifest
  674 keys. Present: WS1 all, WS2 (scenarios, stations, route/timeline nom_104, trade table,
  card parts), WS3 (v2, ring, cards + images), WS4 all 4, WS7 fields (20 PNGs + index), WS10
  probe + drift. Missing: WS2 `pad.json`, `siting.png`, `siting_png.json` (F8 waits on V1); WS6
  `validation/{v1.json,v1.svg,kats.json}`. Skipped: WS8 (running, unmerged); WS9 (its real run
  of 12:16 CET is on unmerged code, `7908eda-dirty`; outputs validate, publish after merge).

### Doing

- —

### Next

- Re-run `make web` when WS8 and WS9 merge, and after V1 (con_* scenarios, WS2 F8 pad/siting,
  WS6 v1/kats).
- WS7: run `make fields --with-pointer` for nom_104 now that v1.1.1 has the pointer entry.

### Blocked

- —

### Answers to questions for C

- WS2 Q10 (sizes): no further cuts (Decision log 12:20). Every engine file is < 50 MB (largest
  9.95 MB); the tree is 79.5 MB raw / 12.1 MB gz.
- WS2 Q11 (card merge): done in `make web` (above); card `margin_binding` may be null (v1.1.1).
- WS2 Q12 (stations/timeline/route extras): documented optional in v1.1.1.
- WS3 Blocked 2 (fragment vs card contract): solved by the merge. WS3 ring layout adopted (v1.1.1).
- **WS7 sun / time-to-dark (no `sun.json`):** WS4's `conditions/clock.json` already has them:
  `eva.sun_series` (columns `eva.sun_series_columns` = `t_eva_min`, `lmst_h`, `sun_azimuth_deg`,
  `sun_elevation_deg`; 79 rows at 5 min over the 390-min simulated EVA), `eva.t_dark_min` (578.63,
  flat horizon at the pad, definition in `eva.t_dark_definition`), `eva.t_dark_min_by_observer`
  (per WS3 stop horizon), `eva.start_utc`/`start_lmst`. WS7: read them from `clock.json`.
- WS7 fields scope: ship all scenarios of the contract table (Decision log 12:20).
- **For WS5 (C does not edit web/ outside contracts.ts):** `web/src/data/types.ts` `Card.margin_binding`
  should be `'O2' | 'daylight' | 'dose' | null`; station card and cuff should show null as
  "none (not on the route / no access cell)" and can show `access.dist_m` + the walk-in.
- WS2 Q6: WS2 writes the web `stations.json` (`data/interim/engine/public/stations.json`);
  make web copies it. Station cards: settled 11:42 (WS3 + WS2 parts, merged by make web).
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

- 2026-11-14T10:50Z: **Canonical bands (C decision 11:15).** `horizon.yaml bands.{ctx_20m,mola_hrsc_200m}.path` now point at WS1's `data/interim/terrain/` bands; `python -m pipeline.horizon.bands` only reports their offsets (`--build` keeps my reference build, unused). Offsets on the canonical bands: CTX − dem_1m **+19.75 m** (p5/p95 −0.41/+47.2; mine was +15.6), CTX − MOLA −0.37 m (levelled). Stop horizons and frame selection rerun offline: the same 49 frames at 36 stops, 35 ok at 27 stops. **V2 median |error| before → after: near 0.095° → 0.095° (n 2,016), mid 0.196° → 0.196° (n 951), far 4.304° → 4.308° (P90 7.890° → 7.894°, n 26,861).** Near and mid use only dem_1m, so they cannot move; the far change is negligible. Pre-switch outputs are kept in `data/interim/horizon/runs/before_bandswitch/`.
- 2026-11-14T11:00Z: **Pad, stations, ring, cards** (`pipeline/horizon/cards.py`, in `make horizons` after V2):
  - Pad horizon `horizons/pad.json`, from WS1 `terrain/grid.json` pad (= `pad_default`, kept). The order is WS2 `pad.json` (none yet), then WS1 grid.json, then site.yaml.
  - Station horizons `horizons/{S}.json` at eye height 1.7 m under the **access-cell rule**, read from WS2's `engine/public/stations.json` (`access_lon/lat`, written 12:01 CET): **S2 and S4 final at their access cells** (27.6 m and 2.1 m from the science point). **S1 has no access cell** (WS2: "38 assessed cells within 50 m, none with a walk home"), so its horizon is at the science coordinate, labelled `science_coordinate_no_access` (not provisional). The cards follow WS2 automatically on rerun.
  - `public/fp3d/horizon_ring.json` for WS8: pad horizon counting terrain beyond `planning_radius_m` (3.7 km) only, 1,440 azimuths, with `elev_deg`, `dist_m`, `z_m`, `east_m`/`north_m`, `source`. A superset of the dummy ring's keys. I propose this structure for the (free) ring contract to C/WS8.
  - Landmarks: the 8 IAU features within 80 km, read from D0's gazetteer CSV (a KAT reproduces the discovery 3.5 table to 0.05 km / 0.05°). The landmarks.yaml rule applies (above the skyline, or ≤ 5 km). **From every station only Gediz Vallis (≤ 5 km) qualifies; the other 7 centres are below the computed skyline** (e.g. Aeolis Mons centre +6.1° vs skyline 9.7–13.6°: lower Mount Sharp's own flanks hide it). So S1 and S4 show 1 landmark and S2 shows 0, each with a `landmarks_note`. I did not pad the list.
  - Panoramas `public/cards/{S}/panorama.png`: 1,440 px wide, true scale, north at the left edge, landmark ticks.
  - Navcam per station: the nearest V2 frame with status ok and manual_ok not false, with no choice by error. The frame is copied as `navcam.png`, and `overlay.png` is the transparent skyline from that frame's stop horizon. **S1: NLB_826633404 (sol 4834, 523 m), S2: NLB_789347468 (sol 4414, 925 m), S4: NLB_767161116 (sol 4164, 128 m).** All three are north-facing far-fail frames, so the cards show far errors of 4.24° / 3.18° / 6.50°, with near/mid null (no near/mid columns). The fragment says the far class is pending D7. The frames change automatically if the manual check rejects them.
  - **Card fragments** `public/cards/{S}.json`: navcam, skyline_error_deg (median |error| per class on the card's frame), panorama_png, landmarks, plus observer, provisional, skyline_error_scope and landmarks_note. They validate against the card contract's fields. Manifest (`pipeline__horizon__cards.json`): `navcam_sol.{S}`, `skyline_error_deg.{S}.{class}`, `landmark.{S}.{name}.{bearing_deg,dist_km}`, file `cards/{S}.json`. The V2 fragment no longer writes `skyline_error_deg.*`.
  - **C request (WS9 F22): `navcam_frames.json` now tags each card frame**: `station` S1/S2/S4, plus `stations[]`, `station_dist_m`, `station_observer` (`station_source: card_frame`). The tags are rewritten on every cards run.
- 2026-11-14T11:05Z: **D7 manual-check sheet** in `data/interim/horizon/validation/manual_check/`: `manual_check.csv` (one row per frame with predicted vs detected per class and an empty `verdict`/`note`), a captioned composite per frame (`{image_id}.jpg`), `contact_01-04.jpg` and `HOW_TO.txt`.
  - **39 frames: 10 sampled (20 %), 21 far-fail (|far median| > 2°), 14 V2-failed** (sets overlap). Verdicts: ok / rim_not_visible / detector_wrong / model_wrong / unsure.
  - Run `python -m pipeline.validation.v2_skyline --import-manual <csv>` to write `manual_checks.json`. The next V2 run then leaves the rejected frames out of the summary.
  - Visibility-range diagnostic: the cut range (2/5/10/20/30 km) whose predicted skyline best matches the detector, drawn in green. **On 19 of the 21 far-fail frames the best match is terrain ≤ 2 km, and 12 of those match within ±0.3°.** The chain is right in the near field, and terrain beyond about 2 km (incl. the rim at 41–57 km) is not seen. Clear-sol frames facing the same way match the rim (e.g. NLB_803472163, az 5°, far error −0.08°). This is evidence for option (a); D7 is not decided.
- KATs: 14 new (canonical bands, access-cell rule incl. no-access, pad source order, landmark table vs discovery 3.5, landmark visibility, pick rule, panorama geometry, ring geometry, frame choice, fragment contract, station tags, manual-check rows/verdicts, cut-range engine). The full suite has 523 pass; ruff is clean.

### Doing

- —

### Next

- C/user: fill the manual-check sheet (D7). Then run `--import-manual` and `make horizons`. The V2 summary and the card frames update from it.
- Rerun `make horizons` (or `python -m pipeline.horizon.cards`) when WS2 changes stations.json/pad.json. S3/S5 cards follow once S picks them.
- Hand to WS9: engine API (`bands.load_engine()`, `HorizonEngine.horizons(xs, ys, az_step_deg=1, min_dist_m=500)`), `sky.detect_skyline`, and `navcam_frames.json` with station tags.

### Blocked

1. **D7 / V2 far class (C/user decides).** Evidence is now on the sheet (above). Options are unchanged: (a) manual verdicts drop the frames where the rim is not visible; (b) fully manual; (c) report as is. Until then the automatic far median stays 4.31°, and the card far errors (3.2–6.5°) come from the same far-fail frames.
2. **Card fragment vs card contract (C).** `make web` copies `horizon/public/cards/{S}.json` straight to `cards/{S}.json`. Until C's merge with WS2's `engine/public/cards/{S}.timeline.json` exists, these files lack `timeline`, `margin_binding` and `contingency`, so they fail `card.schema.json` in make web's validation.
3. **Band step at 2 km (WS1/C, reported only).** The canonical CTX is +19.75 m above dem_1m where they overlap (median; p95 +47 m). At 2–5 km that can lift predicted skylines by ~0.3–0.6°. It does not explain the 3–7° far failures (see the sheet), but it is a datum question for WS1: dem_1m vs CTX levelled to MOLA.
4. **Navcam height (C).** Unchanged: 1.9 m above DEM ground at stops (C height 1.88–1.93 m above the rover origin; the origin's height above ground is unknown).
5. **Landmarks rule yields < 3 (C/S, content).** Only Gediz Vallis qualifies. Options: keep it as is (honest), or show the hidden landmarks' bearings as "behind the skyline" on the panorama (needs a rule change in landmarks.yaml).

### Assumptions added

All in `config/horizon.yaml`, each with `assumed: true`:
- `band_fallback: coarser`: a sample with no data in its band falls back to the next coarser band.
- `navcam_selection`: NAV_LEFT_B full frames only; 30 m stop spacing; up to 4 frames per stop (widest azimuth spread); `stops_wanted` 36 (30 + 20 %); `max_stops_tried` 120 (all 116 stops); drive-end sol + 1; cache budget 150 MB. Geometric pre-test: top-centre pixel ≥ 0° and bottom-centre ≤ −5° in the site frame. It was 10° first, but that kept only 15 of 116 stops and most of those frames had no sky. Then `min_predicted_skyline_col_frac` 0.5 (DEM-predicted skyline testable in ≥ 50 % of columns).
- `sky_detector_params` (structured copy of the prose rule, 3× / top 10 %): `zero_median_guard` one DN; `border_px` 2 and `presmooth_sigma_px` 2.0. Evidence from fresh frames: row 0 is 235–254 DN, row 1 is ~20 DN above row 2, column 0 is ~25 DN darker and the last row is bright (12 frames). On 6 frames with visible sky, the rule as written (σ 0) fires on sky noise in 94–98 % of columns at about row 30. σ 2 traces the skyline on 4 of 6; on the other 2 the true skyline lies inside the reference band. Known failure: σ 2 can prefer a sharp near ridge over a faint hazy far rim (seen on 2 frames); σ 1 follows the rim but adds noise speckles.
- `v2_frame_fail.max_in_ref_band_frac` 0.5: a frame whose boundary sits in the reference band in > 50 % of columns is failed and reported.
- `bands`: CTX listing = D0's 500 STAC items at the pad; greedy footprint gain, max 3 items, ≥ 1 % gain; reject an item whose median offset to MOLA-HRSC is > 20 m; radii 34 km (CTX) and 84 km (MOLA-HRSC); 20 m and 200 m grids.
- `overlay`, `panorama`: colours and sizes (presentation only).
- Landmarks: the 8 IAU names verified by D0 (discovery 3.5). The informal names are dropped (no verified coordinate). Not used yet.
- Session 2 (`config/horizon.yaml`, `assumed: true`):
  - `landmark_rule` (structured copy of landmarks.yaml: 3–6, ≤ 5 km, nearest first; + `above_skyline_tol_deg` 0.05 for ray sampling; label point = gazetteer centre). `landmarks_source` cites discovery 3.5.
  - `horizon_ring` (pad, beyond `planning_radius_m`).
  - `card_frame` (nearest ok frame, manual_ok not false).
  - `manual_check_sheet` (far-fail > 2°, failed frames included, verdict list, cut ranges 2/5/10/20/30 km).
  - `panorama` `min_el_span_deg` 10, `label_band_px`, `font_px`.
- The card skyline error is the card frame's own median |error| per class (not the all-stops V2 median).
- Navcam frame published as PNG (`cards/{S}/navcam.png`, 0.6–0.8 MB each), because the make web rule copies only `cards/*/*.png`.

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

- 2026-11-14T11:00Z: **Field PNG codec** `pipeline/export/fields_png.py` + TS decoder
  `web/src/hud/fields.ts` (contracts v1.1.0: counts = R·256 + G, A = 0 unknown, refuses values
  outside 0..65535 counts). Round trip exact for every count and every `hud.yaml field_scales`
  scale; the committed M0 dummy PNGs decode to the same values in Python and TS (mirrored KAT).
- 2026-11-14T11:00Z: **HUD on dummy data** (`/hud` slot, `web/src/hud/index.ts` `mount(el, ctx)`):
  two-level helmet panel (D14 minimal default), alarm rules 1–5 in order, playback clock
  1/30/60/300× (default 60×, D13), scrubber, route-following marker with dwell ring, band
  colouring by margin while playing, minimap, drag-anywhere ("From here: home in N min
  (conservative M), O₂ needed X L", σ slider 0–100 m), storm switch, fallback drift (2 %, D12)
  with fix resets, worst-case lookup (smallest radius ≥ σ), uncertainty circle and alarm 3.
  "Simulated EVA · real terrain and data" label always shown. Reusable for WS8:
  `loadHudData`, `computeReadout`, `createHudPanel`, `PlaybackClock` (exported from index.ts).
- 2026-11-14T11:05Z: **Real fields grid (C request) = WS1 `grid.json fields_5m`**: 1,480 × 1,480
  px at 5 m, north-up in the analysis CRS, pixel edges at pad ± 3,700 m (the pad is a pixel
  corner, NW corner xy (−4172.5345, −281174.1963)), bounds [137.319359, −4.868421, 137.444641,
  −4.743579]; values are for pixel centres. **WS9's `field_grid()` is identical** (KAT
  `test_ws1_and_ws9_field_grids_agree`), so WS9 changes nothing. `make fields` merges
  `data/interim/navigation/fields_index_nav.json` (`fix_interval_{set}` entries) into
  `fields/index.json` when its grid is exactly this one, and refuses (reports, adds nothing)
  otherwise. The dummy grid (1,481 px centred on the pad) stays as it is.
- 2026-11-14T11:08Z: **`make fields` on WS2's real rasters** (WS2 files of 10:55Z; opt/nom ×
  80/104/120; con_* wait on V1): 20 PNGs, **28.4 MB** in `data/interim/export/fields/` (largest
  `shared/slope.png` 4.1 MB; t_home 0.9 MB, o2_home 1.8–2.1 MB each). `fields/index.json` validates;
  manifest fragment `pipeline__export__fields_png.json` (60 keys: `fields.<key>.sha256`, `.max`,
  `.known_pct`; commit edbcd3c). nom_104: T_home max 296.7 min, known 58.95 % of the grid.
  Worst-case fields (nom_104, 10/50/100 m) computed on the native 3 m grid (radius 4/17/34 cells).
- 2026-11-14T11:10Z: **Real route KAT** (`web/src/hud/real.test.ts`, skipped without data/): on
  WS2's new `route_nom_104` (pad → S4 → S2 → pad, 209.7 min) the HUD's T_home = 0 at the pad and
  matches every timeline row (depart, arrive, leave, O₂ checkpoints, return) within ±0.5 min (max
  0.27 min); margins likewise; the tightest HUD margin along the walk equals the tightest row
  (14.9 min at S2, dose-bound), so alarms 1/4 do not fire on this plan.
- KATs: `tests/test_fields_png.py` 48 pass; `web/src/hud/*.test.ts` 65 pass (5 on real data).
- 2026-11-14T11:20Z: browser check of `/hud` on data-dummy: playback 300×, band shading,
  dwell ring, expanded panel + minimap, drag-anywhere readout; layout fixed to fit the outlet.

- 2026-11-14T11:35Z: **WS9 F21 in the HUD** (`web/src/hud/navhud.ts`, WS9's `navReading` /
  `navLine` / ellipse geometry): when `nav/montecarlo_{default_set}.json` exists the "Odometry"
  toggle replaces the 2 % fallback: σ = ellipse semi-major axis (worst case by the smallest radius
  ≥ it), the 95 % ellipse replaces the circle on map and minimap, alarm 3 fires when the ellipse
  reaches the homeline ("POSITION UNCERTAIN: TAKE A FIX OR HEAD TOWARD ROVER"), the position line
  reads "Odometry ±N m · next fix due in M m · last fix: type, K min ago" (D_max from
  `fields/fix_interval_{set}.png`), and "Take fix" jumps to the next fix event. KATs
  `navhud.test.ts` (6; exact ellipse/band crossing). Checked in the browser on data-dummy.

### Doing

- —

### Next

- Bind the HUD to WS2's `route_nom_104` once `make web` publishes it (already works on data/interim).
- con_* fields when V1 lands (`make fields` again; worst-case + bearing unchanged).
- 60 fps check at 60× on a real laptop (the automated browser here is throttled to ~15 fps even
  when the HUD is idle, so it measures nothing).

### Blocked

- **Way-home path (F18 drag-anywhere), C:** the pointer field is **not in contracts v1.1.0**. A
  pointer cannot be resampled to 5 m (moves are grid-relative), so it needs its own grid.
  Proposal (implemented behind `--with-pointer`, off by default; TS follower `wayhome.ts` ready):
  `fields/{scenario}/pointer.png`, `scale` 1, `units` "move", plus entry keys `bounds`, `width`,
  `height`, `res_m` (WS2 route_3m grid) and `stencil` (WS2 `pointer_offsets.json`). nom_104 only,
  ≈ 0.3–0.6 MB. Until then drag-anywhere shows the numbers but no path.
- **Fields size, C:** all opt/nom suits = 28.4 MB (con_* will add ≈ 8 MB → ≈ 37 MB), over the
  20 MB target, under 50 MB per file. PNG optimisation gains < 2 %; the scales are fixed by the
  contract. The HUD reads only the active scenario (nom_104 + worst/bearing), its conservative
  twin and slope (≈ 17 MB with opt_104/con_104). C to choose: all 9 scenarios (contract table) or
  only the 104 kg suits in the web tree (`make fields --scenarios …`).
- **WS2 question:** `turn_back` rows (t 409 / 439 min, after the return, margin 0, binding O₂)
  are read as annotations "latest time to leave each station" and kept out of the walk; their
  O₂ binding differs from the dose-bound margins of the same stations (storm τ 85.9 min). Confirm
  the meaning.

### Assumptions added

- A-WS7-1: within a leg the marker follows the route's `times_min`; without them, uniform speed.
- A-WS7-2: worst-case fields and the alarm-3 circle skip cells with no T_home (blocked > no-go,
  unreached): the crew cannot be there on the plan. Unknown only if no reachable cell is in the
  disc. (The M0 dummy used "any unknown → unknown".) Disc radius rounded up to whole 3 m cells
  (12 / 51 / 102 m).
- A-WS7-3: HUD margin = (timeline `margin_min` + `t_home_min`, interpolated in t) − T_home at the
  position (worst case within σ); turn-back countdown = that margin.
- A-WS7-4: storm switch puts the 2024 onset at the EVA minute the switch is turned on; the
  tripwire fires after the real onset→tripwire delay (rad.json); the dose budget then counts down
  from `leash.tau_min_at_peak`; alarm 2 when T_home ≥ budget left.
- A-WS7-5: drift σ = fix σ at the fix, else max(fix σ, floor 5 m, 2 % of distance since the fix).
- 5 m sampling: each 5 m pixel takes the 3 m cell under its centre (no ties on these grids);
  slope = the 1 m `slope_5m` cell at the 5 m pixel centre; `home_bearing` = geometric bearing to
  the pad (grid.json), known everywhere.

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

- 2026-11-14T10:11Z: M1 F21 dead-reckoning error model (`pipeline/navigation/deadreckon.py`: step scale
  + per-step noise, psi0, gyro bias, heading random walk, slip above `slip_min_slope_deg`; fix events
  reset position to N(0, sigma) and heading to a new psi0) and Monte Carlo summaries
  (`pipeline/navigation/montecarlo.py`: 95% ellipses per minute, r95, r95(D) = a*D + b*D^2 NNLS fit,
  contract writers for `nav/montecarlo_{set}.json`, `nav/tracks_{set}.geojson`, `nav/fixes.json`,
  manifest keys `nav.r95_fit.*`, `nav.montecarlo.*`, `nav.fixes.*`). Ported from the pre-H0 reference
  code and checked against contracts v1.0.0. KATs on a synthetic straight route, full Monte Carlo from
  config (500 runs, seed 20261114): zero-error = truth; heading-bias-only lateral error = analytic within
  1%; 95% ellipse covers 95.6 / 94.8 / 95.0% of runs at 10 / 30 / 60 min; error resets at fixes; slip
  only above 10 deg; contracts validate.
- 2026-11-14T10:15Z: fix-interval map (`fixinterval.py`): margin radius, D_max = inverse r95 fit, 0
  outside the homeline, NaN where T_home is unknown; classes from `fix_interval.classes_m`;
  `nav/fix_interval_summary.json` (one file, `set` = nav.yaml `default_set`; other sets in the run
  report); `fields/fix_interval_{set}.png` (1 m per count) on the HUD field grid. KATs: D_max smaller near
  the edge and 0 outside; EDT radius = worst-field interpolation where both exist; PNG round trip.
- Real-route driver (`real.py`, `run.py`), `make nav` (= `run real`; `NAV_ARGS=--no-skyline` for the G2
  fallback). `run real --dry-run` lists inputs with owners. Writes to `data/interim/navigation/` (mirrors
  the web paths), refuses `web/public/`. End-to-end KAT on a tmp WS2/WS1-shaped tree.
- 2026-11-14T10:21Z: `/nav` view (`web/src/nav/`) on data-dummy: fix-interval classes, estimated track
  (truth behind "show truth"), 95% ellipses every 5 min, fix events, playback with the ellipse in force
  and the SPEC position line ("Odometry ±N m · next fix due in M m · last fix …"), headline from the
  summary, ellipse-size chart, method and parameter table from config. Exports for WS7's HUD:
  `navReading`, `navLine`, nav loader, D_max decoder, ellipse geometry. vitest 5 files / 33 nav tests;
  tsc + vite build clean.
- 2026-11-14T10:26Z: F22 skyline fix (`skylinefix.py`: coarse 50 m grid / 1 deg rays / far field >=
  500 m, refine 10 m around the best 3, far-weighted RMS, sigma from the 1.5 x min-RMS region) and
  `run skyline` (every WS3 frame tried, standalone 300 m prior, `skyline_report.json` +
  `localisation/{image_id}.json`); `run real` turns frames paired with a route station into skyline fixes
  (lowest RMS, never lowest error). KATs: synthetic DEM with a known observer recovered within one
  10 m grid step, every frame reported, contracts. Verified against `origin/ws3-horizon` (92d2f61) in a
  temp worktree: all 47 nav KATs pass there; on main the 4 engine KATs skip until WS3 merges.
- `tests/test_nav.py`: 44 pass + 4 skipped (WS3) before the main merge; full suite and ruff green.
- 2026-11-14T10:31Z: merged `origin/main` (WS3 now on main): all 48 nav KATs pass, none skipped
  (F22 synthetic-DEM KAT included); full pytest, ruff, tsc, vitest (212), validate_contracts green.

- 2026-11-14T11:20Z (session 2): **real run `make nav`** on WS2's `route_nom_104` (pad -> S4 -> S2 ->
  pad, 209.74 min, 6,215 m, slope known on 100 % of steps), 500 runs per set, seed 20261114, 2 min 14 s
  (F22 over 49 frames included). Fix events: rover at the pad (0, 209.74 min, sigma 2 m), station
  fixes at S4 (48.44 min) and S2 (108.73 min, sigma 5 m); no skyline fix passed the gate (below).
  Outputs in `data/interim/navigation/` at the contracts/README web paths; `validate_contracts --data
  data/interim/navigation` OK (0 errors); manifest fragments `pipeline__navigation__{montecarlo,
  fixinterval,skylinefix}.json`.
  - **r95(D) fit (NNLS, no intercept), b = 0 in all sets** (pure linear on this route): low a =
    0.0376, medium **a = 0.1323 (132 m per km since the last fix)**, high a = 0.3697; fit RMSE 5.0 /
    29.9 / 169.6 m.
  - **r95 along the route (medium)**: EVA t = 30 min (1,681 m since the pad fix) **187 m**; 60 min of
    walking after the S2 fix (t = 199 min, 1,718 m since it) **268 m**; largest just before the
    return fix (2,099 m since S2) 358 m. Low: 60 / 66 m; high: 392 / 889 m at the same points.
    At t = 60 min the crew is dwelling at S4 just after its fix (12.3 m in every set).
  - **Fix-interval headline (medium, nom_104, 30-min homeline; `nav/fix_interval_summary.json`)**:
    D_max median **50.7 m**, edge p10 **22.7 m**; area inside the homeline by class: < 100 m 76.9 %,
    100-300 m 20.1 %, 300-1,000 m 3.0 %, > 1,000 m 0 % (134,557 cells). Low: median 178.5 m, high:
    18.1 m (run report only). Reading: D_max = margin radius / a, so the median margin radius is
    ~6.7 m: the reachable set (12.4 % of the disc, slope-limited, thousands of blocked holes) leaves
    little room to the nearest over-limit cell. For N: "fix every ~50 m" is a property of the
    fragmented reachable set as much as of the drift model.
- 2026-11-14T11:20Z: **F22 on the real frames, station frames included** (C 11:58 gate, KAT
  tolerance = `skyline_fix.refine_grid_m` 10 m). All 49 frames tried: 35 ran, 14 failed WS3's
  clear-sky check ("no clear sky at the top of the frame"); error median **657 m** (p25-p75 452-815
  m), min 257 m, **0 within 10 m, 0 within 100 m**, 4 within 300 m. Station frames (WS3 tags):

  | Station | Frame | Frame to station | Error | RMS | sigma (score) | Gate |
  | --- | --- | --- | --- | --- | --- | --- |
  | S1 (not on route) | NLB_826633404 | 523 m | 788 m | 4.02 deg | 48.9 m | fail |
  | S2 | NLB_789347468 | 925 m | 280 m | 2.84 deg | 48.9 m | fail |
  | S4 | NLB_767161116 | 128 m | 966 m | 6.04 deg | 48.5 m | fail |

  **No skyline fix becomes a position fix**; S4 and S2 keep their surveyed station fixes (sigma 5 m);
  `run_report.json skyline.rejected` gives the reason per station. The score-surface sigma (~49 m)
  understates the real error by 6-20x, so sigma alone must not gate a fix. The far-field skyline
  barely constrains position here (lowest-RMS frames: 0.04 deg RMS at 401 m error). Even a passing
  frame would localise the rover's drive end, 128-925 m from the station, not the station.
  `localisation/{image_id}.json` for the 35 frames that ran (validation finding, not position fixes).
- 2026-11-14T11:20Z: F22 now reads the horizon engine's bands from horizon.yaml `bands.*.path` (WS1
  canonical `terrain/ctx_20m.tif`, `mola_hrsc_200m.tif`, C 11:15); nav.yaml `skyline_bands:
  horizon.yaml`.
- 2026-11-14T11:20Z: **nav.yaml `vo:` block** (WS10 request): `PENDING_VO_CONFIG` verbatim, `assumed:
  true`; `vo.load_vo_config()` now returns "config/nav.yaml vo" (KAT: every key equals the pending
  value). **`optional_sets.curiosity_vo_256`** (label "rover analogue: a rover is not an astronaut",
  status pending N): sigma_s 0.00638, sigma_b 1.248 deg/h of rover driving (WS10 `vo_report.json`),
  psi0 / psi_rw / slip null (not measured; `missing_terms_from: medium`). Not in `sets`, not the
  default, not run by `make nav`.
- Fields grid: WS7's canonical grid = WS1 `grid.json fields_5m` (1,480 x 1,480 at 5 m, pad +/- 3,700
  m) is identical to WS9's `field_grid()` (WS7 KAT); `fields_index_nav.json` written on it. Nothing to
  change.
- KATs: `tests/test_nav.py` 54 pass (6 new: gate tolerance, gate pass/reject, rejected frame keeps the
  station fix, canonical bands, vo keys, optional set); full pytest, ruff, tsc, vitest nav (33) green.

### Doing

- — (session 2 done; ws9-nav pushed for C)

### Next

- Hand WS7 the nav outputs for the HUD (ellipse, "next fix due in M m"); `/nav` on the real files once
  `make web` copies `data/interim/navigation/`.
- If N approves the Curiosity set: wire `optional_sets` into a run (needs a rule for the unmeasured
  terms). An all-sets fix-interval summary only after G1 (C 11:58).

### Blocked

- (N) Model review: `model_conventions`, `fix_interval_ws9.reserve_min` 0 (SPEC "budget minus
  reserve" has no reserve defined), and whether sigma_b per hour of rover driving transfers to a
  walker (WS10 Curiosity set).
- (C) F22 presentation: all three station frames fail the gate (280-966 m), so F22 is a validation
  finding only; the HUD/nav plan uses station fixes (per C 11:58). Nothing more for WS9 to do unless
  WS3's detector / V2 changes.

### Assumptions added

- `config/nav.yaml model_conventions` (assumed): how SPEC F21's prose model maps to code (psi0 redrawn
  at each fix, gyro bias per run, random walk per step, per-step noise summed, slip along-track,
  ellipse = chi-square 2-dof from the second moment, NNLS fit without intercept). For N to confirm.
- `config/nav.yaml tracks` (ellipse every 5 min from SPEC §6.2; 72 polygon vertices, presentation).
- `config/nav.yaml fix_interval_ws9` (assumed): budget = crew.yaml walkback_budgets_min[0]; reserve 0
  (SPEC says "budget minus reserve" but no reserve is defined for it; crew.yaml reserve_min = 30 is
  the EVA reserve and would zero the 30-min homeline): question to N; margin radius by exact
  distance transform (= the circular max-filter criterion, not capped at 100 m) with SPEC's
  worst-field interpolation kept as an option; unknown T_home counts as over the limit; edge figure
  = 10th percentile of D_max inside the homeline.
- `config/nav.yaml real_run_ws9` (assumed): timeline event -> fix type; a skyline fix replaces the
  station fix; frame pick = lowest RMS; standalone prior; unknown slope = no slip; field grid; DEM band
  paths for the horizon engine (WS1 dem_1m, WS3 `data/interim/horizon/bands/`).
- Synthetic walking speed = crew.yaml anchor 0.98 m/s.
- `config/nav.yaml real_run_ws9.skyline_fix_gate` (decided by C 11:58, tolerance from
  `skyline_fix.refine_grid_m`); `vo:` (WS10's constants, assumed); `optional_sets` (pending N).

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
- **X8 stereo VO at 256² (brief step 2), 10:47 UTC, D16 = go at 256² only.** `pipeline/navigation/vo.py` (ported from the pre-H0 reference code, run fresh on this session's frames), 22 new KATs in `tests/test_vo.py` (48 pass): CAHV/CAHVOR triangulation, known baseline → depth = f·b/d, linearised pinhole exact for rays, same pose → zero motion, 1 m + 4° step with 30 % outliers, metric scale from stereo, rendered 256² textured-ground stereo (same pose; 0.95 m + 3° step), chain/endpoint metrics, bridged steps counted, drift table lists every drive incl. no-data, per-pose attitude comparison, stop rule. Output `data/interim/vo/drift.json` (valid against `vo_drift.schema.json`, every row labelled "rover analogue: a rover is not an astronaut") + `vo_report.json` (per-pose, onboard and calibrated-set detail); manifest keys `vo.drift.*`. 19.5 MB downloaded (all 256² TRAV pairs of the 5 drives; `data/raw/vo/` now 29 MB).
- Method: SIFT, mutual ratio-test L/R matching, midpoint triangulation on each frame's own CAHVOR (≤ 1 px reprojection, 0.5–25 m), frame-to-frame PnP + RANSAC on the linearised next-left camera + LM refinement; a failed step is bridged with the rover's onboard relative pose and counted. Start = MMGIS previous drive end (position + yaw/pitch/roll); compared with the MMGIS drive end and, per pose, with the API `attitude`/`xyz`.

  | Sol | Drive | MMGIS m | VO steps (failed) | Bridged m | End error m | Drift % | Heading drift ° | Per-pose heading vs attitude RMS / max ° | Onboard vs MMGIS m |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | 5073 | 125_2274 → 2490 | 27.9 | 36/36 (0) | 0 | 0.241 | 0.86 | −0.98 | 0.58 / 1.09 | 0.153 |
  | 5070 | 125_2082 → 2274 | 28.7 | 31/32 (1: no end pair) | 0.90 | 0.199 | 0.69 | +0.29 | 0.19 / 0.38 | 0.264 |
  | 5069 | 125_1326 → 2082 | 101.3 | 125/125 (0) | 0 | 1.884 | 1.86 | −2.44 | 1.20 / 2.18 | 0.342 |
  | 5045 | 125_1194 → 1326 | 12.6 | 21/22 (1: 12 matches) | 1.19 | 0.099 | 0.79 | −0.76 | 0.50 / 0.74 | 0.004 |
  | 5041 | 125_558 → 1194 | 83.9 | 100/103 (3: 3 matches, RANSAC, no matches) | 1.14 | 0.566 | 0.68 | −0.88 | 0.80 / 1.39 | 0.413 |

  End error is horizontal; drift % = end error / MMGIS `dist_m`. 4 off-pointing pairs dropped on sol 5041. **Caveat: MMGIS drive ends are Curiosity's own localisation (onboard wheel + IMU + VO, ground-updated), not independent truth**; the onboard-vs-MMGIS column shows how close they are (0.0–0.4 m), so our VO error is close to that floor only on the short drives.
- **Stop rule (D16, deadline H8 = 17:00 CET): verdict plausible at 11:47 CET**, 5/5 drives pass (rule, assumed: ≥ `go_rule.min_drives` = 2 drives with drift ≤ 10 %, |heading drift| ≤ 10°, ≥ 80 % of steps by VO). X8 stays in.
- Curiosity-calibrated set (in `vo_report.json`, label "rover analogue: a rover is not an astronaut"): σ_s = 0.0064 (RMS along-track scale error, 5 drives), σ_b = 1.25 °/h of *rover driving* (RMS heading drift / drive duration); ψ₀ and slip are not measurable by VO → null, WS9 keeps its assumed values. Not yet handed to WS9 (brief: by H20; N to review first).

### Doing

- — (step 2 done; waiting for N's review of the drift table and the calibrated set)

### Next

- N reviews; then hand the calibrated set to WS9 (by H20). X9 only after G2, if green and N is free.

### Blocked

- VO constants are in `vo.py PENDING_VO_CONFIG` (all assumed: resolution, TRAV tag, pointing tolerance 5°, ratio 0.8, stereo reprojection 1 px, range 0.5–25 m, PnP 1.5 px / 2000 it / 0.999, min inliers 15, max step 3 m / 45°, plausibility 10 % / 10° / 0.8). WS9 owns `config/nav.yaml`: please add them as a `vo:` block with `assumed: true` (the code reads `nav.yaml vo` as soon as it exists). WS9 / C.
- N: confirm the stop-rule plausibility thresholds above (proposal) and whether σ_b per hour of rover driving is the right quantity for F21 (rover drives ~1 m/min; a walker ~1 m/s).

### Assumptions added

- Probe conventions (code, not config): a stereo pair = L and R with the same spacecraft clock, `subframe_rect` and `scale_factor`; API `sample_type: thumbnail` (64²) never counts; pairs at one (site, drive) are one pose; runs are counted within one resolution class; a step across a site change is unknown.
- Each drive's previous end is on an earlier sol, so only the end sol was queried; frames from intermediate sols would be missed (can only undercount).
- Caveat for step 2: 256² only (f ≈ 306 px); the mast looks right and down (az 90°, el −29°) on 4 drives and forward on sol 5070, so VO sees near-field ground.
- VO: a failed step or a missing drive-end pair is bridged with the onboard relative pose (reported as `bridged_m`, never hidden); at the start pose the last pair before driving is used, elsewhere the first pair at a pose.

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
| 2026-11-14 11:58 | F22 skyline fix presentation | Per SPEC §12 risk 15: report the result honestly (scratch trial: median 617 m, none within 100 m; the far-field skyline barely constrains position here) as a validation finding; the HUD/nav plan falls back to **station fixes**; no skyline fix is shown as a position fix unless a real frame passes the F22 KAT tolerance | C |
| 2026-11-14 11:58 | Frame↔station pairing for F22 | WS3 sets `station` in `navcam_frames.json` for each station's overlay frame | C |
| 2026-11-14 11:58 | Nav playback values provenance | Per-minute ellipse/r95/distance rows are covered by the Monte Carlo file's manifest entry (row-level keys not required); every static number keeps its own key | C |
| 2026-11-14 11:58 | Fix-interval summary sets | Keep contract v1.1 (one file, default set) for G1; an all-sets bump only if time after G1 | C |
| 2026-11-14 12:20 | WS2 Q10 web size | No further size cuts: keep 6 decimals (SPEC §6) and do not hole-filter the bands; every file < 50 MB (engine tree 79.5 MB raw / 12.1 MB gz) | C |
| 2026-11-14 12:20 | Way-home pointer field (WS7 proposal) | Accepted into `fields_index` v1.1.1: `fields/{sc}/pointer.png`, scale 1, units "move", own grid (per-entry bounds/width/height/res_m on WS2's 3 m grid) + `stencil`; optional properties | C |
| 2026-11-14 12:20 | Fields scope | Ship all scenarios of the contract table (≈ 37 MB with con_*; 28.4 MB now) | C |
| 2026-11-14 12:20 | HUD sun / time-to-dark | No `sun.json` contract: WS7 reads `conditions/clock.json eva.sun_series` and `eva.t_dark_min` (WS4) | C |
| 2026-11-14 12:20 | Station card nulls | `margin_binding: null` for a station with no route or no access cell (S1); the card still ships | C |
