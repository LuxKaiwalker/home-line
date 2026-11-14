"""Thin provenance adapter for WS1 (AGENTS.md rule 6).

Uses ``pipeline.provenance.manifest.record`` (WS6) when it is on the branch. Until then
(TODO(WS6): delete the fallback once manifest.py is merged to main) entries go to
``data/interim/terrain/manifest_pending.json`` in the contract shape
``{key: {value, units, file, script, commit, utc}}``; re-running the build after WS6 lands
re-records every key through WS6's ``record``.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
from datetime import UTC, datetime
from pathlib import Path

try:  # pragma: no cover - depends on WS6's merge state
    from pipeline.provenance.manifest import record as _ws6_record
except ImportError:  # pragma: no cover
    _ws6_record = None

REPO = Path(__file__).resolve().parents[2]
PENDING = REPO / "data" / "interim" / "terrain" / "manifest_pending.json"


def _commit() -> str:
    try:
        c = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True,
                           text=True, check=True).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain", "--", "pipeline", "config"],
                               cwd=REPO, capture_output=True, text=True).stdout.strip()
        return c + ("-dirty" if dirty else "")
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def _rel(p) -> str:
    p = Path(p)
    for base in (REPO, REPO / "data", (REPO / "data").resolve()):
        try:
            rel = p.resolve().relative_to(base.resolve())
            return str(Path("data") / rel) if base != REPO else str(rel)
        except ValueError:
            continue
    return str(p)


def _clean(v):
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float) and not math.isfinite(v):
        return None
    return v


def record(key: str, value, units, file, script) -> None:
    if _ws6_record is not None:
        _ws6_record(key, value, units, str(file), script)
        return
    PENDING.parent.mkdir(parents=True, exist_ok=True)
    d = json.loads(PENDING.read_text()) if PENDING.exists() else {}
    d[key] = {"value": _clean(value), "units": units, "file": _rel(file) if os.sep in str(file)
              else str(file), "script": _rel(script), "commit": _commit(),
              "utc": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")}
    tmp = PENDING.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, indent=1, sort_keys=True))
    tmp.replace(PENDING)
