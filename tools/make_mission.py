#!/usr/bin/env python3
"""mission.json of the official, precomputed plan (D110, WP9c): simulator export without a live job.

``--official`` reads the published official tree ``web/public/data`` (read-only; nothing in it is
ever written) and writes ``web/public/sim/official/mission.json`` (contracts/bundle
mission.schema.json, origin ``precomputed``, origin_label = config/backend.yaml
``labels.precomputed``). The numbers are the official plan's own (the engine's route of the
default scenario, F9), copied by WP9b's builder ``server.engine.mission.build_mission``, never
recomputed here.

Deterministic: ``created_utc`` is the official data's build time (the latest ``utc`` in
``web/public/data/manifest.json``, the same instant the server's synthesised run record gives as
``finished_utc``), not "now"; so the same tree always gives the same bytes. ``--check`` rebuilds
in memory and compares with the committed file (exit 1 when stale).

The server serves the written file for the official hash as
``GET /api/v1/results/{official_hash}/mission.json`` (server/engine/results.py).

Usage: ``make mission-official`` (= ``tools/make_mission.py --official``).
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
if str(REPO) not in sys.path:  # run as a script: make `server` and `tools` importable
    sys.path.insert(0, str(REPO))

DATA = REPO / "web" / "public" / "data"
OFFICIAL_OUT = REPO / "web" / "public" / "sim" / "official" / "mission.json"
CONFIG = REPO / "config"
ORIGIN = "precomputed"


def _json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def _manifest_entries(data: Path) -> list[dict]:
    m = _json(data / "manifest.json")
    return [v for v in m.values() if isinstance(v, dict)]


def build_time(data: Path = DATA) -> str:
    """The official tree's build time: the latest ``utc`` of its provenance manifest."""
    times = sorted(v["utc"] for v in _manifest_entries(data) if v.get("utc"))
    if not times:
        raise ValueError(f"{data / 'manifest.json'} carries no utc times")
    return times[-1]


def default_scenario(data: Path = DATA) -> str:
    """scenarios/index.json ``default`` (the scenario the official plan's route belongs to)."""
    return _json(data / "scenarios" / "index.json")["default"]


def route_commit(data: Path, route_file: str) -> str | None:
    """Engine commit of the route file (manifest ``commit``; plan.json engine.commit rule)."""
    commits = sorted({v["commit"] for v in _manifest_entries(data)
                      if v.get("file") == route_file and v.get("commit")})
    return commits[0] if len(commits) == 1 else None


def official_kwargs(data: Path = DATA) -> dict:
    """The keyword arguments of ``build_mission`` / ``write_mission`` for the official plan."""
    from server.engine.hashing import official_inputs
    from server.settings import settings

    scenario = default_scenario(data)
    files = {"route": f"route_{scenario}.geojson", "timeline": f"timeline_{scenario}.json",
             "stations": "stations.json", "pad": "pad.json"}
    missing = [f for f in files.values() if not (data / f).is_file()]
    if missing:
        raise FileNotFoundError(f"official tree {data} lacks {missing}")
    grids = yaml.safe_load((CONFIG / "site.yaml").read_text(encoding="utf-8"))["grids_m"]
    planner = {
        "app_commit": route_commit(data, files["route"]),
        "config_hash": None,  # web/public/data does not carry the config hash it was built with
        "routing_grid_res_m": grids["route"],  # the engine's routing grid (3 m)
        "elevation_res_m": grids["dem"],  # the engine's terrain (1 m DEM)
        "files": files,
    }
    return {"inputs": official_inputs(), "scenario": scenario, "origin": ORIGIN,
            "origin_label": settings().labels.precomputed, "planner": planner,
            "created_utc": build_time(data)}


def _guard(out: Path, data: Path) -> None:
    if out.resolve().is_relative_to(data.resolve()):
        raise ValueError(f"refusing to write {out} inside the official tree {data}")


def build_official(data: Path = DATA) -> dict:
    """The official plan's mission document (validated by the builder's writer on write)."""
    from server.engine.mission import build_mission

    return build_mission(data, **official_kwargs(data))


def write_official(data: Path = DATA, out: Path = OFFICIAL_OUT) -> Path:
    from server.engine.mission import write_mission

    _guard(out, data)
    out.parent.mkdir(parents=True, exist_ok=True)
    return write_mission(data, out, **official_kwargs(data))


def official_bytes(data: Path = DATA) -> bytes:
    """What ``write_official`` would write, built in a temp folder (for --check and tests)."""
    with tempfile.TemporaryDirectory() as tmp:
        return write_official(data, Path(tmp) / "mission.json").read_bytes()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--official", action="store_true", required=True,
                    help="write the official plan's mission.json (origin precomputed)")
    ap.add_argument("--data", type=Path, default=DATA, help="official tree (read-only)")
    ap.add_argument("--out", type=Path, default=OFFICIAL_OUT)
    ap.add_argument("--check", action="store_true",
                    help="do not write; exit 1 when --out differs from a fresh build")
    a = ap.parse_args(argv)
    if a.check:
        fresh = official_bytes(a.data)
        if not a.out.is_file() or a.out.read_bytes() != fresh:
            print(f"{a.out} is stale: run make mission-official", file=sys.stderr)
            return 1
        print(f"{a.out} is up to date")
        return 0
    out = write_official(a.data, a.out)
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
