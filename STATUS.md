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
