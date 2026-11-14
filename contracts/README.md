# Data contracts (pipeline → web)

**Contracts v1.1.1** (2026-11-14, additive; see "Changes" at the end). Only C changes a contract,
by PR with a version bump and a note to every consumer (AGENTS.md rule 4). A schema's
`x-contract-version` is the version that last changed it (1.0.0, 1.1.0 or 1.1.1). Every schema carries `"x-contract-version"` and `"x-source"` (the SPEC
section or brief it comes from).

Source of truth: SPEC.md §6, §6.1, §6.2. Schemas are JSON Schema draft 2020-12.
Validate with `uv run python tools/validate_contracts.py` (CI runs it on every PR; add
`--interim data/interim` for the pipeline-internal files).

Where SPEC fixes a structure, the schema follows it key for key. Where SPEC names a file but not
its structure, the schema is deliberately loose (`partner`, `route`, `coverage`,
`rems`, `clock`, and the open parts of `v1`, `v2`, `donki`, `fp3d_index`); the producing workstream
proposes the structure to C by PR, and C bumps the version.

## JSON / GeoJSON files

Paths are relative to both `web/public/data/` (real) and `web/public/data-dummy/` (dummy, see
`docs/dummy.md`). Coordinates are lon/lat, Mars 2000 planetocentric, 6 decimals.

| Data path pattern | Schema | Source |
| --- | --- | --- |
| `scenarios/index.json` (**index**) | `scenarios_index.schema.json` | §6 |
| `scenarios/{scenario}/isochrones.geojson` | `isochrones.schema.json` | §6 |
| `scenarios/bands_{suit}.geojson` | `bands.schema.json` | §6 |
| `scenarios/{scenario}/edges.geojson` | `edges.schema.json` | §6 |
| `scenarios/{scenario}/partner.geojson` | `partner.schema.json` | §6 (named in the index; no properties given) |
| `stations.json` | `stations.schema.json` | §6 |
| `cards/{station}.json` | `card.schema.json` | §6 |
| `route_{scenario}.geojson` | `route.schema.json` | §6 |
| `timeline_{scenario}.json` | `timeline.schema.json` | §6 |
| `trade_table.json` | `trade_table.schema.json` | §6 |
| `pad.json` (carries `dummy`) | `pad.schema.json` | §6 (F8, added 13 Nov) |
| `conditions/rad.json` | `rad.schema.json` | §6 |
| `manifest.json` | `manifest.schema.json` | §6 |
| `fields/index.json` (**index**) | `fields_index.schema.json` | §6.1, §6.2 |
| `fp3d/index.json` (**index**) | `fp3d_index.schema.json` | §6.1 |
| `fp3d/horizon_ring.json` | `horizon_ring.schema.json` | §6.1 |
| `localisation/{image_id}.json` | `localisation.schema.json` | §6.1 |
| `nav/montecarlo_{set}.json` | `montecarlo.schema.json` | §6.2 |
| `nav/fixes.json` | `fixes.schema.json` | §6.2 |
| `nav/tracks_{set}.geojson` | `tracks.schema.json` | §6.2 |
| `nav/fix_interval_summary.json` | `fix_interval_summary.schema.json` | §6.2 |
| `vo/probe.json` | `vo_probe.schema.json` | §6.2 |
| `vo/drift.json` | `vo_drift.schema.json` | §6.2 |

### Beyond SPEC §6

These files are not in §6 but are named as outputs in SPEC §2 (feature table) or in a brief, and
other workstreams read them. Each schema says where it comes from.

| Data path pattern | Schema | Why |
| --- | --- | --- |
| `validation/v1.json` | `v1.schema.json` | SPEC §2 F13 output; brief WS6 lists its content; read by the WS5 scorecard |
| `validation/v2.json` | `v2.schema.json` | SPEC §2 F13 output; brief WS3 lists its content; read by the WS5 scorecard |
| `validation/coverage.json` | `coverage.schema.json` | brief WS1 output; scorecard shows coverage (SPEC §2 F16) |
| `validation/coreg.json` | `coreg.schema.json` | brief WS1 output; scorecard shows co-registration residuals |
| `conditions/rems.json` | `rems.schema.json` | SPEC §2 F14 (`conditions/*.json`); brief WS4 |
| `conditions/clock.json` | `clock.schema.json` | SPEC §2 F14; brief WS4 |
| `conditions/donki.json` | `donki.schema.json` | SPEC §2 F14; brief WS4 ("context only, not a trigger") |
| `validation/kats.json` | `kats.schema.json` | SPEC §2 F16 KAT pass list; WS6 `pipeline/provenance/kats.py` |
| `siting_png.json` (v1.1.0) | `siting_png.schema.json` | F8 siting heatmap `siting.png` placement (4 corners, MapLibre order); WS2 |
| `tiles/basemap/tilejson.json` (v1.1.0) | `tilejson.schema.json` | F17 basemap index (TileJSON 3.0.0 subset); written by `make web` |
| `terrain/cellstate.json` (v1.1.0) | `cellstate.schema.json` | F1 cell states for hatching unknown terrain; written by `make web` from WS1 |

The web paths `validation/coverage.json` and `validation/coreg.json` are B0's choice (WS1's
brief names the files, not their web path); `make web` copies them there.

### Pipeline-internal JSON (not web-facing)

Paths relative to `data/interim/`. Checked with `tools/validate_contracts.py --interim data/interim`.

| Path | Schema | Producer → readers |
| --- | --- | --- |
| `horizon/horizons/{observer_id}.json` | `horizon.schema.json` | WS3 → WS4, WS8, WS9 (SPEC §2 F12) |
| `horizon/navcam_frames.json` | `navcam_frames.schema.json` | WS3 → WS4, WS9, WS10 (brief WS3) |
| `terrain/coverage.json` | `coverage.schema.json` | WS1 |
| `terrain/coreg.json` | `coreg.schema.json` | WS1 |

The glob tables are `SCHEMA_MAP` and `INTERIM_SCHEMA_MAP` in `tools/validate_contracts.py`.
JSON files that match no pattern produce a warning, not a failure.

### Dummy flag

Every **index** file (`scenarios/index.json`, `fields/index.json`, `fp3d/index.json`) and
`pad.json` has a required boolean `"dummy"`: `true` in `data-dummy/`, `false` in `data/`. Other
object-shaped files may carry an optional `"dummy"`. CI fails if any file under
`web/public/data/` has a top-level `"dummy": true`, or if an index file under `data-dummy/` lacks
`"dummy": true`.

## Non-JSON formats

### Field PNGs — `fields/{scenario}/{name}.png` (SPEC §6.1), `fields/fix_interval_{set}.png` (SPEC §6.2)

- One image per field over the planning extent at 5 m (`config/hud.yaml` `field_png.res_m`;
  ≈ 1,480 × 1,480 px).
- 8-bit RGBA PNG. Value in counts = `R·256 + G`; B = 0; A = 255 valid, A = 0 unknown. Physical
  value = counts × `scale` from `fields/index.json` (browser canvases drop 16-bit PNG precision).
- Units per count (`config/hud.yaml` `field_scales`):

| Field | Per count | Scenarios |
| --- | --- | --- |
| `t_home` | 0.1 min | all 9 return scenarios |
| `o2_home` | 0.01 L | all 9 |
| `home_bearing` | 0.01° | `nom_104` |
| `slope` | 0.01° | shared |
| `t_home_worst_{10,50,100}`, `o2_home_worst_{10,50,100}` | as above | `nom_104` |
| `fix_interval_{set}` (D_max) | 1 m | per nav set |

- Every field PNG is listed in `fields/index.json` (`bounds [w, s, e, n]`, `width`, `height`,
  `res_m`, `fields.{name}: {file, scale, units, scenario}`).
- **`pointer` uses its own grid (v1.1.1).** `fields/{scenario}/pointer.png` is WS2's way-home
  pointer (`engine/{scenario}/pointer.tif`) on WS2's native 3 m route grid (`grid.json route_3m`),
  not the 5 m fields grid: a move index cannot be resampled. Its entry carries its own `bounds`,
  `width`, `height`, `res_m` (3) and a `stencil` ([drow, dcol] per move, from WS2
  `pointer_offsets.json`); `scale` 1, `units` "move"; counts = move index k, next pixel =
  (row + drow[k], col + dcol[k]), rows north to south; A = 0 = no move (pad or unreached).
  Writer: WS7 `pipeline/export/fields_png.py --with-pointer`. An entry without its own grid keys
  uses the top-level grid.

### 3D files — `fp3d/` (SPEC §6.1, F20; brief WS8)

| File | Format |
| --- | --- |
| `fp3d/index.json` | Chunk grid, bounds, height scale (JSON, schema above) |
| `fp3d/near/{i}_{j}.f32.gz` | Near height chunk: 256 × 256 Float32 heights at 1 m, gzipped; corridor ≈ 300 m wide along the route |
| `fp3d/near_tex/{i}_{j}.jpg` | JPEG texture for the matching near chunk |
| `fp3d/far.f32.gz` | Far heights: Float32 at 8 m over the planning extent, gzipped |
| `fp3d/horizon_ring.json` | Far skyline ring (JSON, schema above) |

Byte order, row order and the height-scale/offset convention are not fixed by SPEC; WS8 records
them in `fp3d/index.json`. Total 3D download ≤ `config/hud.yaml` `performance.budget_3d_mb`.

### Station images — `cards/{station}/panorama.png`, `overlay.png`, `navcam.png` (brief WS3)

PNG. `panorama.png` is the predicted panorama strip; `overlay.png` is a transparent skyline overlay
on the Navcam frame (`navcam.png`). Paths are referenced from `cards/{station}.json`.

### Station cards — `cards/{station}.json` (v1.1.1, merged by `make web`)

C decision 2026-11-14 11:42: two producers, one file. WS3 writes
`horizon/public/cards/{S}.json` (`navcam`, `skyline_error_deg`, `panorama_png`, `landmarks`, plus
`observer`, `provisional`, `skyline_error_scope`, `landmarks_note`); WS2 writes
`engine/public/cards/{S}.timeline.json` (`timeline`, `margin_binding`, `contingency`, plus
`scenario`, `on_route`, `margin_min`, `t_home_min`, `o2_home_L`, `science`, `access`). `make web`
merges them key by key (nothing computed) and records the parts in `parts`. A station lacking
either part gets **no card** (reported missing under the absent part's owner; its images are not
copied). Parts that disagree (station id, a key set by both, science point, or WS3's observer not
at WS2's access cell) stop the run. The `*.timeline.json` parts never reach the web tree.

Access block (`access`, user decision 11:40, access-cell rule): `lon`/`lat` of the access cell
(null = none within `radius_m`), `dist_m` (= `access_dist_m`, science point to access cell),
`t_home_min`/`o2_home_L` from the access cell, `reason` when there is none, `walk_in` (straight
line, **not modelled**: `dist_m`, `rise_m`, `mean_slope_deg`, `max_slope_deg`,
`max_terrain_slope_deg`), `radius_m`, `rule`. `science` is the unmoved science point. A station
with no access cell or not on the route has null `timeline` times and `margin_binding: null`.

### Horizon ring — `fp3d/horizon_ring.json` (v1.1.1, WS3 layout)

One object: `observer` {`lon`, `lat`, `eye_height_m` required; `id`, `x`, `y`, `z_ground_m`,
`z_eye_m`, `source`}, `az_step_deg`, `max_range_m`, `az_deg[]`, `elev_deg[]` (required), and
optional parallel arrays `dist_m[]`, `z_m[]` (areoid height of the horizon point), `east_m[]`,
`north_m[]` (offsets from the observer, analysis CRS), `source[]` (band), plus `min_range_m`
(only terrain beyond it counts; the near mesh covers the rest), `crs`, `azimuth_convention`
(deg clockwise from grid north), `radius_m`, `notes`. Every array has one value per azimuth;
null = unknown. `elev_deg` includes the curvature drop d²/2R. The M0 dummy ring (no distances) is
the minimal form; WS8's `ring.ts` reads both.

### Basemap tiles — `tiles/basemap/{z}/{x}/{y}.webp` + `tiles/basemap/tilejson.json` (v1.1.0)

WS1 writes XYZ PNG tiles of the HiRISE colour ortho (`data/interim/terrain/tiles/basemap/`,
z13–18, 256 px). `make web` re-encodes them to WebP (`config/web.yaml web_export.basemap`: quality
80; if the tiles exceed `budget_mb` 50 the top zoom is dropped, z18 first) and writes
`tilejson.json` describing exactly the tiles written:

- `tiles`: URL template **relative to the data root** (`tiles/basemap/{z}/{x}/{y}.webp`); the app
  prefixes its data base URL. `scheme` `xyz`; Mars lon/lat pass straight through (D4).
- `minzoom`, `maxzoom`, `bounds` [w, s, e, n] (tile extent of the zooms that tile the whole
  window), `attribution`, `tileSize`.
- `zoom_bounds` {"17": [w, s, e, n], ...}: zooms tiled over a smaller area (WS1 tiles z17–18 over
  the focus area only). A client that wants no 404s uses one source for minzoom..(first
  zoom_bounds key − 1) with `bounds`, and one per partial zoom range with its `zoom_bounds`;
  otherwise MapLibre simply shows nothing where a z17/z18 tile is absent.

For WS5's `BasemapSource`: `tiles` (prefixed), `tileSize`, `minzoom`, `maxzoom`, `bounds`,
`attribution` map one to one.

### Cell states — `terrain/cellstate.png` + `terrain/cellstate.json` (v1.1.0)

The F1 routing-grid cell states, so the app can hatch unknown terrain (and show blocked cells).
`make web` writes them from WS1's `cellstate_3m.tif` (one PNG pixel per 3 m routing cell, rows
north to south; nothing resampled). Encoding as the field PNGs: 8-bit RGBA, counts = `R·256 + G`
= state for known cells (0 assessed, 1 blocked), B = 0, **A = 255 known, A = 0 unknown** (state 2:
non-HiRISE or no data). `cellstate.json` gives `image`, `bounds` [w, s, e, n] of the outer pixel
edges (lon/lat; the analysis CRS is equirectangular, so the grid is axis-aligned in lon/lat),
`width`, `height`, `res_m`, `variant` (`nominal` = 20° no-go; `conservative` once WS1 writes
`cellstate_3m_conservative.tif`), `codes`, and `pct` (share of the image in each state; manifest
keys `terrain.cellstate.pct.*`). WS5: hatch where A = 0, exactly as the field-alpha hatch, placed on
`bounds` as a MapLibre image source. The dummy tree has a 5 m version (`res_m` says which).

### Siting heatmap — `siting.png` + `siting_png.json` (v1.1.0)

Grey PNG of the F8 siting score (WS2 `pipeline/engine/siting.py`; white = `grey_max_score`).
`siting_png.json` `coordinates` are the 4 image corners as [lon, lat] in MapLibre image-source order
(top-left, top-right, bottom-right, bottom-left).

### Rasters — `data/interim/` (pipeline-internal; briefs WS1, WS2)

GeoTIFF COG in the analysis CRS (SPEC §4.2, `config/site.yaml`), float32 unless stated. See the
"Produces" tables in `briefs/WS1.md` and `briefs/WS2.md`. Not validated by
`tools/validate_contracts.py`.

## `make web` sources (tools/make_web.py `RULES`)

`make web` empties `web/public/data/` and fills it only from these producer paths (relative to
`data/interim/`); a source with top-level `"dummy": true` / `"synthetic": true`, or written before
H0, stops the run. Every expected output that is absent is listed as missing under its owner.
`make web-plan` prints the plan without writing; `--skip-owner WSn` leaves an owner out (e.g. while
its run is in progress), with its manifest entries.

| Owner | Source (`data/interim/…`) | Web path |
| --- | --- | --- |
| WS1 | `terrain/coverage.json`, `coverage.png`, `coreg.json` | `validation/…` |
| WS1 | `terrain/cellstate_3m.tif` | `terrain/cellstate.png` + `.json` (transform) |
| WS1 | `terrain/tiles/basemap/{z}/{x}/{y}.png` | `tiles/basemap/{z}/{x}/{y}.webp` + `tilejson.json` (transform) |
| WS2 | `engine/public/**` (mirror of the web tree: `scenarios/`, `stations.json`, `route_*`, `timeline_*`, `trade_table.json`, `pad.json`, `siting.png`, `siting_png.json`) | same path |
| WS3 | `horizon/validation/v2.json` | `validation/v2.json` |
| WS3 + WS2 | `horizon/public/cards/{S}.json` + `engine/public/cards/{S}.timeline.json` | `cards/{S}.json` (merged, see "Station cards") |
| WS3 | `horizon/public/cards/{S}/*.png` (built cards only), `horizon/public/fp3d/horizon_ring.json` | same path |
| WS4 | `conditions/{rad,clock,rems,donki}.json` | `conditions/…` |
| WS6 | `validation/v1.json`, `v1.svg`, `kats.json` | `validation/…` |
| WS7 | `export/fields/index.json`, `export/fields/{scenario}/*.png` | `fields/…` |
| WS8 | `export/fp3d/{index.json, near/*.f32.gz, near_tex/*.jpg, far.f32.gz}` | `fp3d/…` |
| WS9 | `navigation/{nav,localisation,fields}/…` (real run only) | same path |
| WS10 | `vo/probe.json`, `vo/drift.json` | `vo/…` |

Manifest: every fragment in `data/interim/manifest/` is merged (WS6 `manifest.merge`); WS1's
`terrain/manifest_pending.json` is merged as WS1's fragment until WS1 records through
`pipeline.provenance.manifest.record`. Fragments made by the dummy generator are refused. An entry
whose `file` is a web path that this run does not write (a skipped owner, a missing output, a card
not built) is left out, as is a skipped owner's entry citing its `data/interim/` source; entries
citing other pipeline-internal `data/...` files stay.

### Size

No file in git may exceed 50 MB (AGENTS.md rule 9). `tools/validate_contracts.py` checks the two
data trees; CI also checks every tracked file.

## Changes

### v1.1.0 (2026-11-14, C) — additive; every new property is optional unless in a new schema

| Schema | Change | Consumers |
| --- | --- | --- |
| `partner.schema.json` | feature properties `case`, `casualty_kg`, `contour_min`, `style` (const `dashed`), `default_visible` (const `false`), `caption`, `feasible`, `area_km2` (WS2 `haul.py`) | WS5 |
| `route.schema.json` | leg properties `leg`, `from`, `to`, `t_min`, `o2_L`, `length_m`, `t_start_min`, `t_end_min`, `times_min[]` (one per vertex) (WS2 `traverse.py`) | WS5, WS8, WS9 |
| `timeline.schema.json` | row properties `margin_binding` (`O2`/`daylight`/`dose`/null), `in_partner_line`, `o2_tasks_left_L`, `o2_margin_min_planning_rate`; `event` values documented (`depart`, `arrive`, `leave`, `return`, `turn_back`, `o2_checkpoint`) | WS5, WS7, WS9 |
| `rad.schema.json` | `leash.tau_min_at_latest`, `formula`, `D_allow_note`, `table[]` ({`D_allow_mGy`, `tau_min_at_peak`, `tau_min_at_latest`}, one row per D9 slider step), `d_allow_range_mgy`, `d_allow_step_mgy` | WS5 (D9 slider) |
| `siting_png.schema.json` (new) | `siting_png.json` | WS5 |
| `tilejson.schema.json` (new) | `tiles/basemap/tilejson.json` | WS5 |
| `cellstate.schema.json` (new) | `terrain/cellstate.json` (+ PNG format above) | WS5 |

D9 slider: the range and step are config values (`config/conditions.yaml leash.d_allow_range_mgy`,
`leash.d_allow_step_mgy`), read at build time; `rad.json leash.table` carries τ for every step of
that range (its first and last `D_allow_mGy` are the range). There is no
`leash.d_allow_slider_mgy` key.

### v1.1.1 (2026-11-14, C) — additive; every new property is optional

| Schema | Change | Consumers |
| --- | --- | --- |
| `card.schema.json` | `margin_binding` may be **null** (no route or no access cell, e.g. S1); optional `station`, `scenario`, `on_route`, `margin_min`, `t_home_min`, `o2_home_L`, `science` {lon, lat}, `access` {lon, lat, dist_m, t_home_min, o2_home_L, reason, walk_in, radius_m, rule}, `observer`, `provisional`, `skyline_error_scope`, `landmarks_note`, `parts`, `dummy`; navcam `stop_id`, `dist_to_observer_m`, `credit`; landmark `kind`, `above_skyline`. Merged by `make web` (above) | WS5 (station card, cuff: render a null binding as "none"), WS7 |
| `stations.schema.json` | `access_radius_m`, `access_lon`, `access_lat`, `access_dist_m`, `access_reason` (default scenario), `access` {scenario: access record} (WS2 Q12). `lon`/`lat` stay the science point; `t_home_min` is from the access cell | WS5, WS8, WS9 |
| `timeline.schema.json` | station rows: `access_dist_m` | WS5, WS7, WS9 |
| `route.schema.json` | leg property `to_access_dist_m` | WS5, WS8, WS9 |
| `horizon_ring.schema.json` | WS3's layout (above); now an object only | WS8 |
| `fields_index.schema.json` | optional per-entry `bounds`, `width`, `height`, `res_m`, `stencil` (pointer on its own 3 m grid; WS7 proposal) | WS7, WS5 |

`SCHEMA_MAP` is unchanged (`cards/*.json` is safe: the `*.timeline.json` parts are never copied to
the web tree; one there would fail the card schema).
