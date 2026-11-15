# Custom pad end to end on the demo configuration (H5, gate B1′)

Gate B1′: "custom pad end to end: validate, preview, full plan on the map; permalinks; all on localhost".
This is the real demo setup: `make serve` on 127.0.0.1:8012 and `VITE_LIVE=1 npm run dev` on
http://localhost:5173. That origin is in `api.cors_origins`, so the browser runs with web security on.

## Result: PARTIAL. Steps 1–3, 5 and 6 pass. Step 4 fails one criterion: the map shows nothing live until the job is complete.

| Step | What | Result | Key numbers |
|---|---|---|---|
| 1 | Load `#/`: live state ready, pad tool visible, static numbers unchanged | **PASS** | ready + pad tool + 23 % after 0.8–2.4 s; no offline banner |
| 2 | Invalid spot at the north edge: reason + nearest valid block | **PASS** | `disc_off_grid`, nearest valid block 360.6 m away, shown 7 ms after the pad position |
| 3 | Valid pad: instant preview flagged as estimates | **PASS** | preview card 54–71 ms after the click; 14/14 numbers flagged as estimates (`num-screen`) |
| 4 | Compute full plan: stages in order, nominal band + route on the map first, done, label + provenance, no uncaught errors | **FAIL** (one criterion) | done in 374.5 s (timeout 600 s); stages in order; label + provenance link present; 0 uncaught errors; **no band, route or headline before the job is complete (finding H5-1)** |
| 5 | Permalink in a fresh page; provenance; export + re-import | **PASS** | renders in 469 ms with 8 manifest-backed numbers and 0 withheld; origin `computed_live` with stage timings; re-import → same hash, opened in 99 ms (`computed: true`) |
| 6 | Official permalink | **PASS** | "Precomputed · official plan"; 23 % / 15.2 % / 28.7 % / 60-min 31.5 % (16.2–43.8 %), the same numbers as the static console |
| 7 | Crew job (+20 kg tools) | **crew: pending U4** | U4 (the crew panel) was not on origin/main at 02:10 (head 9874f4c) |

Peak memory of the API process tree (RSS summed, sampled every 1 s):
- During the step-4 job: **2.43 GiB** (2,550,112 KiB). The job worker peaked at **1.90 GiB** and the API server process at 0.44 GiB.
- During the second job (the rank-4 probe below): 2.47 GiB, with the job worker at 1.93 GiB.
- The server process alone peaked at 0.73 GiB at 02:01:26. That was the first `/pads/validate`, which loads the
  D21 siting world; it then settled at about 0.45 GiB.
- The idle tree used 0.42 GiB.

## Setup

- Date: 2026-11-15, 01:58–02:25 local (CET). Worktree `hardening-h5` at origin/main e75cb3d.
- `/engine/version` reported commit `e75cb3d6…` = HEAD, engine_tree `49418a22…`, terrain `sha256:67fe3ced…`.
- Official hash at this HEAD: `c51b1b82b5269ce6` (`server.engine.hashing.official_hash()`).
- `ss -ltn | grep 8012` returned nothing before the start. Port 5173 was free too.
- Environment: `uv sync --frozen`, `cd web && npm ci`, and a gitignored `data -> ~/hl-data` symlink. The plan job reads
  `data/interim/conditions` (E8 note), as E6, E8 and E10 did.
- Browser: Playwright 1.65.1 from `~/coding/hl-h2/web/node_modules` (not a dependency of this repo) driving the
  system Chromium 157 headless, viewport 1900×1000, with **web security on**.

```
make serve HL_SERVER_DATA=/home/vincent/hl-data/server         # 127.0.0.1:8012 (uvicorn --reload)
cd web && VITE_LIVE=1 npm run dev                               # http://localhost:5173
memsample.sh <uvicorn reloader pid> /tmp/hl-orch/h5/mem.tsv     # RSS of the process tree, every 1 s
OUT=/tmp/hl-orch/h5/run3 node docs/hardening/e2e-drive.mjs http://localhost:5173   # the full job (fresh hash)
OUT=/tmp/hl-orch/h5/run4 node docs/hardening/e2e-drive.mjs http://localhost:5173   # rerun, same pad: cached
```
`memsample.sh` (scratch) walks `pgrep -P` from the reloader pid and sums `VmRSS`. The tree is the reloader,
the multiprocessing resource tracker, the server process and two spawned job workers.

Two runs carry the result:
- **run3** submitted the job for the custom pad, a fresh hash. It is the source for step 4 and its timings.
  The driver crashed after step 4 on a bug in its own network-log filter (fixed in the committed script), so
  steps 5–6 come from run4.
- **run4** ran the committed script end to end, with all six steps passing in its own terms. The same pad has the same hash,
  so its step 4 attached to the cached result: all stages arrived together after 0.7 s, which is why step 4
  passes there. Steps 1–3 and 5–6 of run4 are the reported results.

Evidence (screenshots, `e2e-result.json` with the network log and every job poll, and `plan_inputs.json`):
`/tmp/hl-orch/h5/run3/` and `/tmp/hl-orch/h5/run4/`. Logs: `/tmp/hl-orch/h5/{api,vite,run3,run4}.log`, `mem.tsv`,
`probe-rank4.log`.

## The pad

- **Invalid spot (step 2):** 137.401783, −4.771407, E8's pad near the north edge. The driver clicked 137.401747, −4.771397.
- **Custom pad (steps 3–5):** **rank 3, 137.393301, −4.776114**, a D21 block 40 m north of rank 2 in the same cluster.
  Rank 2's own location (137.393301, −4.776468) is covered by its `#2` HTML marker, so a click there never reaches the map.
  The driver therefore clicks an invalid slope spot about 100 m north of the cluster (137.393277, −4.774482).
  The pad tool offers "Nearest valid block: 137.393301°E −4.776114°N, 96.7 m away", and the driver takes it.
  The task allowed this ("or use the nearest valid block").
- **Plan hash:** `2e1344b6e489d6a1`, job `j_8d066e70665f5ac6`.

## Step details

### 1. Load — PASS
- `.live-status` reached `data-state=ready` and stayed hidden. The pad tool ("Live pad · Computed live · not part of the
  validated scorecard · provenance: engine version · Click the map to try a pad location.") was visible.
- The console headline was unchanged: "23% reachable of the assessed flat disc within 30 min. Range 15.2% (conservative) to
  28.7% (optimistic) … Within 60 min: 31.5% (16.2% to 43.8%)".
- Timings: 790 ms in run4 and 2.4 s in run3 (cold vite transform), measured from navigation.
- Screenshot: `run4/step1-console-ready.png`.

### 2. Invalid spot — PASS
- "The flat 30-min disc around this pad leaves the terrain grid (the flat 30-min disc (1764 m) around the pad leaves the
  routing grid)", `data-reason=disc_off_grid`.
- "Nearest valid block: 137.401783°E −4.777480°N, 360.6 m away", with the button "Use the nearest valid block". That block is the official pad.
- The reason appeared 7 ms after the pad position updated. Every `POST /pads/validate` answered in 3–6 ms.
- Screenshot: `run4/step2-invalid-pad.png`.

### 3. Valid pad, instant preview — PASS
- After "Use the nearest valid block": "Valid pad (D21 rule)" and the "Instant preview" card. The card appeared 54 ms
  (run4) or 71 ms (run3) after the click, well inside the 2 s target. `POST /pads/screen` took 63 ms.
- Card: feasible EVAs 51; S1/S2/S4/S6/S7/S8 all reachable; best route estimate pad → S6 → S1 → S2 → S8 → pad, 388.92 min.
- All 14 numbers carry `num-screen`, with the tooltip "instant preview (POST /pads/screen, station fields): an
  estimate with no manifest entry; compute the full plan for manifest-backed numbers". The card is also labelled "Computed live · not part of the validated scorecard".
- Screenshots: `run4/step3a-invalid-near-rank2.png`, `run4/step3-preview.png`.

### 4. Full plan — FAIL (map content only at the end)
- Job timings (run3), from the UI's polls of `GET /jobs/{id}` (one about every 5 s) and the run record:

| Stage | Seconds (run record) | Seen done in the UI (s after "Compute full plan") |
|---|---|---|
| nominal | 131.50 | 135.8 |
| bands | 198.45 | 331.2 |
| partner | 19.30 | 350.9 |
| route | 25.17 | 375.8 |
| summary | 0.05 | 375.8 |
| **total** | **374.48** | **376.5** (`done`) |

- A second job on rank 4 (137.387206, −4.781529, hash `aed58d507a7a7f53`, submitted with `probe_tree.py` through the API, not
  the UI) took nominal 111.11, bands 213.44, partner 19.76, route 25.73 and summary 0.06 s, **370.1 s** in total.
- Submit: `POST /jobs` returned 202 in 13 ms. The job was queued for under 1 s.
- The total is under the 600 s timeout, with 1.6× headroom. E8 measured 332 s for its pad and E10 386.6 s for a crew job.
- Passes:
  - The stages arrived in order: nominal → bands → partner → route → summary.
  - The panel showed "Running stage …" with a progress bar and Cancel, then "All stages done.".
  - The label read "Computed live · not part of the validated scorecard · provenance of plan 2e1344b6e489d6a1", linking to `#/plan/2e1344b6e489d6a1`.
  - When done, the headline read "Reachable within a 30-min walk home (nom_104): 21.2% (range 16.2% to 30.1%)".
  - 0 uncaught errors. There were 0 contract errors (`.live-errors`) when the same tree was reloaded in run4.
  - The only `console.error` entries are "Failed to load resource: 404", explained below.
- **Fail: the nominal band and route did not appear first (finding H5-1).** After each of the stages nominal, bands
  and partner, the pad tool fetched only `scenarios/index.json` and `manifest.json`, and both returned **404**.
  These are the six 404 console errors. It fetched nothing else, and the panel said "No scenario index yet." for
  6 minutes. The first band, route, isochrone, edge or partner fetch happened at 375.8 s, when the job was complete:

```
146.41 s 404 /results/2e1344b6e489d6a1/scenarios/index.json     (after nominal)
146.41 s 404 /results/2e1344b6e489d6a1/manifest.json
341.51 s 404 …/manifest.json, …/scenarios/index.json             (after bands)
361.52 s 404 …/manifest.json, …/scenarios/index.json             (after partner)
386.53 s 200 …/scenarios/index.json, manifest.json, route_nom_104.geojson, scenarios/bands_104.geojson,
             scenarios/nom_104/{isochrones,edges,partner}.geojson   (done)
```
  (The times are on the driver's clock: the click was at 10.8 s.)
- Screenshots: `run3/step4-stage1-nominal.png`, `run3/step4-stage2-bands.png`, `run3/step4-stage3-partner.png`,
  `run3/step4-stage5-summary.png`, `run3/fatal.png` (done; taken by the driver's error handler) and
  `run4/step4-done-zoomed-out.png`.

### 5. Permalink, provenance, export / re-import — PASS (run4)
- **Fresh page** `http://localhost:5173/#/plan/2e1344b6e489d6a1`:
  - Rendered in 469 ms.
  - Label: "Computed live · not part of the validated scorecard · provenance of plan 2e1344b6e489d6a1" (`data-origin=computed_live`).
  - Headline: 21.2 % within 30 min, range 16.2 % to 30.1 %, within 60 min 22.6 % (11.9 % to 38.7 %).
  - Route: Pad → S7 → S6 → S1 → S4 → Pad, total 326.49 min, tightest margin 47.29 min (radiation dose, leave S1).
  - 8 numbers are manifest-backed (`num-live`) and 0 are withheld.
  - Cross-check: `reachable_pct.nom_104.30` is in the result's manifest.json, and `scenarios/index.json` gives 21.2,
    which equals the number shown.
- **Provenance** (`#/plan/…/provenance`):
  - Origin `computed_live`, status done.
  - Engine tree 49418a22…, commit e75cb3d6…, config hash, terrain hash, contracts web 1.1.5 · backend 1.1.0 · run record 1.1.0.
  - 20 files, each with sha256 and contract.
  - Stage table: nominal 131.502, bands 198.45, partner 19.302, route 25.173, summary 0.05 s, with UTC start times
    01:05:07–01:11:21Z. `range_flags []`, error null.
- **Export / re-import:**
  - "Export plan_inputs.json" is a 661-byte canonical JSON file: default inputs, pad 137.393301, −4.776114.
  - Importing it on `#/plan` sent `POST /plans/import` → 200 `{"hash":"2e1344b6e489d6a1", …, "computed": true}`, the same hash.
  - The app opened `#/plan/2e1344b6e489d6a1` 99 ms after the file was set, from cache. No job was started.
- Screenshots: `run4/step5-permalink.png`, `run4/step5-provenance.png`, `run4/step5-reimport.png`.

### 6. Official permalink — PASS (run4)
- `#/plan/c51b1b82b5269ce6` in a fresh page: "Precomputed · official plan · provenance of plan c51b1b82b5269ce6", `data-origin=precomputed`.
- Headline: "23% … within 30 min. Range 15.2% (conservative) to 28.7% (optimistic) Within 60 min: 31.5% (16.2% to 43.8%)".
  These are the same numbers as the static console in step 1. 0 numbers are withheld. Time to the precomputed label: 2.1 s.
  H2's cosmetic finding 3 still applies: the label briefly reads "Computed live" while the page loads.
- Screenshot: `run4/step6-official.png`.

### 7. Crew job — crew: pending U4
U4 was not merged: origin/main was at 9874f4c (H2) at 02:10, and only E10's server side (#61) is on main. No crew job was run.
E10 measured a crew job (+20 kg tools, official pad) via the API: 386.6 s.

## Findings

**H5-1 (blocks "nominal band and route on the map first"; for the WS13/U2 and WS11/E8 owners).** The staged
results exist on the server, but the client cannot find them before the job ends.
- `web/src/live/stage.ts` `loadStage` reads `scenarios/index.json` first and finds every map file through
  `index.scenarios[…].files`. Without an index it tries nothing else.
- E8's plan job (`server/engine/plan_job.py`) writes `scenarios/index.json` and `manifest.json` only in the summary stage
  ("summary writes scenarios/index.json + manifest.json once").
- Result: on the real server, a custom-pad job shows no live map content and no headline for about 6 minutes, and then everything at once.
- The probe below confirms that the server *does* serve the nominal route and band right after the nominal stage
  (`probe-rank4.log`, a second job on rank 4).

```
probe_tree.py (POST /jobs for rank 4 = 137.387206, -4.781529, then GET of each file at every stage change)
    0.0s submit 202 j_98e82c3cba5f5e79 hash aed58d507a7a7f53
  112.1s stage bands, done ['nominal']: route_nom_104.geojson 200, scenarios/bands_104.geojson 200,
         scenarios/nom_104/{isochrones,edges,partner}.geojson 200, scenarios/index.json 404, manifest.json 404
```

- U2's mock (`mock/result.ts`) grows the manifest and index per stage, which is why the unit tests pass.
- Possible fixes, for the owners to choose (none applied here):
  - the job writes a partial index and manifest after each stage;
  - or `loadStage` falls back to the default scenario's conventional paths when the index is missing (which would draw files the manifest does not cover yet, so U2's rule 4 needs a decision).

**H5-2 (cosmetic, WS5/WS13).** The live aside's width follows its content, so the console map resizes when the
pad tool's text changes. At 1900 px the map was 1015 px wide with no pad or a valid pad, and 605 px wide while an
"invalid" reason was shown. Each resize moves the map under the cursor. The driver re-anchors after every click for that reason.

**H5-3 (cosmetic).** The D21 rank markers (`#2`, `#3`, `Pad`) are HTML elements that swallow map clicks, so a
presenter cannot click exactly on rank 2 or 3. Clicking next to a marker and using "Use the nearest valid block" works.

**H5-4 (info).** The first load logs one "Failed to load resource: 404" from the vite dev server (not an API call;
`/favicon.ico` returns 404 there). It is harmless.

**H5-5 (info, for the VM sizing).** One custom-pad job took the API process tree from 0.42 to 2.43 GiB. The job worker alone
peaked at 1.90 GiB. Two concurrent jobs would need about 4.4 GiB.

**H5-6 (info, static console; for the WS5/static-data owner, unverified).** During the first driver attempt
(run1, 02:03:14), the driver's map clicks went through to the static "Rover parking options" list and selected
"#3 rank 3". The vite log then shows 17 browser warnings `[provenance] mismatch: … from
scenarios/pads/rank3/{route_nom_104.geojson,timeline_nom_104.json} pads.rank3.route.leg.{1,5}.{t_min,length_m,o2_L},
pads.rank3.route.total_min, pads.rank3.timeline.K.{t_min,margin_min}`. This looks like the static rank-3 pad files
disagreeing with web/public/data/manifest.json. It has nothing to do with the live layer, and I did not investigate further.

## Re-running

1. Run `make serve …` and `VITE_LIVE=1 npm run dev` as above.
2. Run `node docs/hardening/e2e-drive.mjs http://localhost:5173` (env: `PW`, `CHROMIUM`, `OUT`, `API`, `OFFICIAL_HASH`, `PAD_CLICK`, `BAD`,
   `JOB_WAIT_S`; see the header of the script).
3. A pad whose hash is already cached attaches instantly. To time a full job again, use a pad that has not been computed yet
   (set `PAD_CLICK` to a spot whose nearest valid block is new), or clear that result from `$HL_SERVER_DATA/results/`.

The driver clicks map positions without any app hook. It clicks, reads the pad position the tool reports and
corrects the offset, with the scale taken from vertical clicks and Web Mercator. It re-measures the clickable area
before each click and refuses to click a spot covered by an HTML marker.
