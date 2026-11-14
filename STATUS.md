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
