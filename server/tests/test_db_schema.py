"""Static checks of server/db/migrations: naming, idempotent DDL, and every value the SQL carries
agrees with its source (config/backend.yaml, contracts/backend/). No database server (D59)."""

import json
import re
import sqlite3

import pytest

pytest.importorskip("pydantic")  # server dependency group (server.settings)
from server import db  # noqa: E402
from server.settings import REPO, settings  # noqa: E402

CONTRACTS = REPO / "contracts" / "backend"
TABLES = {"plans", "plan_versions", "results", "jobs"}


def _sql() -> str:
    return "\n".join(p.read_text(encoding="utf-8") for _, p in db.migration_files())


def _code(sql: str) -> str:
    """SQL without -- comments (string literals here never contain '--')."""
    return re.sub(r"--[^\n]*", "", sql)


def _in_list(column: str) -> set[str]:
    m = re.search(rf"\b{column}\s+IN\s*\(([^)]*)\)", _code(_sql()))
    assert m, f"no IN (...) check for {column}"
    return set(re.findall(r"'([^']*)'", m.group(1)))


@pytest.fixture
def conn(tmp_path):
    c = db.connect(tmp_path / "t.db")
    db.migrate(c)
    yield c
    c.close()


# ------------------------------------------------------------------------- migration files ----
def test_migrations_are_numbered_in_order():
    files = db.migration_files()
    assert files, "no migrations"
    assert [n for n, _ in files] == list(range(1, len(files) + 1))  # 0001, 0002, ... no gaps
    assert files[0][1].name == "0001_init.sql"
    for _, p in files:
        assert db.MIGRATION_NAME.match(p.name)


def test_bad_migration_names_are_refused(tmp_path):
    (tmp_path / "0001_init.sql").write_text("")
    (tmp_path / "0001_again.sql").write_text("")
    with pytest.raises(ValueError, match="used twice"):
        db.migration_files(tmp_path)
    (tmp_path / "0001_again.sql").unlink()
    (tmp_path / "2_Bad-Name.sql").write_text("")
    with pytest.raises(ValueError, match="NNNN_snake_case"):
        db.migration_files(tmp_path)


def test_every_create_is_if_not_exists():
    creates = re.findall(r"\bCREATE\s+(?:UNIQUE\s+)?(\w+)\s+(\w+(?:\s+\w+\s+\w+)?)",
                         _code(_sql()), flags=re.I)
    assert creates
    for kind, rest in creates:
        assert rest.upper().startswith("IF NOT EXISTS"), f"CREATE {kind} {rest} is not idempotent"
    assert not re.search(r"\b(DROP|ALTER)\b", _code(_sql()), flags=re.I)


def test_raw_sql_applies_twice(tmp_path):
    c = sqlite3.connect(tmp_path / "raw.db")
    for _ in range(2):
        for _, p in db.migration_files():
            c.executescript(p.read_text(encoding="utf-8"))
    c.close()


# ------------------------------------------------------------------------------- the tables ----
def test_tables_are_spec_tables_without_accounts(conn):
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert names == TABLES
    for t in TABLES:
        cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({t})")}
        assert not cols & {"owner", "user_id", "profile", "requester_user"}, t
    low = _sql().lower()
    assert "supabase_" not in low and "auth." not in low and "row level security" not in low


def test_plan_columns_store_openapi_plan(conn):
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(plans)")}
    assert {"id", "title", "notes", "visibility", "share_code", "current_version",
            "created_utc", "updated_utc"} <= cols
    vcols = {r["name"] for r in conn.execute("PRAGMA table_info(plan_versions)")}
    assert {"plan_id", "number", "inputs", "result_hash", "engine_tree", "config_hash",
            "created_utc"} <= vcols


def test_job_columns_store_job_schema(conn):
    schema = json.loads((CONTRACTS / "job.schema.json").read_text())
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(jobs)")}
    per_response = {"queue_position", "attached", "retry_after_s", "result_url", "hash"}
    assert set(schema["properties"]) - per_response <= cols
    assert "result_hash" in cols  # job.hash


# ------------------------------------------------------------------ values agree with source ----
def test_visibility_matches_config():
    assert _in_list("visibility") == set(settings().plans.visibility)


def test_job_enums_match_contract():
    props = json.loads((CONTRACTS / "job.schema.json").read_text())["properties"]
    assert _in_list("type") == set(props["type"]["enum"])
    m = re.search(r"CREATE TABLE IF NOT EXISTS jobs \((.*?)\n\);", _code(_sql()), flags=re.S)
    st = re.search(r"\bstatus\s+TEXT[^\n]*IN\s*\(([^)]*)\)", m.group(1))
    assert set(re.findall(r"'([^']*)'", st.group(1))) == set(props["status"]["enum"])


def test_result_status_matches_run_record():
    props = json.loads((CONTRACTS / "run_record.schema.json").read_text())["properties"]
    m = re.search(r"CREATE TABLE IF NOT EXISTS results \((.*?)\n\);", _code(_sql()), flags=re.S)
    st = re.search(r"\bstatus\s+TEXT[^\n]*IN\s*\(([^)]*)\)", m.group(1))
    assert set(re.findall(r"'([^']*)'", st.group(1))) == set(props["status"]["enum"])


def test_share_code_check_equals_config_pattern(conn):
    """The SQL GLOB accepts exactly what settings().plans.share_code.matches() accepts."""
    sc = settings().plans.share_code
    assert sc.pattern() == "^HL-[0-9A-HJKMNP-TV-Z]{6}$"  # D55 known answer
    chars = [chr(c) for c in range(32, 127)] + ["é", "Ι"]  # Ι = Greek capital iota
    base = "7K2Q9M"
    candidates = {sc.prefix + base, "hl-" + base, "HL" + base, "HL_" + base, "HL-" + base[:5],
                  "HL-" + base + "0", " HL-" + base}
    for i in range(sc.chars):
        candidates |= {sc.prefix + base[:i] + c + base[i + 1:] for c in chars}
    for code in sorted(candidates):
        try:
            conn.execute("INSERT INTO plans (share_code) VALUES (?)", (code,))
            ok = True
        except sqlite3.IntegrityError:
            ok = False
        conn.rollback()
        assert ok == sc.matches(code) == db.check_share_code(code), code


def test_result_hash_length_from_config(conn):
    n = settings().compute.hash.hex_chars
    row = "INSERT INTO results (hash, inputs, engine_tree, config_hash, status) VALUES (?,?,?,?,?)"
    args = ("{}", "a" * 40, "sha256:" + "b" * 64, "done")
    conn.execute(row, ("0" * n, *args))
    for bad in ("0" * (n - 1), "0" * (n + 1), "A" * n, "g" * n):
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(row, (bad, *args))


def test_no_config_limit_typed_into_sql():
    """Caps and counts that config owns are enforced in Python, never as SQL literals."""
    c = settings()
    code = _code(_sql())
    for name, v in {"plans.versions_kept": c.plans.versions_kept,
                    "limits.title_max_chars": c.limits.title_max_chars,
                    "limits.notes_max_chars": c.limits.notes_max_chars,
                    "limits.ip_hash_retention_days": c.limits.ip_hash_retention_days,
                    "limits.upload_max_bytes": c.limits.upload_max_bytes}.items():
        assert not re.search(rf"(?<![\w.]){v}(?![\w.])", code), f"{name} = {v} typed into SQL"
