# Route features end to end: harness and demo script (WP8a, D97; WP8c, D110)

Gates: **W1 13:30** (ordered stations end to end on localhost), **W2 16:00** (free waypoints + saving,
and the simulator export: scenarios h and i),
**W3 16:45** (WP8b = the final run of this harness against the real API). Capture 17:00–19:00.

The harness is `tests/e2e/route/`. It drives the real web app in a browser, in the style of the H5
driver (`docs/hardening/e2e-drive.mjs`). It uses Playwright from a worktree's `node_modules`
(not a dependency of this repo) and drives the **system** Chromium headless, because Playwright's
bundled browser does not start on NixOS. Web security stays on. Each scenario gets pass/fail criteria
and timings, screenshots, and one JSON result file.

| File | What |
|---|---|
| `tests/e2e/route/drive-route.mjs` | The driver: scenarios a–i, `--mock` or `--real <api>` |
| `tests/e2e/route/mock-api.mjs` | A tiny mock API built from `contracts/backend/examples`. It runs a staged job on a clock, has an infeasible variant and gives 422s naming the stop. WP8c: live trees carry `mission.json` (manifest kind `sim_plan`), the official tree a precomputed one |
| `tests/e2e/route/serve-web.mjs` | Vite **dev** server (not a production build, so not heavy) with `VITE_LIVE=1` and `VITE_SIM_EXPORT=1` (the "Send to simulator" control, as the live-demo build). Mock mode: `VITE_API_BASE` = the mock. Real mode: same-origin proxy to the API |
| `tests/e2e/route/check_mission.py` | WP8c: validates one downloaded `mission.json` against `contracts/bundle/mission.schema.json` and checks the `mission_id` rule (the helper of `tests/test_mission_contract.py`). Run by the driver with `uv run --no-sync python`; no npm dependency |

## How to run

Ports for this block: mock/API **8150–8199**, Vite **4200–4299**. Never use 8012 (the demo) or 8020–8099.
Check that the ports are free first: `ss -ltn | grep -E ':(8170|4230) '`. The defaults are 8170 and 4230,
because another package's uvicorn was on 8150 during WP8a. Change them with `--api-port` and `--web-port`.

### Mock mode (no engine, about 80 s)

```sh
# the UI under test: a checkout whose web/ has the route panel (R5) and My plans (R7)
node tests/e2e/route/drive-route.mjs --mock --web-dir /path/to/checkout/web --out /tmp/hl-way/wp8a/run
```
- The driver starts `mock-api.mjs` on 8170 and the web on 4230. It stops both at the end.
- `--stage-ms` sets the length of each mock stage (default 4000). The mock runs five stages: nominal,
  bands, partner, route, summary. That is 20 s per job.
- The mock on its own: `node tests/e2e/route/mock-api.mjs --port 8170`. Its placeholder feasibility
  model: `node tests/e2e/route/mock-api.mjs --explain S4,S1,S2,S7,S8`.
- What the mock serves:
  - A route job's result tree is the official static tree, gated by stage.
  - `route_nom_104.geojson` is **synthesized from the submitted stops in the given order**. This is how
    the harness checks "nothing reordered".
  - The run record is `run_record.route_infeasible.json` with the job's hash, inputs, `route_mode` and
    `feasibility`.
  - Placeholder feasibility: straight walk × 1.25 at 40 m/min, plus 30 min dwell per stop, against a
    360 min budget. With it, S4, S1, S2 is feasible, and S4, S1, S2, S7, S8 fails on leg 5, S7 → S8:
    "EVA duration", 30.0 min short.
  - The numbers are placeholders, not results. The mock's hash is not the server's D57 hash, so the
    hash-parity criterion runs only in real mode.
  - WP8c, simulator export (interfaces "Simulator export"): a live tree's `manifest.json` gets one entry
    of kind `sim_plan` (`sim.mission` → `mission.json`), and once the job is done `mission.json` is a
    placeholder mission (origin `computed_live`, label `labels.live`) built from
    `contracts/bundle/examples/mission.mission_planer.json`'s fixed blocks and the mock's legs: waypoints in
    the submitted order, `summary.feasible` = the run record's feasibility, `mission_id` by the README
    rule. The official tree (manifest untouched, as WP9c) serves `mission.json` with origin `precomputed`
    (route S7, S6, S1, S4 from the static route file). `serve-web.mjs --sim-official` answers
    `sim/official/mission.json` with the same document while the checkout under test has no
    `web/public/sim/official/mission.json` (an existing file wins).

### Real mode (WP8b; read-only use of the API)

```sh
OFF=$(uv run --no-sync python -c "from server.engine.hashing import official_hash; print(official_hash())")
node tests/e2e/route/drive-route.mjs --real http://127.0.0.1:8012 --official-hash $OFF --out /tmp/hl-way/wp8b/run1
```
- The driver only submits normal plan jobs: the routes for a and b. For c, the driver rewrites the body
  in the browser so the API answers a 422, and no job is created. It never calls admin or plan-storage
  endpoints.
- The web runs on 4230 and proxies `/api/v1` to the API with the `Origin` header removed. The real API's
  CORS list (`config/backend.yaml api.cors_origins`) has only `localhost:5173` and the Pages origins.
  To test the cross-origin path the demo uses, pass `--web http://localhost:5173` (a running
  `VITE_LIVE=1 npm run dev`) instead.
- Each real job takes about 6 min (H5: 360–490 s). `--job-wait-s` defaults to 900.
- The S4, S1, S2 result is cached after the first run (same hash). The second run attaches at once, so
  "first stage before done" then reads `null` (cached), as in H5 step 4.
- Real data (orchestrator, prod smoke job): S4, S1, S2 is **infeasible** (leg 3 S2 → pad, O2, 23.84 min
  short), so in real mode h uses S4, S1, S6, S7 (feasible) and h-infeasible uses S4, S1, S2. a and b keep
  their own `--ordered` / `--infeasible` (a's checks follow the run record's planned legs, so S4, S1, S2
  still runs; WP8b decides whether a and the main demo script move to S4, S1, S6, S7 as well).
- h and i need no mocking in real mode: `mission.json` comes from the server (WP9b exporter; the official
  one from WP9c). i's schema check passes only once WP9c's schema (origin `precomputed`) is in the
  harness checkout, or with `--mission-schema`.
- If S4, S1, S2, S7, S8 turns out **feasible** on the real engine, b fails on `runRecordInfeasible`. Pick
  another order with `--infeasible S…` and use the same order in the demo script below.
- Server data on `/home/vincent/hl-data/server` is shared. A real job there runs only inside
  `flock /tmp/hl-heavy.lock` (common rules).

### Options
`--scenarios a,b,c,e,f,g,h,i`, `--ordered S4,S1,S2`, `--infeasible S4,S1,S2,S7,S8`, `--web <url>`,
`--web-port`, `--api-port`, `--wp6` (runs d), `--out`. Environment: `PW` (playwright/index.mjs, default
`~/coding/hl-h2/web/node_modules/playwright/index.mjs`), `CHROMIUM`.
The exit code is 0 when every scenario that ran passes, 1 when one fails, and 2 on a driver crash.
Output: `route-e2e-result.json` (criteria, timings, job polls, network log, console errors and warnings)
and the screenshots `a-*.png` … `i-*.png`. h and i also save the downloads (`h-mission.json`,
`i-mission.json`, `i-static-mission.json`; `*.fetched.json` = no download happened and the driver fetched
the link only to report what it points to). `--mission-schema <path>` validates against another schema
(e.g. WP9c's before it merges).

## Scenarios and pass criteria

A criterion that is `null` is informational and is not judged.

| | Scenario | Pass criteria (keys in `route-e2e-result.json`) |
|---|---|---|
| a | Ordered stations: "My order", check S4, S1, S2 in that order, Compute plan | `listInPickOrder`, `submittedInOrder` (POST /jobs route = S4, S1, S2), `stagesInOrder` (job polls extend stages_done in order, nominal first), `firstStageBeforeDone` ("Nominal band and route · on the map" before the done poll; null if cached), `resultShown`, `labelComputedLive`, `provenanceLink` (= `#/plan/{job hash}/provenance`), `provenanceView` (origin computed_live), `runRecordOrdered` (route_mode ordered), `runRecordStopsInOrder`, `mapRouteInOrder` (the route file the map draws has legs pad→S4→S1→S2→pad), `listUnchangedAfter`, `panelHashEqualsJobHash` (real only: the D57 hash in the panel = the server's), `noUncaught` |
| b | Infeasible order S4, S1, S2, S7, S8 | `runRecordInfeasible`, `panelShowsInfeasible`, `namesFailingLeg` ("Leg n: from → to", data-leg = feasibility.leg), `namesLimit`, `namesMinutesShort` ("Short by x.x min" = shortfall_min), `legHighlightedInList` (`.hl-route__leg[data-state=failing]`), `legHighlightedOnMap` (null: judged on `b-infeasible.png`), `submittedInOrder`, `listNotReordered`, `mapRouteIsPlannedPrefix` (only the planned legs, in order), `noUncaught` |
| c | 422 on a bad stop (stop 2 rewritten to S99 in the browser) | `api422`, `errorStopGiven` (Error.stop integer), `panelShowsFailure` (`.hl-route__failed[data-status=422][data-code]`), `panelNamesStop` ("Stop {stop+1}"), `noJobCreated`, `noUncaught` |
| d | Free points (WP6): add two, drag one, rename, delete, validity, ghost route "estimate", compute | **skipped until WP6 lands** (`--wp6`). Written against requested selectors (see below) |
| e | Saving (R7): permalink in a fresh page, Save to My plans, reload, open, rename, export, import, delete | `permalinkRenders` (computed_live), `permalinkRouteOrdered`, `permalinkStopsInOrder`, `saved`, `listedAfterReload`, `renamed` (also after reload), `openedFromList`, `exportCarriesRoute`, `importSameHash` (import lands on `#/plan/{same hash}`), `deleted` (also after reload), `noUncaught` |
| f | Static first: every `/api/v1` request refused by the browser | `staticHeadline23`, `offlineBanner`, `noRouteControlsShown`, `computeDisabled`, `noUncaught` |
| g | Official permalink | `precomputedLabel`, `sameAsStatic` (first three numbers = the static console's: 23 / 30 / 15.2), `official23`, `noneWithheld`, `noUncaught` |
| h | **Export to the simulator (W2, D110)**: a feasible ordered route (mock S4, S1, S2; **real S4, S1, S6, S7**, `--export-route`) → Compute → "Send to simulator" → the downloaded `mission.json` | `resultShown`, `runRecordAsExpected` (feasible), `exportControlShown` (on the route panel, else on `#/plan/{hash}`), `controlHasHook` (`[data-sim-export]`, design S1), `controlOriginLive` (`data-origin=computed_live`), `downloaded` (a Playwright download event, saved as `h-mission.json`), `fileNamedMissionJson`, `schemaValid` (`check_mission.py` against `contracts/bundle/mission.schema.json`), `originComputedLive`, `waypointsInRouteOrder` (waypoint `station`, else the nearest station within 150 m, = the route), `feasibleMatchesRunRecord` (`summary.feasible` = run record `feasibility.feasible`), `plannedLegsOnly` (all legs routed, in chain order), `missionIdRule` (README rule, `tests/test_mission_contract.py mission_id`), `sameAsResultFile` (= `results/{hash}/mission.json`), `noUncaught` |
| h-infeasible | The same export on an **infeasible** route (mock = b's S4, S1, S2, S7, S8; **real S4, S1, S2**: leg 3 S2 → pad, O2, 23.84 min short; `--export-infeasible`) | The criteria of h, with `runRecordAsExpected` = infeasible: the file still validates, every stop is a waypoint in order, `summary.feasible` is **false** like the run record, and `plannedLegsOnly`: only the first `legs_planned` legs are `routed` (pad → wp1 → …), no later leg is |
| i | **Official plan's export**: `#/plan/{official}` (else the console) → "Send to simulator"; then static first (API refused) | `exportControlShown`, `controlHasHook`, `controlOriginPrecomputed`, `downloaded`, `fileNamedMissionJson`, `schemaValid` (needs WP9c's schema: `origin` gains `precomputed`), `originPrecomputed`, `missionIdRule`, `noUncaught`. Static first is **reported, not judged** (`staticFirst.observed`: control shown, downloaded, valid, from `sim/official/mission.json`) |

### Results

WP8b fills this table on the real API. The mock runs a–g are WP8a's, on the UI described in the next
section; h, h-infeasible and i are WP8c's (section "Simulator export"). WP8c run2 re-ran a–g on
origin/design 471e975 + R7b #126 with `VITE_SIM_EXPORT=1` and the mock's `mission.json`: a, b, c, e, g
PASS, d SKIP, and **f now PASS** (the route panel hides offline on design: R5-A is resolved there).

| | Mock (WP8a run3 + run5) | Real (WP8b) | Key numbers (mock) |
|---|---|---|---|
| a | **PASS** | | first stage on the map 5.3 s, result 22.7 s after Compute (stage 4 s); picking three stations 2.2 s; stages nominal → bands → partner → route → summary; legs pad→S4→S1→S2→pad |
| b | **PASS** | | "Leg 5: S7 → S8 · Limit: EVA length (D28) · Short by 30.0 min"; leg row 4 `failing`, 5 `not-planned`; route file has the 4 planned legs |
| c | **PASS** | | 422 `route_station_unknown`, stop 1 → "Stop 2 (S1): not a station of this site", 0.3 s; no job |
| d | SKIP (WP6) | | |
| e | **PASS** | | permalink 0.8 s; save, reload, rename, open and delete all work; the export (403 B) carries `route` (ordered S4, S1, S2); import gives the same hash in 0.2 s |
| f | **FAIL** (one criterion) | | static headline 23 % unchanged; offline banner after 0.2 s; **the route panel stays visible with 11 controls (2 enabled), Compute disabled** (finding R5-A) |
| g | **PASS** | | "Precomputed · official plan", 23 / 15.2 / 28.7 %, the same as the static console |
| h | **FAIL** (WP8c run1, run2: design before S1, see "Simulator export") | | control found only on `#/plan/{hash}` (A5s link `.live-sim-file`, no `data-sim-export`); click → **no download**: Chrome ignored `download` on the cross-origin link and opened the JSON in the tab. The file itself (fetched for the record) is schema-valid, `computed_live`, waypoints S4, S1, S2, feasible = run record, `mission_id` by the rule, = the result file |
| h-infeasible | (WP8c run3) | | |
| i | **FAIL** (WP8c run1, run2: design before S1) | | no control on `#/plan/{official}` or the console: the official manifest has no `sim_plan` entry (WP9c leaves it untouched), the S1 path is not there yet. Static first: no control (reported, not judged) |

## UI under test (mock run)

Evidence: `/tmp/hl-way/wp8a/run3/` and `/tmp/hl-way/wp8a/run5/` (screenshots and `route-e2e-result.json`), and
`/tmp/hl-way/wp8a-run{3,5}.log`.


- Scratch worktree `/tmp/hl-way/wt/wp8a-ui`: the PR heads, R5 #110 (ws18-direct-edit-R5 **63a0448**) merged
  with R7 #116 (ws15-design-system-R7 **b85e2e7**). The merge is clean. It is not pushed.
- run3 used R5 9a6b9db and run5 used 63a0448, which changes only CSS. Both give the same verdicts, and the
  key numbers in the table come from both runs.
- WP1 #117 (`traverse._route_order`) checked: its feasibility shape is the one the mock and the criteria
  use (`leg` 0-based, `legs_planned` = leg, `shortfall_min` rounded to 2 decimals; the panel shows 1).
- Selectors come from R5's `web/src/edit/route/panel.tsx` and `text.ts`, and from R7's
  `web/src/live/plans/view.tsx` and `planview.tsx` (`S` in the driver).
- The real-mode code path (Vite proxy) was smoke-tested against a second mock on 8151:
  - f, a, c and g ran.
  - a failed only on `panelHashEqualsJobHash`, as expected, because the mock hash is not D57.

## Findings (mock run)

- **R5-A (f, static first):**
  - What happens: with the API unreachable, the Edit-route panel (rail section "Stations and route")
    stays visible. Mode buttons, checkboxes, undo/redo and a disabled "Compute plan" show, with
    "Computing a route needs live planning. Live planning is offline · showing precomputed plans".
  - F23 and kit rule 4 say live controls hide behind the offline banner. R5's 9a6b9db chose to
    degrade in place instead.
  - Decision needed (team lead / D): hide the section when offline, or accept a disabled panel and
    relax criterion `noRouteControlsShown`.
- **R5-B (warning):**
  - What happens: following the panel's provenance link logs
    `edit route: static plan not restored: TypeError: Cannot read properties of undefined (reading 'setData')`
    (`restoreStatic` → `ConsoleMap.setScenarioData` on a map that is being torn down).
  - It is harmless for the user: a console warning, no uncaught error.
- **R5-C (demo):** the result box (infeasible message, provenance link) sits below the fold of the rail
  at 1900×1000. The presenter must scroll the rail. The EVA-time dock keeps showing the official
  plan's timeline (S7 S6 S1 S4) while a route result is on the map.
- **Mock-only:** the permalink of a mock route result shows the official headline (23 %), because the
  mock serves the static tree. Real results have their own numbers.

## Simulator export (WP8c, D110): UI under test, findings, requests

Team lead 12:20: the export to the simulator is the main feature; h is part of gate W2. Builders
(`/tmp/hl-way/interfaces.md` "Simulator export"): WP9b writes `mission.json` into every live result
tree (manifest kind `sim_plan`), WP9c writes `web/public/sim/official/mission.json` (origin
`precomputed`, schema enum extended), design package **S1** (branch `ws15-design-system-S1`) builds
the control: `data-sim-export` on it, `data-origin` = `computed_live` | `precomputed`; a live result
downloads its `sim_plan` file; the official plan uses `/api/v1/results/{official}/mission.json` when
the API answers, else `sim/official/mission.json`; a 404 shows "Simulator file not available for this
plan". The flag comes from a live-demo npm script (`VITE_SIM_EXPORT=1`); `serve-web.mjs` sets it.

UI under test, run1 (h, i) and run2 (a–i) (`/tmp/hl-way/wp8c/run{1,2}`, logs `/tmp/hl-way/wp8c-run{1,2}.log`): scratch worktree
`/tmp/hl-way/wt/wp8c-ui` = origin/design (471e975) + R7b #126 (56dfcfc, fast-forward), not pushed.
No open design PR had the S1 change yet, so this is the A5s slot: a plain `<a class="live-sim-file"
href=… download>` on `#/plan/{hash}`, listing `sim_plan` manifest files, and the console route card
slot (`.hl-simslot__file`, static manifest: never shown).

Findings:
- **SIM-1 (h, blocks the demo): `<a download>` does not download across origins.** The web
  (5173 in the demo, 4230 here) and the API (8012, 8170 here) are different origins, so Chrome ignores
  the `download` attribute and navigates the tab to the JSON (`urlAfter` =
  `…/api/v1/results/{hash}/mission.json`). S1 should fetch the file and save it through a `Blob`
  object URL (same-origin), or WP9b's route should answer `Content-Disposition: attachment;
  filename=mission.json`. The mock does neither on purpose, so h catches it. In real mode through the
  harness's same-origin proxy the link would download: run real mode with `--web http://localhost:5173`
  to test the demo's cross-origin path.
- **SIM-2 (h):** before S1 the control is not on the route panel after Compute; the presenter has to
  open the provenance/plan page. h looks on the panel first (5 s), then on `#/plan/{hash}`, and reports
  `where`.
- **SIM-3 (i):** before S1 the official plan has no control at all (its manifest has no `sim_plan`
  entry, by design of WP9c). S1's official path is required for i.
- **SIM-4 (i, schema):** the precomputed mission validates only against WP9c's schema (origin enum gains
  `precomputed`). Until WP9c merges, i's `schemaValid` fails on that one error; use
  `--mission-schema <wp9c checkout>/contracts/bundle/mission.schema.json` to check ahead.
- **SIM-5 (mission_id rule, for WP9b):** the README rule hashes `JSON.stringify` output; a Python
  builder must produce the same text (`json.dumps(…, separators=(",", ":"), ensure_ascii=False)`, as
  the contract test does) and avoid floats that print differently (`10.0` vs `10`, `1e-05` vs `1e-5`).
  h checks the id with the test helper on the downloaded bytes.

Selector requests (S1): `data-sim-export` on the control and `data-origin` (as announced); also, please,
`data-state` on it (`idle` | `downloading` | `done` | `unavailable`) so the 404 case is readable without
the text, and the control on the route panel's result box (`.hl-route__result`), not only on
`#/plan/{hash}`, for the demo beat below.

## Selector requests

These were not edited in their files; they are requests to the owners.
- **R5 (#110):**
  1. A readable hook for the failing-leg highlight on the map, e.g. `data-failing-leg="{leg}"` on the
     map container, or a `.hl-route__maplegend` text. Today it is only a MapLibre layer
     (`hl-route-failing-leg`), which a browser test cannot read.
  2. `data-state` on `.hl-route` (idle/running/done/failed/cancelled). The driver infers the state from
     child elements.
  3. `data-hash` on `.hl-route__result`.
- **R7:** `data-saved="true"` on `.live-plan-save` (today the "Saved in this browser." caption text).
- **WP6 (TODO selectors in the driver; d is skipped until they exist):**
  - `[data-route-action="add-point"]`
  - `.hl-route__stop[data-point="W{n}"]` (list row) with `[data-validity]`
  - `.hl-route-marker[data-point="W{n}"]` (draggable marker)
  - `input[name="label"]` in the row (rename)
  - `[data-route-action="delete-point"]`
  - `[data-route-ghost]` (ghost route summary, labelled "estimate")

## Demo script: "edit the route" in 60–90 s (capture 17:00–19:00)

Setup:
- `make serve` on 127.0.0.1:8012 and `cd web && VITE_LIVE=1 npm run dev` (http://localhost:5173).
- Window 1900×1000. Plan mode, `#/`.
- **Warm the cache first:** run both routes once before recording, e.g. with this harness in real mode.
  The recorded jobs then attach at once instead of taking about 6 min each.
  Use the same orders, because the result hash covers the order.

| t (s) | Click / action | Say |
|---|---|---|
| 0 | Plan mode, official plan on screen (23 %) | "This is the official plan: the engine chose the stations and their order." |
| 5 | Rail → **Stations and route** → **My order** | "Now I choose the stops and the order myself." |
| 10 | Check **S4**, then **S1**, then **S2** | "Sulfur field first, then the boxwork ridge, then the fracture network. The legs list shows pad → S4 → S1 → S2 → pad, exactly in my order." |
| 20 | **Compute plan** | "One live job for exactly this route. Nothing gets reordered." |
| 22–35 | Staged result: "Nominal band and route · on the map", then the other layers | "The nominal band and route come first, and the other variants follow." (cached: all at once) |
| 35 | Scroll the rail to the result: "Computed live · your route · Provenance {hash}" | "It is labelled as computed live, and it is not the validated scorecard. Provenance has the engine version and every stage." |
| 45 | Also check **S7** and **S8** (order S4, S1, S2, S7, S8), **Compute plan** | "Let's be greedy: two more stations." |
| 55–70 | Scroll to **"This order does not work"** | Read it out: "**Leg 5: S7 → S8 · Limit: EVA length (D28) · Short by 30.0 min**" (mock text; WP8b puts the real leg, limit and minutes here). "The failing leg is marked in red in the list and on the map. The engine did not reorder my stops. It tells me where my order breaks and by how much." |
| 75 | Uncheck **S8** (or drag S7 above S2), Compute again | "Change the order or drop a station, then compute again." |
| 85 | (optional) Open the provenance link → **Save to My plans** | "Saved in this browser only. The permalink and the exported plan_inputs.json carry the route." |

### Beat: "export to the simulator" (15–20 s, on the feasible route S4, S1, S6, S7)

On real data S4, S1, S2 is infeasible (leg 3 S2 → pad, O2), so the export beat uses **S4, S1, S6, S7**,
which is feasible: the file then carries a complete plan. Warm its cache with h in real mode before
recording.

Setup: the dev server with the simulator flag (S1's live-demo npm script, or `VITE_SIM_EXPORT=1
VITE_LIVE=1 npm run dev`); the simulator (Unity) open next to the browser with "Load mission" ready.

| t (s) | Click / action | Say |
|---|---|---|
| 0 | **My order** → check **S4**, **S1**, **S6**, **S7** → **Compute plan** (cached: done at once) | "A route the crew can actually walk: four stations, in my order." |
| 5 | On the result: **Send to simulator** (`[data-sim-export]`, label "Computed live") | "This route goes to the simulator as one file, mission.json." |
| 8 | The download lands (`mission.json`, about 5 kB on the mock) | "Waypoints S4, S1, S6, S7 in my order, the legs, the planned timeline and the margins, in the pad frame the simulator uses." |
| 12 | Simulator → **Load mission** → pick the file | "The simulator walks exactly this plan and compares the live walk with it: time, oxygen and position." |
| 15–20 | (optional) Official plan → **Send to simulator** | "The official plan exports the same way, labelled precomputed; it also works with live planning offline." (only if i's static-first check showed it) |

Fallback if the API is down during the capture: the static app is unchanged (scenario f, 23 %). Say
"live planning is offline; the precomputed plan stays". Do not show the panel, because of R5-A.
