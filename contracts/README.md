# Data contracts (pipeline → web)

**Contracts v1.0.0.** Only C changes a contract, by PR with a version bump and a note to every
consumer (AGENTS.md rule 4). Every schema carries `"x-contract-version"` and `"x-source"` (the SPEC
section or brief it comes from).

Source of truth: SPEC.md §6, §6.1, §6.2. Schemas are JSON Schema draft 2020-12.
Validate with `uv run python tools/validate_contracts.py` (CI runs it on every PR; add
`--interim data/interim` for the pipeline-internal files).

Where SPEC fixes a structure, the schema follows it key for key. Where SPEC names a file but not
its structure, the schema is deliberately loose (`partner`, `route`, `horizon_ring`, `coverage`,
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

### Station images — `cards/{station}/panorama.png`, `overlay.png` (brief WS3)

PNG. `panorama.png` is the predicted panorama strip; `overlay.png` is a transparent skyline overlay
on the Navcam frame. Paths are referenced from `cards/{station}.json`.

### Basemap tiles — `tiles/basemap/` (SPEC §4, brief WS1)

XYZ PNG tiles of the HiRISE ortho, zoom levels for 0.25–10 m. Layout details are WS1's to propose.

### Rasters — `data/interim/` (pipeline-internal; briefs WS1, WS2)

GeoTIFF COG in the analysis CRS (SPEC §4.2, `config/site.yaml`), float32 unless stated. See the
"Produces" tables in `briefs/WS1.md` and `briefs/WS2.md`. Not validated by
`tools/validate_contracts.py`.

### Size

No file in git may exceed 50 MB (AGENTS.md rule 9). `tools/validate_contracts.py` checks the two
data trees; CI also checks every tracked file.
