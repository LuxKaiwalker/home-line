"""WP11 check 5 (section 10.7, D115): 10 parallel guests against the HOSTED API, as H1.

H1's guests (docs/hardening/load.py: /health every 3 s, /defaults, /engine/version, the official
permalink files, /pads/validate and /pads/screen on random points, with 1-4 s think times), pointed
at https://homeline-api.vxliu.com through Cloudflare, the tunnel and nginx. Unlike H1 it starts NO
new heavy job and never touches the kill switch (no team token): the API is the public one on the
shared machine. Its job traffic is the cheap path only: every guest now and then submits the
official inputs, a cached result (202 done at once, no worker, not counted by the per-IP limits).

All guests share this machine's public address, so nginx's coarse per-IP ceiling (limit_req
20 r/s, burst 40, homeline-host/homeline.nix) applies to all ten together: its 429s (body
``{"error": "proxy", "status": 429}``) are counted apart (``nginx_429``) and reported, not failed.

    uv run --no-sync python docs/hardening/load_hosted.py --out <dir> [--duration 300] \
        [--root-pid $(systemctl show -p MainPID --value homeline-backend)]

--root-pid is optional (read-only /proc sampling of the prod process tree's RSS; same machine).
Exit 0 when: no 5xx, no transport error, /health p95 < 2 s (api.health_timeout_s) and max < 2 s
except at most 0.5 % (one slow poll is one offline blink in a browser), every cached submit 202
done, and no app 429.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import random
import sys
import time
from pathlib import Path

import httpx

_spec = importlib.util.spec_from_file_location("h1load", Path(__file__).with_name("load.py"))
h1 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(h1)

GUESTS = h1.GUESTS  # 10
OFFICIAL_DEFAULT = "016355600dbe194c"  # official hash of the prod identity (b84cdd1, 2026-11-15)
CACHED_EVERY_S = (20.0, 60.0)  # think time between one guest's cached submits


async def setup(base: str, official: str) -> dict:
    """The reader context of load.py without its write-free but long valid-pad search: the
    official permalink files, and up to 8 valid pads from 40 nearest-valid lookups."""
    async with httpx.AsyncClient(base_url=base, timeout=30) as c:
        d = (await c.get("/defaults")).json()
        cv = d["inputs"]["contract_version"]
        centre = (d["inputs"]["pad"]["lon"], d["inputs"]["pad"]["lat"])
        rr = (await c.get(f"/results/{official}/run_record.json")).json()
        assert rr.get("origin") == "precomputed", f"{official} is not the official tree: {rr}"
        idx = (await c.get(f"/results/{official}/scenarios/index.json")).json()
        files = ["run_record.json", "provenance", "manifest.json", "scenarios/index.json",
                 "pad.json", "labels.json", "stations.json"]
        for s in idx["scenarios"]:
            if s.get("suit_kg") == 104 or s["id"].startswith("nom_"):
                files += [f for f in s["files"].values() if f not in files]
        rng, valid = random.Random(71), []
        for _ in range(40):
            v = (await c.post("/pads/validate", json=h1.random_point(rng, centre))).json()
            q = v if v.get("valid") else v.get("nearest_valid")
            if isinstance(q, dict) and "lon" in q:
                q = {"lon": round(q["lon"], 6), "lat": round(q["lat"], 6)}
                if q not in valid:
                    valid.append(q)
            if len(valid) >= 8:
                break
    return {"cv": cv, "centre": centre, "official": official, "official_inputs": d["inputs"],
            "files": files, "valid": valid or [d["inputs"]["pad"]]}


async def cached_submitter(rec, client, g: int, ctx: dict, stop: asyncio.Event,
                           out: list) -> None:
    rng = random.Random(500 + g)
    body = {"type": "plan", "inputs": ctx["official_inputs"]}
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), rng.uniform(*CACHED_EVERY_S))
            return
        except TimeoutError:
            pass
        r = await h1.call(rec, client, g, "POST /jobs (cached)", "POST", "/jobs", json=body)
        doc = {}
        if r is not None:
            try:
                doc = r.json()
            except ValueError:
                doc = {}
        out.append({"guest": g, "status": None if r is None else r.status_code,
                    "job_status": doc.get("status"), "attached": doc.get("attached"),
                    "error": doc.get("error")})


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--base", default="https://homeline-api.vxliu.com/api/v1")
    ap.add_argument("--official", default=OFFICIAL_DEFAULT)
    ap.add_argument("--duration", type=float, default=300.0)
    ap.add_argument("--root-pid", type=int, default=0, help="prod process tree root (optional)")
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)

    ctx = await setup(a.base, a.official)
    print(f"official {ctx['official']}, {len(ctx['files'])} permalink files, "
          f"{len(ctx['valid'])} valid pads, {GUESTS} guests, {a.duration:g} s", flush=True)
    rec = h1.Rec(a.out)
    stop, mstop, peak, cached = asyncio.Event(), asyncio.Event(), {}, []
    clients = [httpx.AsyncClient(base_url=a.base, headers={"Origin": "https://homeline.vxliu.com"})
               for _ in range(GUESTS)]
    tasks = []
    if a.root_pid:
        tasks.append(asyncio.create_task(h1.mem_sampler(rec, a.root_pid, a.out, mstop, peak)))
    for g, c in enumerate(clients):
        tasks += [asyncio.create_task(h1.health_loop(rec, c, g, stop)),
                  asyncio.create_task(h1.reader(rec, c, g, ctx, stop)),
                  asyncio.create_task(cached_submitter(rec, c, g, ctx, stop, cached))]
    t_start = time.time()
    await asyncio.sleep(a.duration)
    stop.set()
    await asyncio.gather(*tasks[1 if a.root_pid else 0:], return_exceptions=True)
    mstop.set()
    if a.root_pid:
        await tasks[0]
    for c in clients:
        await c.aclose()

    rows = rec.rows
    summ = h1.summarise(rows)
    health = [r for r in rows if r["ep"] == "GET /health"]
    hs = [r["s"] for r in health if r["status"] == 200]
    slow = [r for r in health if r["status"] != 200 or r["s"] > h1.HEALTH_LIMIT_S]
    five = [r for r in rows if (r["status"] or 0) >= 500]
    transport = [r for r in rows if r["status"] is None]
    r429 = [r for r in rows if r["status"] == 429]
    app_429 = [r for r in r429 if r.get("code") != "proxy"]
    nginx_429 = [r for r in r429 if r.get("code") == "proxy"]
    bad_cached = [x for x in cached if not (x["status"] == 202 and x["job_status"] == "done")]
    result = {
        "started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t_start)),
        "base": a.base, "duration_s": a.duration, "requests": len(rows),
        "rate_rps": round(len(rows) / a.duration, 1), "endpoints": summ,
        "health": {"n": len(health), "slow_or_failed": len(slow),
                   "p95_ms": round(1000 * h1.pct(hs, 0.95), 1) if hs else None,
                   "max_ms": round(1000 * max(hs), 1) if hs else None},
        "cached_submits": {"n": len(cached), "bad": bad_cached},
        "5xx": len(five), "transport_errors": len(transport),
        "app_429": len(app_429), "nginx_429": len(nginx_429),
        "peak_rss_gib": round(peak.get("kb", 0) / 2**20, 2) if a.root_pid else None,
    }
    (a.out / "summary.json").write_text(json.dumps(result, indent=1))
    print("\nendpoint                        n     p50ms   p95ms    maxms  statuses")
    for ep, s in summ.items():
        print(f"{ep:30s}{s['n']:5d} {s['p50_ms']:8} {s['p95_ms']:8} {s['max_ms']:8}  "
              f"{s['by_status']}")
    for k in ("requests", "rate_rps", "health", "cached_submits", "5xx", "transport_errors",
              "app_429", "nginx_429", "peak_rss_gib"):
        print(f"{k}: {json.dumps(result[k])}")
    ok = (not five and not transport and not app_429 and not bad_cached and cached
          and hs and h1.pct(hs, 0.95) < h1.HEALTH_LIMIT_S
          and len(slow) <= max(1, int(0.005 * len(health))))
    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
