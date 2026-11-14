"""HOMELINE backend database: SQLite at ``$HL_SERVER_DATA/homeline.db`` (D59; server/db/README.md).

Standard library ``sqlite3`` only. ``connect()`` opens the file in WAL mode with foreign keys on;
``migrate()`` applies ``server/db/migrations/NNNN_*.sql`` in order and records the newest number in
``PRAGMA user_version``. The helpers below enforce what config/backend.yaml owns (length caps,
share-code format, versions kept, IP-hash retention), so those values are never typed into SQL.
Access control is the API's job (package O5), not the database's.
"""

from __future__ import annotations

import json
import re
import secrets
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from server.engine.version import server_data_dir

DB_FILE = "homeline.db"
MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
MIGRATION_NAME = re.compile(r"^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$")
UTC_FORMAT = "%Y-%m-%dT%H:%M:%SZ"  # same text as the SQL defaults (openapi.yaml Utc)


def default_path() -> Path:
    """``$HL_SERVER_DATA/homeline.db`` (HL_SERVER_DATA defaults to data/server in the repo)."""
    return server_data_dir() / DB_FILE


def connect(path: str | Path | None = None) -> sqlite3.Connection:
    """Open (and create) the database: WAL journal, foreign keys on, rows as ``sqlite3.Row``."""
    p = Path(path) if path is not None else default_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(p)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    mode = conn.execute("PRAGMA journal_mode = WAL").fetchone()[0]
    if mode != "wal":
        conn.close()
        raise sqlite3.OperationalError(f"{p}: could not switch to WAL (journal_mode={mode})")
    return conn


# ---------------------------------------------------------------------------------- migrations ----
def migration_files(directory: Path = MIGRATIONS_DIR) -> list[tuple[int, Path]]:
    """(number, path) of every migration in apply order; refuses a bad name or a repeated number."""
    out: dict[int, Path] = {}
    for p in sorted(directory.glob("*.sql")):
        m = MIGRATION_NAME.match(p.name)
        if not m:
            raise ValueError(f"migration name {p.name!r} is not NNNN_snake_case.sql")
        n = int(m.group(1))
        if n in out:
            raise ValueError(f"migration number {n:04d} used twice: {out[n].name}, {p.name}")
        out[n] = p
    return sorted(out.items())


def schema_version(conn: sqlite3.Connection) -> int:
    return conn.execute("PRAGMA user_version").fetchone()[0]


def migrate(conn: sqlite3.Connection, directory: Path = MIGRATIONS_DIR) -> list[str]:
    """Apply every migration newer than ``PRAGMA user_version``, each in its own transaction.

    Returns the names applied (empty when the database is current, so a second call is a no-op).
    """
    conn.commit()
    applied = []
    for n, p in migration_files(directory):
        if n <= schema_version(conn):
            continue
        sql = p.read_text(encoding="utf-8")
        try:
            conn.executescript(f"BEGIN;\n{sql}\n;PRAGMA user_version = {n};\nCOMMIT;")
        except sqlite3.Error:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
        applied.append(p.name)
    return applied


# ------------------------------------------------------------------------------- config checks ----
def _cfg():
    from server.settings import settings  # pydantic; imported only where config is needed

    return settings()


def now_utc() -> str:
    return datetime.now(UTC).strftime(UTC_FORMAT)


def check_text(title: str = "", notes: str = "") -> None:
    """Refuse a title or notes longer than limits.title_max_chars / notes_max_chars (plain text)."""
    lim = _cfg().limits
    if len(title) > lim.title_max_chars:
        raise ValueError(f"title longer than {lim.title_max_chars} characters")
    if len(notes) > lim.notes_max_chars:
        raise ValueError(f"notes longer than {lim.notes_max_chars} characters")


def check_share_code(code: str) -> bool:
    """True for a canonical share code (config plans.share_code; D55: HL- + 6 Crockford base32)."""
    return _cfg().plans.share_code.matches(code)


def new_share_code() -> str:
    """A random share code from config plans.share_code (callers retry on a UNIQUE collision)."""
    sc = _cfg().plans.share_code
    return sc.prefix + "".join(secrets.choice(sc.alphabet) for _ in range(sc.chars))


# ------------------------------------------------------------------------------------- helpers ----
def create_plan(conn: sqlite3.Connection, *, title: str = "", notes: str = "",
                visibility: str = "private", share_code: str | None = None) -> str:
    """Insert a plan (no version yet) after the config checks; returns its id. Commits."""
    check_text(title, notes)
    if visibility not in _cfg().plans.visibility:
        raise ValueError(f"visibility {visibility!r} not in {_cfg().plans.visibility}")
    if share_code is not None and not check_share_code(share_code):
        raise ValueError(f"malformed share code {share_code!r}")
    with conn:
        row = conn.execute(
            "INSERT INTO plans (title, notes, visibility, share_code) VALUES (?, ?, ?, ?)"
            " RETURNING id", (title, notes, visibility, share_code)).fetchone()
    return row[0]


def add_version(conn: sqlite3.Connection, plan_id: str, inputs: dict[str, Any], result_hash: str,
                engine_tree: str, config_hash: str, keep: int | None = None) -> int:
    """Save a new version of a plan and prune to the newest ``keep`` (plans.versions_kept).

    One transaction: the plan's current_version goes up by one, the version gets that number,
    older versions beyond ``keep`` are deleted. Returns the new number. Commits.
    """
    with conn:
        row = conn.execute(
            "UPDATE plans SET current_version = current_version + 1, updated_utc = ?"
            " WHERE id = ? RETURNING current_version", (now_utc(), plan_id)).fetchone()
        if row is None:
            raise LookupError(f"plan {plan_id} not found")
        number = row[0]
        conn.execute(
            "INSERT INTO plan_versions (plan_id, number, inputs, result_hash, engine_tree,"
            " config_hash) VALUES (?, ?, ?, ?, ?, ?)",
            (plan_id, number, json.dumps(inputs, sort_keys=True, separators=(",", ":")),
             result_hash, engine_tree, config_hash))
        prune_versions(conn, plan_id, keep)
    return number


def prune_versions(conn: sqlite3.Connection, plan_id: str, keep: int | None = None) -> int:
    """Delete all but the newest ``keep`` versions of a plan (default plans.versions_kept).

    Runs inside the caller's transaction; returns the number of versions deleted.
    """
    keep = _cfg().plans.versions_kept if keep is None else keep
    if keep < 1:
        raise ValueError("keep must be >= 1")
    cur = conn.execute(
        "DELETE FROM plan_versions WHERE plan_id = ? AND number <="
        " (SELECT max(number) FROM plan_versions WHERE plan_id = ?) - ?",
        (plan_id, plan_id, keep))
    return cur.rowcount


def purge_ip_hashes(conn: sqlite3.Connection, now: datetime | None = None) -> int:
    """Clear job IP hashes older than limits.ip_hash_retention_days (spec §8). Commits."""
    now = now or datetime.now(UTC)
    cutoff = (now - timedelta(days=_cfg().limits.ip_hash_retention_days)).strftime(UTC_FORMAT)
    with conn:
        cur = conn.execute(
            "UPDATE jobs SET requester_ip_hash = NULL"
            " WHERE requester_ip_hash IS NOT NULL AND created_utc < ?", (cutoff,))
    return cur.rowcount
