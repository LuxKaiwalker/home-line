"""The engine's single call site for the provenance manifest (AGENTS.md rule 6, F16).

Forwards to WS6's ``pipeline.provenance.manifest.record`` (key, value, units, file, script),
which adds commit and UTC time, validates against contracts/manifest.schema.json and writes the
per-script fragment ``data/interim/manifest/<script>.json`` (``$HOMELINE_MANIFEST_DIR`` in
tests). The engine only adds the file-level SHA-256 key helper.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from pipeline.provenance import manifest

FRAGMENT_DIR_ENV = manifest.FRAGMENT_DIR_ENV


def record(key: str, value, units: str | None, file: str, script: str) -> dict:
    """Record one displayed number (WS6 API). Returns the stored entry."""
    return manifest.record(key, value, units, file, script)


def record_file(data_path: str, local_path, script: str) -> dict:
    """File-level key ``file.<data path>`` = SHA-256 of the bytes, for per-feature values."""
    digest = hashlib.sha256(Path(local_path).read_bytes()).hexdigest()
    return record(f"file.{data_path}", digest, "sha256", data_path, script)


def load_all(fragment_dir=None) -> dict:
    """All manifest entries from every fragment in ``fragment_dir`` (default per WS6 rules)."""
    out: dict = {}
    for frag in manifest.load_fragments(fragment_dir).values():
        out.update(frag)
    return out
