# Backend contracts (F23–F36) — v1.0.0

**Frozen 2026-11-14 at backend gate P0 (D50).** Owner C. Versioned on its own, like the simulator
bundle family (`contracts/bundle/`, v1.0.0); the web contracts in `contracts/` keep their 1.1.x line.
Changes only by C's PR with a version bump and a note to WS11–WS14 (AGENTS.md rule 4, backend kit rule 9).
Schemas are JSON Schema draft 2020-12; the API is OpenAPI 3.1.

| File | Validates | Used by |
| --- | --- | --- |
| `plan_inputs.schema.json` | user inputs of one plan (K1, D52) | `POST /jobs`, `/pads/screen`, `/plans/import`, plan library, JSON export, `run_record.inputs` |
| `run_record.schema.json` | `results/{hash}/run_record.json` = `GET /results/{hash}/provenance` (F35) | WS11 writes, WS13 verify view |
| `job.schema.json` | job status (F23) | WS11, WS13 |
| `telemetry.schema.json` | `#/$defs/batch` telemetry in, `#/$defs/state_event` state out (SSE and telemetry response), `#/$defs/command` (F31) | Unity, WS14, WS13 mission control |
| `openapi.yaml` | the whole API v1 (backend spec §5) | WS11–WS14, WS13 mocks, `/api/docs` |
| `examples/` | one or more illustrative documents per schema (`{schema}.{case}.json`) | tests, OpenAPI `externalValue`, mocks |

What the schemas do **not** carry: limits, ranges, length caps and defaults. Those live in
`config/backend.yaml` (backend kit rule 8) and the server enforces them; the schemas fix structure
and names, and refuse unknown fields.

Location: the backend kit names `contracts/plan_inputs.schema.json` and `contracts/openapi.yaml`.
The family lives in this folder instead, because every top-level `contracts/*.schema.json` must map
to a web data path (`tests/test_contracts.py::test_every_schema_is_mapped`,
`tools/validate_contracts.py`), and these are not web data. Same pattern as `contracts/bundle/`.

## Two "plan" documents (D52)

- **`plan_inputs.json`** (this folder): what a user chose. Omitted fields take config defaults.
- **`plan.json`** in a plan bundle (`contracts/bundle/plan.schema.json`, frozen): the resolved plan
  identity (plan id, pad, scenario, station order, engine, world). Built from the inputs and the
  result tree; never sent by a client.

## Result hash (D57)

`hash = sha256(canonical_inputs + "\0" + engine_tree + "\0" + engine_config_hash + "\0" + terrain_hash)[:16]`

- `canonical_inputs`: `plan_inputs` with every default filled in, `title` removed (a title does not
  change a result), floats rounded to 6 decimals, JSON with sorted keys, no spaces, UTF-8.
- `engine_tree`: `git rev-parse HEAD:pipeline` (content-addressed: a commit that touches only
  `server/`, `web/` or docs keeps every cached result).
- `engine_config_hash`: the `config_hash` rule of `tools/make_bundle.py` over `config/*.yaml`
  **except `backend.yaml`** (`config/backend.yaml compute.hash.exclude_config`), so changing a rate
  limit does not invalidate results.
- `terrain_hash`: sha256 of the server data manifest written by `tools/make_serverdata.py`.
- Lower-case hex, 16 characters (`config/backend.yaml compute.hash`).

## Share codes (D55)

`HL-` + 6 characters of Crockford base32, alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (no `I L O U`),
9 characters in total, e.g. `HL-7K2Q9M`. Pattern `^HL-[0-9A-HJKMNP-TV-Z]{6}$`
(`openapi.yaml` `ShareCode`; config: `config/backend.yaml plans.share_code`).

## Result tree

`results/{hash}/` holds the same file names and schemas as `web/public/data/` (validated with
`tools/validate_contracts.py`), plus `run_record.json`. Scenario ids for custom crews are `nom`,
`opt`, `con` inside the result (backend spec §7).

## Checks

```sh
uv run --no-sync pytest tests/test_backend_contracts.py -q
# the OpenAPI meta-schema check needs openapi-spec-validator (skipped when absent):
uv run --no-sync --with openapi-spec-validator pytest tests/test_backend_contracts.py -q
```

## Changes

- 1.0.0 (2026-11-14, P0): first version. The state event (`session_state` in the pre-P0 draft) is
  part of `telemetry.schema.json` (backend spec F31, WS14 brief: "sample + state event").
