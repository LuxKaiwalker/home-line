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

### Doing

- Waiting for WS1's real routing grids.

### Next

- On WS1 hand-off (`data/interim/terrain/elev_3m.tif`, `maxslope_3m.tif`, `cellstate_3m.tif`, `ridge_index.tif`, `stations.json`): `make engine` for nom_104 first, hand rasters to WS7, bands/edges/isochrones to WS5 (G1).
- Margins: wire WS4 daylight (t_dark) and dose leash (tau_dose) once their files exist (CLI `--t-dark-min`, `--tau-dose-min` meanwhile).
- Switch `pipeline/engine/provenance.py` to WS6's `manifest.record` when it lands (TODO; until then entries go to `data/interim/engine/manifest_fragment.json`, contract-valid).

### Blocked

- Real-grid tasks (brief tasks 3-6) need WS1's grids and stations (expected ~H4).
- Conservative scenarios (con_*) and the F8 siting rule (conservative T_home) need WS6's V1 RMSE (`data/interim/validation/v1.json`, `rmse_deg`); they are skipped until it exists.
- Questions for S (science):
  1. IST-2 uphill check fails by ~2.7x at the anchor speed: k*v at 0.98 m/s, nominal 104 kg = +23.8 / +34.9 mL/kg/min at 20 / 30 % grade vs IST-2 +8.7 / +17.0 (optimistic 21.5 / 31.4). Check IST-2's test speed and `ist2.delta_mass_kg` (verify_at_h0).
  2. Margin units: SPEC F4 m(t) mixes litres (O2 term) and minutes. Assumed: O2 surplus / effort-capped O2 rate (1.35 L/min at 75 kg) -> minutes (`variants.yaml route.o2_margin_rate`). Dwell O2 uses VO2 = V0 (`route.dwell_vo2`). Confirm or replace.
  3. Haul model: with boot_mu 0.5 < drag mu 0.5-0.7 the drag case is infeasible on level ground and uphill for both casualty masses (traction rule); the 343 kg cart is infeasible above ~0 deg uphill. Partner line will be small; intended?
  4. Casualty mass: SPEC F10 says 165-186 kg suited, haul.yaml rule body + suit gives 155/179/195 kg. Using haul.yaml.
  5. Headline flat disc uses the anchor speed 0.98 m/s (as site.yaml planning_radius_m); nominal level v* is 0.918 m/s (104 kg), so flat terrain reads ~88 %, not 100 %. Alternative: disc at each scenario's level v*.
- Questions for C (code/contracts):
  6. Who writes the web `stations.json`? WS2 fills `t_home_min` and `in_partner_line` from WS1's `data/interim/terrain/stations.json` and writes `data/interim/engine/public/stations.json`.
  7. Proposed loose-contract structures: `partner.geojson` properties `{case, casualty_kg, contour_min, style: "dashed", default_visible: false, caption, feasible, area_km2}`; `route_*.geojson` leg properties `{leg, from, to, t_min, o2_L, length_m, t_start_min, t_end_min, times_min[]}`; timeline rows add `margin_binding` and (when known) `in_partner_line`, plus `turn_back` events. `siting_png.json` (image corners) has no schema; siting tiles vs one PNG?
  8. F11 partner_area_km2 uses the 60-min partner line (cart, suited casualty) in both budget rows; reachable_pct uses the nominal variant. OK?

### Assumptions added

- `variants.yaml route` (assumed: true): o2_checkpoint_min 30 and budget crew.eva_h (SPEC F9 values), o2_margin_rate, dwell_vo2.
- `variants.yaml numerics.grade_table_step_deg` 0.01 (assumed: true; lookup resolution, KAT error < 1e-4).
- `haul.yaml g_moon` 1.62 m/s^2 (assumed; standard lunar g, only for the Mars/Moon KAT).
- O2 used before a departure is bounded by the effort-capped rate in the DP check (VO2 never exceeds the cap), so the DP stays exact; the timeline reports actual margins.
- Pre-H0 station snapping is not used: a station with no walk home gets null.

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

- —

### Doing

- —

### Next

- —

### Blocked

- —

### Assumptions added

- —
