# Live planner on the published site: section 10.7 checks (WP11, D115)

Spec: Notion "Planning UI — declutter and usability plan", section 10.7. D115 (team lead): the live
layer stays ON in the Pages build (`pages.yml`: `VITE_LIVE: "1"`, `VITE_API_BASE: ${{ vars.HL_API_URL }}`
= `https://homeline-api.vxliu.com`, since #108). This page records the five checks against the
published site and the hosted API.

| What | Value |
|---|---|
| Site | `https://homeline.vxliu.com` (GitHub Pages, custom domain; `https://luxkaiwalker.github.io/home-line/` → 301 there). Pages run for `d6213dc` (2026-11-15 11:20 UTC), bundle `assets/index-DnhzRjl6.js`, live chunk `assets/live-DnjvI478.js` |
| API | `https://homeline-api.vxliu.com/api/v1` (Cloudflare tunnel → nginx 127.0.0.1:8080 → uvicorn 127.0.0.1:8002, `homeline-backend` from `~/coding/hl-prod`, clean detached tree at `b84cdd1`) |
| Engine identity | `/engine/version`: commit `b84cdd1f…`, engine tree `7776b4f…` (= the tree at `d6213dc`, a docs-only commit), backend contract 1.2.0 |
| Official hash (prod identity) | `016355600dbe194c` (`GET /results/016355600dbe194c/provenance` → origin `precomputed`) |
| Who ran it | WP11 agent, 2026-11-15 from 12:41 CET. Checks 1–3: read-only plus a few cheap requests, no heavy job on prod. Checks 4–5: scripts ready, run after the orchestrator's "go" (W2) |

## Results

| # | Check (section 10.7) | Result | Evidence |
|---|---|---|---|
| 1 | Hosted API over HTTPS on a stable URL, no mixed content; `VITE_API_BASE` set for the Pages build; CORS allows `https://homeline.vxliu.com` and `https://luxkaiwalker.github.io` | **PASS** (one note: plain HTTP also answers, see N1) | [Check 1](#check-1-https-api-base-cors) |
| 2 | Abuse protection on: per-IP rate limits, heavy-job queue, kill switch, job timeout, max 4 free points; ONE heavy job at a time per visitor; queue position shown in the UI | **PARTIAL**: rate limit, queue cap, kill switch, timeout and the 4-free-point cap are on. **Not met on prod: one heavy job at a time per visitor** (F1, server fix in this PR) and **the queue position is not shown in the UI** (F2, web ticket) | [Check 2](#check-2-abuse-protection) |
| 3 | Privacy note on /about live (D86): access logs deleted after judging; /api/docs names cdn.jsdelivr.net | **PASS** (notes N2, N3) | [Check 3](#check-3-privacy) |
| 4 | Health and fallback drill on the published site: API killed → offline banner within 3 s, static app fully usable; restart → live controls return without reload | **PENDING** (after W2; needs the hosting session, steps below). Smoke run with the API up: PASS | [Check 4](#check-4-fallback-drill-on-the-published-site) |
| 5 | Load check against the hosted API (10 parallel guests, as H1) | **PENDING** (after W2) | [Check 5](#check-5-load-check-against-the-hosted-api) |

## Findings

| ID | Severity | Finding | Owner / action |
|---|---|---|---|
| F1 | **fix soon** (a section 10.7 item not met on prod; the rate limit, the queue cap and the kill switch bound the damage, so not a reason to turn the live layer off) | The server has no per-address **concurrency** limit, only a rate (`limits.guest_heavy_jobs` 6 / 10 min). One visitor can start 6 distinct heavy jobs at once: both workers (`compute.workers` 2) plus 4 queue places, each up to `compute.job_timeout_s` 600 s, so everyone else waits behind them | Fixed in this PR: `limits.guest_concurrent_heavy_jobs: 1` (assumed), 429 `job_in_progress` + `retry_after_s`. Needs merge, then a deploy by the hosting session (`deploy.sh`) |
| F2 | **fix soon** (a section 10.7 item) | The UI does not show the queue position. `job.queue_position` is in the job body (`web/src/live/types.ts`) but no view reads it: the pad tool shows only "Queued" (`web/src/live/view.tsx:144`), the plan page " · queued" (`web/src/live/planview.tsx:250`). Note: the server's `queue_position` is 0-based (`JobRunner._view`: index in the waiting deque), so the UI should show `queue_position + 1` ("2nd in line") | Web ticket for the orchestrator's list (not edited here) |
| N1 | note | `http://homeline-api.vxliu.com/api/v1/health` answers 200 over plain HTTP (Cloudflare does not redirect). The site never uses it (the bundle has only the `https://` base), so there is no mixed content; turning on Cloudflare "Always Use HTTPS" for the host would close it | Hosting |
| N2 | note | The privacy note says the live server's "standard access logs list client addresses and are deleted after judging ends". On prod the requests also pass Cloudflare (tunnel) and the site is served by GitHub Pages; both see visitor addresses and are not covered by "deleted after judging". The note's source comment (`web/src/live/privacy.tsx`) names uvicorn and Caddy logs; prod has nginx + uvicorn in journald, no Caddy | Team lead (D86 wording); web if the text changes |
| N3 | note | `/api/docs` loads `swagger-ui-dist@5` (a floating major) from cdn.jsdelivr.net without SRI. Disclosed on /about (D86); a pinned version would make the third-party code fixed | Server, low priority |
| N4 | note | With F1's fix, the "visitor" is the client address (no accounts, D69). Visitors behind one NAT (a judging room on one Wi-Fi) share one heavy job at a time, as they already share the 6 / 10 min rate. Attaching to a running job and cached results are never refused | For the team lead to know |
| N5 | note | `job_in_progress` reaches the UI as "The plan failed: job_in_progress; try again in N s." (the generic 429 path in `web/src/live/view.tsx`). A friendlier text ("You already have a plan computing") belongs with F2 | Web ticket |

## Check 1: HTTPS, API base, CORS

```sh
curl -sI https://homeline.vxliu.com                     # HTTP/2 200, server GitHub.com, last-modified Sun, 15 Nov 2026 11:21:20 GMT
curl -sI https://luxkaiwalker.github.io/home-line/      # 301 → https://homeline.vxliu.com/
# all JS/CSS chunks reachable from index.html (98 files), crawled into a scratch dir:
grep -l homeline-api.vxliu.com assets/*                 # assets/live-DnjvI478.js only
grep -o 'https\?://homeline-api[^"`]*' assets/*        # https://homeline-api.vxliu.com (once)
grep -oh 'http://[a-zA-Z0-9.:/_-]*' assets/* | sort | uniq -c
#   w3.org namespaces (svg, xhtml, MathML), http://localhost:8012 (the apiBaseFrom fallback, unused
#   because VITE_API_BASE is set), http://localhost:5173 (the cors_origins list inside the bundled
#   backend.yaml). No http:// API URL.
```
The live chunk reads `ae("https://homeline-api.vxliu.com")`, i.e. `apiBaseFrom(import.meta.env.VITE_API_BASE)`
with the variable set; `HL_API_URL` = `https://homeline-api.vxliu.com` (`gh variable list`).

```sh
A=https://homeline-api.vxliu.com/api/v1
curl -s $A/health           # {"ok":true,"engine_warm":true,"queue_length":0,"heavy_jobs":"on"}  200 in 0.20 s
curl -s $A/engine/version   # commit b84cdd1f144bc3894d61748c190a72d369cdb455, engine_tree 7776b4f…, backend 1.2.0
curl -sv $A/health -o /dev/null 2>&1 | grep -E 'subject|issuer|expire'   # TLS 1.3, CN=vxliu.com, Let's Encrypt, until 2027-02-05
```

CORS (preflight `OPTIONS /pads/validate`, `Access-Control-Request-Method: POST`, `-Headers: content-type`;
and a simple `GET /health` with `Origin`), 2026-11-15 12:41 CET:

| Origin | Preflight | `access-control-allow-origin` (preflight / GET) |
|---|---|---|
| `https://homeline.vxliu.com` | 200 | `https://homeline.vxliu.com` / same |
| `https://luxkaiwalker.github.io` | 200 | `https://luxkaiwalker.github.io` / same |
| `https://evil.example.com` | 400 | none / none |
| `http://homeline.vxliu.com` (plain-HTTP origin) | 400 | none / none |

Headers carry `vary: Origin`. One CORS source only (FastAPI, `config/backend.yaml api.cors_origins`); nginx
adds CORS only to its own error pages (`homeline.nix`, deployed copy identical to the repo copy).

## Check 2: abuse protection

Prod config (`~/coding/hl-prod/config/backend.yaml` at `b84cdd1`, read-only) = main's values.

| Protection | Where | Value on prod | How verified |
|---|---|---|---|
| Per-IP heavy-job rate | `server/api/auth/limits.py` `HeavyJobLimiter` (ASGI client host, salted hash) | `limits.guest_heavy_jobs` 6 / 10 min | Code + tests (H1 run 2 exercised it). The real client address reaches uvicorn: `CF-Connecting-IP` → nginx `real_ip_header` (from 127.0.0.1 only) → `X-Forwarded-For` overwritten → uvicorn `--proxy-headers --forwarded-allow-ips 127.0.0.1` (`homeline.nix`, deployed = repo). Not exercised on prod (it would take heavy jobs) |
| Coarse per-IP ceiling | nginx `limit_req` | 20 r/s, burst 40, 429 `{"error":"proxy"}` | `homeline.nix` |
| Heavy-job queue | `server/engine/jobs.py` `JobRunner.submit` | `compute.workers` 2, `compute.queue_max_waiting` 20 → 429 `queue_full` + Retry-After | Code + tests; `/health` `queue_length` 0 at 12:43 |
| Kill switch | `deploy.kill_switch_env` `HL_HEAVY_JOBS_OFF` (env, `/etc/homeline-backend.env`) and `POST /admin/heavy-jobs` (team token `X-HL-Team`, 403 without) | off: `/health` `"heavy_jobs":"on"` | `/health`; code. Not toggled (prod) |
| Job timeout | `JobRunner` supervisor, SIGKILL of the worker | `compute.job_timeout_s` 600 s | Code + tests |
| Max 4 free points | `server/engine/route.py` (`route.max_free_points` 4), checked before any job | 5 free points → 422 | Prod, 12:43:00 CET: an ordered route of 5 free points → **422** `{"error":"route_too_many_free_points","detail":"stop 4 (W5): a route has at most 4 free points (route.max_free_points); this one has 5","stop":4}`, with `access-control-allow-origin`. Validation only, no job (`/health` queue 0 after). The 4-point side was not sent to prod (a valid route could queue a heavy job) |
| **One heavy job at a time per visitor** | — | **not enforced on prod** | Code: the limiter counts starts in a window; nothing counts a visitor's queued or running jobs. → **F1**, fixed in this PR |
| **Queue position in the UI** | `web/src/live` | **not shown** | `grep -rn queue_position web/src` hits only `types.ts` (type and contract check). → **F2** |

### The F1 fix (this PR)

- `config/backend.yaml`: `limits.guest_concurrent_heavy_jobs: 1`, marked assumed (in `assumed:`).
- `server/settings.py`: the field (`int >= 1`).
- `server/api/auth/limits.py`: `ActiveJobs` (per salted address key: the ids of the new jobs it
  started; `alive` asks the runner, so a finished, failed or timed-out job frees the slot with no
  callback; reserve → confirm/release like the rate window, so a burst never passes). Checked
  **before** the rate window, so a refusal costs no rate quota. Refusal: **429**
  `{"error":"job_in_progress","detail":"at most 1 heavy job at a time from one address; yours is
  running; retry in N s","retry_after_s":N}` + `Retry-After: N` + `Cache-Control: no-store`, inside
  CORS (readable cross-origin). N = seconds until the visitor's running job reaches its
  `job_timeout_s` deadline, or a full `job_timeout_s` while it still waits for a worker. Attaches (also
  to the visitor's own job) and cached results pass, as for the rate (H1-2).
- `server/engine/jobs.py`: read-only `JobRunner.deadline_in(job_id)`.
- `server/app.py`: `create_app(cfg=…)` (default `settings()`), so tests can set the limits.
- Tests first: `server/tests/test_limits_concurrent.py` (13 known answers). The existing limit, job,
  admin and warm-up tests start several jobs at once from one test client to test other rules; their
  helpers now build the app with `test_jobs.app_cfg()` (concurrency raised to 1000), and only the new
  file runs the config value. `test_settings` known answer for the assumed list gains the key.

```sh
uv run --no-sync pytest -q server/tests/test_limits_concurrent.py          # 13 passed
uv run --no-sync pytest -q server/tests --deselect server/tests/test_pads_real.py   # 486 passed, 1 skipped (13:04 CET)
uv run --no-sync ruff check server/                                           # All checks passed
```
(`test_pads_real.py` reads the shared real server data; it is untouched by this change and was not run.)

The web client needs no change for the 429: it already shows `error` and `retry_after_s` (N5).

## Check 3: privacy

`https://homeline.vxliu.com/#/about`, rendered headless (Playwright 1.65.1 from an existing
`web/node_modules`, system Chromium), 12:43:38 CET: the live build mounts the note (`.live-privacy`) in
1.5 s, `data-state` ready, no page error, the only other origin contacted is `https://homeline-api.vxliu.com`.
Text:

> Privacy. There are no accounts or logins. The site sets no cookies and uses no browser storage. The
> live server keeps the plan inputs it computes (with their title) and the results, filed by a hash of
> the inputs, each with a run record: engine version, stages and timings. The least recently used
> results are removed when its cache is full. To limit how many computations one address can start, it
> keeps salted hashes of addresses, in memory only, cleared on restart. **Its standard access logs list
> client addresses and are deleted after judging ends.** Nothing is sold or shared. **The API
> documentation page (/api/docs) loads its script and styles from cdn.jsdelivr.net** and its icon from
> fastapi.tiangolo.com, so opening it contacts those third parties. The static site works without the
> live server.

The about page's lead also has the live sentence ("In this live build … the live tools send your
planning requests to the live server …").

`GET https://homeline-api.vxliu.com/api/docs` → 200; the page loads
`https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js`, `…/swagger-ui.css` and
`https://fastapi.tiangolo.com/img/favicon.png`, exactly what the note names. The docs page itself has no
visible notice (it is FastAPI's stock Swagger page); the disclosure is the /about note. See N2, N3.

With F1 merged, the note's sentence "To limit how many computations one address can start, it keeps
salted hashes of addresses, in memory only" still holds: `ActiveJobs` keys on the same salted hash.

## Check 4: fallback drill on the published site

Driver: `docs/hardening/published-drill.mjs` (H2's driver adapted). It never stops anything itself: a
watcher in the script polls the public `/health` every 200 ms (2 s timeout) and the page is timed against
the moment the API was seen down and up again. All in one document: the page `load` event must fire
exactly once (no reload).

Smoke run (API up, read-only), 12:55 CET: **PASS**. Console ready with live controls and 23 % in 1.1 s,
official permalink "Precomputed · official plan · provenance of plan 016355600dbe194c" in 0.8 s, #/trade,
#/scorecard, #/conditions, #/about render, 0 errors, 1 load.

```sh
PW=/home/vincent/coding/hl-h2/web/node_modules/playwright/index.mjs OUT=<dir>/drill-smoke.json \
  node docs/hardening/published-drill.mjs smoke
```

### Steps for the drill (orchestrator ↔ hosting session coding-30)

What the drill expects with the API stopped: Cloudflare and the tunnel stay up, nginx answers 502
`{"error":"proxy"}` (with CORS for allowed origins), the client counts any non-200 as `not-ok` → offline
on the next poll (`CLIENT.healthPollMs` 3 s). H2 measured 2.5–3.0 s for a refused connection; 3 s is the
poll interval, so the 3 s criterion is tight by design (worst case = one poll interval + the 502's round
trip). The script reports the exact figure.

1. **T−2 min (WP11):** start the driver; it prints `READY FOR STOP` once the published console is
   live (about 15 s):
   ```sh
   cd /tmp/hl-way/wt/wp11
   PW=/home/vincent/coding/hl-h2/web/node_modules/playwright/index.mjs OUT=<dir>/drill.json \
     node docs/hardening/published-drill.mjs drill 2>&1 | tee <dir>/drill.log
   ```
2. **T0 (hosting session):** stop the API, nothing else (nginx, tunnel, membase, chips untouched):
   `sudo systemctl stop homeline-backend`. Tell the orchestrator the time (hh:mm:ss).
3. **Hold it down for 90 s** (the driver times the banner, then checks #/trade, #/scorecard,
   #/conditions, #/about, #/ and the official permalink offline: about 15 s; the rest is margin).
4. **T0+90 s (hosting session):** start it again: `~/coding/homeline-host/deploy.sh --restart`
   (= `systemctl restart homeline-backend`, waits for local health, prints local + public health).
   Tell the orchestrator the time. The engine warm-up takes a few seconds; the driver waits up to 60 s
   for the live controls.
5. **WP11:** the driver ends by itself (`RESULT: PASS|FAIL`, about T0+2.5 min). Then
   `curl -s https://homeline-api.vxliu.com/api/v1/engine/version` must show the same commit as before.

Total outage about 90–100 s. During it, every visitor of the site sees the offline banner and the static
app (that is the behaviour under test). Do it with no live job running (`/health` `queue_length` 0 and no
judge demo in progress): a stop ends running jobs as errors.

## Check 5: load check against the hosted API

Driver: `docs/hardening/load_hosted.py` (imports H1's `load.py` guests). 10 guests, as H1: each polls
`/health` every 3 s and, with 1–4 s think times, GETs `/defaults`, `/engine/version`, the official
permalink files, POSTs `/pads/validate` and `/pads/screen`. Differences from H1, because this is the
public API on the shared machine:

- **no new heavy job, no kill-switch flip, no team token**: the only job traffic is the cached official
  plan (`POST /jobs` with the official inputs → 202 `done`, no worker, not counted), each guest every
  20–60 s;
- a short valid-pad setup (40 `/pads/validate` calls instead of H1's search);
- 300 s instead of 600 s;
- all ten guests share this machine's public address, so nginx's 20 r/s per-IP ceiling applies to all
  of them together; its 429s (`{"error":"proxy"}`) are counted apart and reported, not failed (ten real
  visitors have ten addresses).

PASS = no 5xx, no transport error, no app 429, every cached submit 202 done, `/health` p95 < 2 s
(`api.health_timeout_s`) with at most 0.5 % slow or failed polls.

```sh
cd /tmp/hl-way/wt/wp11
flock /tmp/hl-heavy.lock uv run --no-sync python docs/hardening/load_hosted.py --out <dir>/load \
  --duration 300 --root-pid "$(systemctl show -p MainPID --value homeline-backend)"
```
`--root-pid` only reads `/proc` (RSS of the prod process tree). Run it after the drill (the API is warm
again), with nobody demoing. No hosting-session action needed.

Readiness: the script's setup (read-only: `/defaults`, the official run record and scenario index,
40 `/pads/validate`) ran against prod at 13:06 CET: official `016355600dbe194c`, 23 permalink files,
8 valid pads, `/health` queue 0 after. A local smoke of the whole run (own port 8031, scratch
`HL_SERVER_DATA`) was not done: `/tmp/hl-heavy.lock` was queued (a W1 run and parity runs) and the
400 s wait ran out. The guest code is H1's `load.py`, unchanged.
