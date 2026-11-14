"""The engine's single call site for the provenance manifest (AGENTS.md rule 6, F16).

Thin adapter. When WS6's ``pipeline.provenance.manifest`` exposes ``record(key, value, units,
file, script)`` it forwards there. Until that lands on main it writes the same entries
({value, units, file, script, commit, utc}, contracts/manifest.schema.json) to a local
fragment ``data/interim/engine/manifest_fragment.json`` (or ``$HOMELINE_ENGINE_MANIFEST_DIR``)
that WS6's merge can pick up.

TODO(WS2): drop the fallback once WS6's manifest.py is on main (see STATUS WS2).
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import subprocess
from datetime import UTC, datetime
from pathlib import Path

from .config import ENGINE_DIR, REPO

FALLBACK_DIR_ENV = "HOMELINE_ENGINE_MANIFEST_DIR"
FRAGMENT_NAME = "manifest_fragment.json"


def _ws6_record():
    try:
        from pipeline.provenance import manifest  # type: ignore[attr-defined]
    except ImportError:
        return None
    return getattr(manifest, "record", None)


def _commit() -> str:
    try:
        sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True,
                             text=True, check=True).stdout.strip()  # fmt: skip
        dirty = subprocess.run(["git", "status", "--porcelain", "--untracked-files=no"],
                               cwd=REPO, capture_output=True, text=True).stdout.strip()  # fmt: skip
        return sha + ("-dirty" if dirty else "")
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def fragment_path() -> Path:
    d = Path(os.environ.get(FALLBACK_DIR_ENV, ENGINE_DIR))
    return d / FRAGMENT_NAME


def _clean(value):
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("NaN/inf is not a displayable number; record None for unknown")
    return value


def record(key: str, value, units: str | None, file: str, script: str) -> dict:
    """Record one displayed number. Returns the stored entry."""
    ws6 = _ws6_record()
    if ws6 is not None and FALLBACK_DIR_ENV not in os.environ:
        return ws6(key, _clean(value), units, file, script)
    entry = {
        "value": _clean(value),
        "units": units,
        "file": str(file),
        "script": str(script),
        "commit": _commit(),
        "utc": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    path = fragment_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    frag = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    frag[key] = entry
    from .geo import validate

    validate(frag, "manifest.schema.json")
    path.write_text(json.dumps(frag, indent=1, sort_keys=True), encoding="utf-8")
    return entry


def record_file(data_path: str, local_path, script: str) -> dict:
    """File-level key ``file.<data path>`` = SHA-256 of the bytes, for per-feature values."""
    digest = hashlib.sha256(Path(local_path).read_bytes()).hexdigest()
    return record(f"file.{data_path}", digest, "sha256", data_path, script)


def load_fragment() -> dict:
    p = fragment_path()
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
