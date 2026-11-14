"""Engine and code identity for GET /engine/version (F23, F35; D57 parts of the result hash).

- ``commit``: ``git rev-parse HEAD``; ``engine_tree``: ``git rev-parse HEAD:pipeline`` (D57).
- ``config_hash``: ``tools.make_bundle.config_hash`` over config/*.yaml except backend.yaml (D57).
- ``terrain_hash``: sha256 of the server data manifest ``$HL_SERVER_DATA/manifest.json`` written
  by tools/make_serverdata.py (contracts/backend/README.md "Result hash"); None while it is absent.
- contract versions: backend = openapi.yaml ``info.version``; bundle =
  ``tools.make_bundle.CONTRACT_VERSION``; web = the newest ``x-contract-version`` of the top-level
  contracts/*.schema.json (contracts/README.md: a schema carries the version that last changed it).
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
from functools import cache
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]
CONTRACTS = REPO / "contracts"
SERVER_DATA_ENV = "HL_SERVER_DATA"
SERVER_DATA_DEFAULT = "data/server"  # Makefile HL_SERVER_DATA default, relative to the repo
SERVER_DATA_MANIFEST = "manifest.json"  # written by tools/make_serverdata.py (WS11 task 5)


class Unavailable(RuntimeError):
    """A part of the engine identity cannot be determined (reported, never invented)."""


def server_data_dir() -> Path:
    p = Path(os.environ.get(SERVER_DATA_ENV) or SERVER_DATA_DEFAULT)
    return p if p.is_absolute() else REPO / p


def terrain_hash() -> str | None:
    """sha256 of the server data manifest, or None when the server data are not built."""
    f = server_data_dir() / SERVER_DATA_MANIFEST
    if not f.is_file():
        return None
    return "sha256:" + hashlib.sha256(f.read_bytes()).hexdigest()


def _git(*args: str) -> str:
    try:
        out = subprocess.run(["git", *args], cwd=REPO, check=True, capture_output=True, text=True)
    except (OSError, subprocess.CalledProcessError) as e:
        raise Unavailable(f"git {' '.join(args)} failed: {e}") from e
    return out.stdout.strip()


def _semver(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in v.split("."))


def web_contract_version() -> str:
    versions = [json.loads(p.read_text(encoding="utf-8"))["x-contract-version"]
                for p in CONTRACTS.glob("*.schema.json")]
    return max(versions, key=_semver)


def backend_contract_version() -> str:
    api = yaml.safe_load((CONTRACTS / "backend" / "openapi.yaml").read_text(encoding="utf-8"))
    return str(api["info"]["version"])


@cache
def code_identity() -> dict:
    """The parts fixed for the life of this process (taken once, at start-up)."""
    from tools.make_bundle import CONTRACT_VERSION, config_hash

    return {
        "engine_tree": _git("rev-parse", "HEAD:pipeline"),
        "commit": _git("rev-parse", "HEAD"),
        "config_hash": config_hash(),
        "web_contract_version": web_contract_version(),
        "backend_contract_version": backend_contract_version(),
        "bundle_contract_version": CONTRACT_VERSION,
    }


def engine_version() -> dict:
    """The /engine/version body (openapi.yaml EngineVersion); raises Unavailable when a required
    part (git identity, server data manifest) is missing."""
    th = terrain_hash()
    if th is None:
        raise Unavailable(f"no server data manifest at {server_data_dir() / SERVER_DATA_MANIFEST}"
                          " (run `make serverdata`)")
    return {**code_identity(), "terrain_hash": th}
