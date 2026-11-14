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
