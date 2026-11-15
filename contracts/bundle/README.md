# Simulator bundle contracts (D41) — v1.0.0

**Frozen 2026-11-14 20:00 CET.** Owner C. Later changes come only as a version bump with a
note to the Unity team (AGENTS.md rule 4). This family is versioned on its own
(`"x-contract-version": "1.0.0"` in every schema here); the web contracts in `contracts/` keep
their own 1.1.x line.

Sources: SPEC §11 **D40** (backend, set A 17:16) and **D41** (Unity handover, set A 17:24); the
handover page "EVA simulation module — handover data from the planner" (parts A, B, D, E); the
format list of the superseded set-B D40 (17:22), which set A does not contradict: JSON,
little-endian float32 grids with a JSON header, PNG/JPEG textures, zip bundles; pad-local metres;
terrain in the planner's chunking and resolution; Unity maps (x, y, z) → (x, z, y) and resamples
itself.

The planner makes **no engine-specific exports**: everything below is the planner's own data, in
its own grids, with a stated frame. The simulator adapts.

## Two zips

| Zip | Content | Served by (D42) | Changes when |
| --- | --- | --- | --- |
| **Plan bundle** (one per plan) | plan identity + inputs (`plan.json`), route, timeline, stations, pad, fields of the plan's scenario, bands / partner line, sun, storm, golden vectors, config snapshot, provenance subset | `GET /api/v1/plans/{ref}/bundle` | any input of that plan |
| **World pack** (shared) | terrain chunks (1 m), far grid (8 m), textures, horizon ring, slope, cell states of every variant | `GET /api/v1/world/{version}/…`, downloaded once | the terrain export |

A plan bundle names the world pack it was built against (`plan.json world.version`,
`index.json world_version`). Both zips start with **`index.json`** (the handover's entry point;
schema `bundle.schema.json`), then every other entry sorted by path.

## Schemas (this folder)

| Schema | Validates | Notes |
| --- | --- | --- |
| `plan.schema.json` | `plan.json` in a plan bundle (and as served alone) | plan id, pad (official / picker / custom), scenario (variant, suit), station order, EVA start (LMST, D31), storm replay key (D39), engine commit, config hash, contract version, created UTC, origin `precomputed` / `computed_live` + label (D40), `dummy: false` |
| `bundle.schema.json` | `index.json` of both zips | kind `plan` / `world`, ids, version check fields, frame, bounds, **every file** with path, media type, bytes, sha256, role, frame, units, contract, grid header (`.f32`), source (path + sha256 + transform), status |
| `route_local.schema.json` | `route.json` | route every 1 m, pad-local |
| `points.schema.json` | `points.json` | pad, stations, access cells, pad-local |
| `sun.schema.json` | `conditions/sun.json` | from WS4 `clock.json` |
| `storm.schema.json` | `conditions/storm.json` | 2024 storm on the EVA clock (D39) |
| `config_snapshot.schema.json` | `config_snapshot.json` | parsed `config/*.yaml` |

Files copied from the planner keep their **web contracts** (`contracts/*.schema.json`, v1.1.x):
`index.json` names the schema of each file in `contract` (`timeline.schema.json`,
`golden.schema.json`, … ; this family's as `bundle/…`). Binary files have `contract: null`
and are described by `grid` (`.f32`) or the tables below.

## Coordinate frame (both zips)

- **Pad-local metres, origin at the pad, x = east, y = north, z = up** (right-handed).
- x, y = analysis-projection metres minus the pad's projected position. The projection is the
  planner's analysis CRS (`config/site.yaml crs.analysis_proj`, equirectangular, R = 3,396,190 m),
  stated in `index.json frame.projection` with `pad_xy_m`, plus the pad's lon / lat / elevation.
- z = height above the Mars areoid minus the pad elevation (`frame.pad.elev_m`).
- **Unity:** position = (x, z, y) = (east, up, north). A bearing b (degrees clockwise from north,
  every bearing in the planner) is a rotation of b about Unity +y, starting from Unity +z.
- Files marked `frame: "lonlat"` are planner copies in lon/lat (Mars 2000 planetocentric);
  convert with the projection in `index.json` if needed — the pad-local versions are already in
  the bundle.

## Float32 grids (`.f32`)

Raw little-endian IEEE float32, row-major, **row 0 = northernmost row, column 0 = westernmost**,
no file header (bytes = 4 × rows × cols). The JSON header is the file's `grid` object in
`index.json`:

| Key | Meaning |
| --- | --- |
| `shape` | [rows, cols] |
| `cell_m` | cell size, m |
| `origin_m` | [x, y] of the **north-west corner** of cell (0, 0), pad-local m. Cell (r, c) covers x ∈ [x0 + c·cell, x0 + (c+1)·cell], y ∈ [y0 − (r+1)·cell, y0 − r·cell] |
| `nodata` | value marking unknown cells (fields: −9999.0), or null = every cell valid |
| `units`, `value` | units and what the value is |
| `z_to_frame_m` | heights only: pad-local z = stored value + this (= −pad elevation). Heights stay areoid metres, unscaled |
| `quantum` | values are multiples of this (the source encoding step) |
| `stencil` | pointer only: [drow, dcol] per move index |

**Sampling rule for planner values (fields): nearest cell** — the HUD's rule, so values match
the planner exactly. T_home and O₂_home are always looked up, never recomputed (handover rule 1).

## Plan bundle layout

| Path | Contract | Content |
| --- | --- | --- |
| `index.json` | `bundle/bundle.schema.json` | manifest (kind `plan`) |
| `plan.json` | `bundle/plan.schema.json` | identity and inputs (also next to the fixture zip) |
| `route.json` | `bundle/route_local.schema.json` | rows `[leg, s_m, x_m, y_m, z_m, t_eva_min, speed_ms, grade_deg, slope_deg]` every 1 m of horizontal arc length per leg (plus each leg's end); x, y, t linear between the engine's vertices; z = world-pack terrain (bilinear); slope = 5 m slope field (nearest); speed and grade to the next sample. `legs[]` gives each leg's rows and times; a station's dwell is the gap between legs |
| `points.json` | `bundle/points.schema.json` | pad, stations (science point) and access cells (this scenario), x / y / z |
| `fields/{name}.f32` | grid | this scenario's fields from WS7's RG-PNGs, value = counts × scale (bit-exact with the HUD): `t_home` (min), `o2_home` (L), `home_bearing` (deg), `pointer` (move index on the 3 m grid + `stencil`), `t_home_worst_{10,50,100}`, `o2_home_worst_{10,50,100}` |
| `local/bands_{suit}.geojson`, `local/edges.geojson`, `local/partner.geojson`, `local/route.geojson` | — | the planner's GeoJSON with every position as [x_m, y_m] (pad-local), properties unchanged: 30/60-min bands (nominal / conservative / optimistic) and edge causes ("homeline"), the partner line (cart, 60 min) with the drag finding (D20), the route's engine vertices |
| `conditions/sun.json` | `bundle/sun.schema.json` | sun azimuth / elevation every 5 min of the EVA, time to dark (flat and per observer) |
| `conditions/storm.json` | `bundle/storm.schema.json` | RAD 20 May 2024 storm, rows `[eva_min, utc, uGy_day, mGy_h]`, eva_min = t* + (utc − tripwire_utc); baseline, tripwire, peak, dose allowance |
| `physio/golden.json` | `golden.schema.json` (web v1.1.5) | WS2's test vectors; **the C# port is accepted when it reproduces every case within the tolerance the file states** (`tolerances.{group}`: \|got − want\| ≤ abs + rel·\|want\|) |
| `config_snapshot.json`, `config_snapshot.yaml` | `bundle/config_snapshot.schema.json` / — | every `config/*.yaml`, parsed, keyed by file name |
| `manifest_subset.json` | `manifest.schema.json` | provenance entries for the bundle's planner files and their sources |
| `planner/…` | web contracts | verbatim planner files in lon/lat: `route_{scenario}.geojson`, `timeline_{scenario}.json` (events, O₂ checkpoints, turn-back per station, margin + binding term), `stations.json`, `cards/{S}.json`, `pad.json`, `scenarios/index.json`, the scenario's bands / edges / partner, `conditions/{rad,clock,rems}.json`, `fields/index.json` (this scenario's entries) and the field RG-PNGs (`fields/{scenario}/*.png`, the "existing RG-PNG as a copy") |

Not in v1 (additive later): card images, Navcam reference frames, roughness hints.

## World pack layout

| Path | Content |
| --- | --- |
| `index.json` | manifest (kind `world`); `world_version` = `world-` + 12 hex of the sha256 over its file list |
| `terrain/near/{i}_{j}.f32` | 256 × 256 heights at 1 m (WS8 chunks, gunzipped; corridor around the official route), `z_to_frame_m` |
| `terrain/near_tex/{i}_{j}.jpg` | JPEG covering exactly chunk {i}_{j} (HiRISE colour, greyscale where colour is missing) |
| `terrain/far.f32`, `terrain/far_tex.jpg` | 8 m heights over ±6 km and its texture (same extent) |
| `terrain/slope.f32` | slope (deg), 5 m fields grid |
| `terrain/cellstate_{nominal,conservative,optimistic}.f32` | F1 cell states on the 3 m routing grid: 0 assessed, 1 blocked, 2 unknown (per variant no-go slope) |
| `horizon_ring.json` | WS3 far skyline ring around the pad (`horizon_ring.schema.json`); `east_m` / `north_m` = pad-local x, y |
| `planner/fp3d/index.json` | WS8's 3D index (reference) |

Unity resamples terrain to its own sizes (Unity Terrain needs square 2ⁿ+1 heightmaps) and keeps
heights unscaled. Assumed or artistic elements (sky, haze, wind, rocks < 3 m, storm effects) are
not in the pack and are labelled as visual. Every view says **"Simulated EVA · real terrain and
data"** (`index.json label`).

## Version check (handover part D)

Every `index.json` and `plan.json` carries `engine_commit`, `config_hash` and
`contract_version`. The simulator compares them with `GET /api/v1/engine/version` and refuses a
mismatched bundle. **`config_hash`** = `"sha256:"` + hex sha256 over `config/*.yaml` sorted by
file name, each fed as utf-8 file name, NUL byte, the raw file bytes, NUL byte
(`tools/make_bundle.py config_hash`). `engine_commit` = the manifest commit of the plan's route
file.

## Validity of a zip

A zip is valid when: its first entry is `index.json` and the rest are sorted by path; every
entry is listed in `index.json` exactly once (except `index.json` itself) with matching `bytes`
and `sha256`; every `.f32` has 4 × rows × cols bytes; every JSON file validates against its
`contract`; and (plan) `index.json` and `plan.json` agree on plan id, engine commit, config
hash and world version. `make bundle-check` (and `tools/make_bundle.py --check ZIP…`) runs all
of it.

## Builder and fixture

- `make bundle` → `data/bundles/plan_{plan_id}.zip` + `data/bundles/{world_version}.zip` from
  `data/interim` (through `tools/make_web.py`'s copy rules, so exactly what `make web` would
  publish, incl. the merged station cards; `web/public/data` is the fallback), plus
  `data/interim/engine/summary.json` (D39 t*), `data/interim/terrain/grid.json` (grid origins),
  WS1's cell-state rasters, `data/interim/manifest/` and `config/`. Deterministic: fixed zip
  timestamps (1980-01-01) and attributes, entries sorted, deflate level 9, fixed JSON layout.
- **Fixture** (`make bundle-fixture`): `fixtures/official_pad_v1/` holds `plan_bundle.zip` (official
  pad, `nom_104`), `world_pack.zip` (full, not cropped), `plan.json` (a copy of the one in the zip)
  and `fixture.json` (zip sizes, sha256s, the zlib build). It lets the Unity team start before
  the server exists and when it is down.
- Tests (`tests/test_make_bundle.py`, run by CI): known answers (frame, config hash, field
  decode, 1 m resampling, storm re-timing, zip determinism, tamper detection); the fixture
  round-trips (unzip → validate → sha256 match) and repacks byte-identically (bytes compared when
  the zlib build matches the fixture's, else entries and CRCs). A full rebuild from `data/interim`
  is compared byte for byte locally, while the recorded source sha256s still match.

## Mission file (v1.1.0, draft — additive, awaiting C)

`mission.schema.json` validates **`mission.json`**, one hand-built mission from the web Mission
Planer (`/mission`), sent to the simulator on its own (download → "Load mission", POST to a
local listener, or WebGL `SendMessage`). It does not replace the plan bundle: the bundle carries
the terrain and the fields (`t_home`, `o2_home`, `home_bearing`, `pointer`) for any position; the
mission file carries **what the user planned** and **what should happen when**, so the simulator
compares the live walk with it and never recomputes planner numbers (handover rule 1).

| Block | Content |
| --- | --- |
| `frame` | the pad-local frame above (projection, `pad_xy_m`, pad lon / lat / elev); Unity = (x, z, y) |
| `scenario`, `world` | scenario of the fields; which plan bundle / world pack to load for off-route lookups |
| `constants`, `conditions` | budget constants (crew.yaml via `budget.ts`), F18 amber threshold, time to dark, storm switch, t* |
| `waypoints[]` | visit order, lon/lat + x/y/z, note, tags, stop minutes, planned arrive / leave, T_home, O₂_home |
| `legs[]` | `out` legs pad → #1 → … → #n and one `home` leg along WS2's pointer path; length, time, O₂, row range |
| `path` | rows `[leg, s_m, x_m, y_m, z_m, t_eva_min, o2_used_l, t_home_min, o2_home_l]` per routing-grid vertex (5 m), not resampled |
| `timeline` | planned state over EVA time (`margin.ts` points): O₂ used, T_home, O₂_home, margin, binding term; `lowest` |
| `summary` | the panel's totals and `feasible` |

Deviation in the simulator = live value − the planned value at the same EVA minute (`timeline`,
linear in t) or at the nearest `path` row (cross-track distance). Status colours follow SPEC
F18: margin > `margin_amber_min` green, 0 … amber, < 0 red "TURN BACK NOW".

The numbers are **browser estimates** on the 5 m routing grid (`mission/data.ts`), not WS2's
validated 3 m results: `origin` is always `mission_planer`, and `origin_label` says so on screen.
Unknown values are `null`; an unrouted leg makes `feasible` false and `timeline` null.

## EVA log (v1.1.0, draft — additive, awaiting C; written unattended 2026-11-15)

`eva_log.schema.json` validates **`eva_log.json`**, the way back: one EVA walked in the Unity
simulator against a `mission.json`, for replay and review on the web. The simulator writes it
(`Nasa-Space-App` `Assets/Mars/Scripts/Mission/EvaLogger.cs`) when the EVA completes, or as
incomplete when a new mission, Clear or the end of the scene interrupts it.

| Block | Content |
| --- | --- |
| `summary` | complete, EVA minutes vs planned, waypoints done / skipped / left early, lowest live margin and its term, worst cross-track and delay, O₂ used vs planned |
| `waypoints[]` | per waypoint: state, planned arrive / leave, actual arrive / done, left early |
| `events[]` | start, arrive, done, skip, status change, complete, end (EVA minute, waypoint index) |
| `track` | rows `[t_min, lon, lat, elev_m, cross_track_m, schedule_delta_min, o2_used_l, o2_delta_l, margin_min, status]` every 5 s of EVA time |

Positions are map coordinates (lon/lat, MOLA elevation), because the simulator's world origin is
its spawn, not the pad. O₂ is the simulator's own suit model (`o2_model` says so), so `o2_delta_l`
compares two different models on purpose: it shows how the walk differed from the plan. The live
margin uses the planner's terms (O₂, daylight, EVA duration); the dose term is left out because
`mission.json` carries no storm series. Status words and thresholds are the simulator's
(`MissionTracker.cs`): TURN BACK below `margin_amber_min`, RETURN NOW below 0 (SPEC F18), REPLAN
when the rest of the plan no longer fits, OFF ROUTE beyond 25 m, BEHIND beyond 5 min (assumed).

## Clarification (2026-11-14, D57, no schema change)

`config_hash` and `config_snapshot.json` cover `config/*.yaml` **except `backend.yaml`** (server-only
settings: rate limits, CORS, gates). The fixture is unchanged (byte-identical rebuild). The backend's
result hash uses the same rule (`contracts/backend/README.md`).
