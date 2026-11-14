"""Known answers for the SQLite database (D59): connection settings, migrate(), cascade, version
pruning, share codes, length caps, IP-hash retention. Runs in CI on a temp file database."""

import sqlite3
from datetime import UTC, datetime, timedelta

import pytest

pytest.importorskip("pydantic")  # server dependency group (server.settings)
from server import db  # noqa: E402
from server.settings import settings  # noqa: E402

TREE = "a" * 40
CFG = "sha256:" + "b" * 64


def h(i: int) -> str:
    return f"{i:016x}"


@pytest.fixture
def conn(tmp_path):
    c = db.connect(tmp_path / "homeline.db")
    db.migrate(c)
    yield c
    c.close()


# ------------------------------------------------------------------------- connect, migrate ----
def test_connect_wal_foreign_keys_rows(tmp_path):
    c = db.connect(tmp_path / "sub" / "x.db")  # creates the folder
    assert c.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert c.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert isinstance(c.execute("SELECT 1 AS one").fetchone(), sqlite3.Row)
    c.close()
    c = db.connect(tmp_path / "sub" / "x.db")  # WAL persists, FKs are per connection
    assert c.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert c.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    c.close()


def test_default_path_is_under_hl_server_data(tmp_path, monkeypatch):
    monkeypatch.setenv("HL_SERVER_DATA", str(tmp_path / "srv"))
    assert db.default_path() == tmp_path / "srv" / "homeline.db"
    c = db.connect()
    assert (tmp_path / "srv" / "homeline.db").is_file()
    c.close()


def test_migrate_creates_schema_once(tmp_path):
    c = db.connect(tmp_path / "m.db")
    assert db.schema_version(c) == 0
    assert db.migrate(c) == [p.name for _, p in db.migration_files()]
    assert db.schema_version(c) == db.migration_files()[-1][0]
    tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert tables == {"plans", "plan_versions", "results", "jobs"}
    assert db.migrate(c) == []  # idempotent
    c.close()
    c = db.connect(tmp_path / "m.db")  # a restart applies nothing either
    assert db.migrate(c) == []
    c.close()


def test_failed_migration_rolls_back(tmp_path):
    mig = tmp_path / "mig"
    mig.mkdir()
    (mig / "0001_ok.sql").write_text("CREATE TABLE IF NOT EXISTS a (x INTEGER);")
    (mig / "0002_bad.sql").write_text("CREATE TABLE IF NOT EXISTS b (y INTEGER);\nNOT SQL;")
    c = db.connect(tmp_path / "f.db")
    with pytest.raises(sqlite3.Error):
        db.migrate(c, mig)
    assert db.schema_version(c) == 1
    names = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert names == {"a"}  # b rolled back with its version bump
    c.close()


# ------------------------------------------------------------------------- plans + versions ----
def test_cascade_plan_to_versions(conn):
    pid = db.create_plan(conn, title="Ridge loop")
    for i in range(3):
        db.add_version(conn, pid, {"pad": {"id": "rank1"}}, h(i), TREE, CFG)
    assert conn.execute("SELECT count(*) FROM plan_versions").fetchone()[0] == 3
    with conn:
        conn.execute("DELETE FROM plans WHERE id = ?", (pid,))
    assert conn.execute("SELECT count(*) FROM plan_versions").fetchone()[0] == 0


def test_version_needs_existing_plan(conn):
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO plan_versions (plan_id, number, inputs, result_hash, engine_tree,"
                     " config_hash) VALUES ('nope', 1, '{}', ?, ?, ?)", (h(1), TREE, CFG))
    with pytest.raises(LookupError):
        db.add_version(conn, "nope", {}, h(1), TREE, CFG)


def test_pruning_keeps_versions_kept(conn):
    keep = settings().plans.versions_kept
    assert keep == 20  # config/backend.yaml known answer (F27: "last 20 kept")
    pid, other = db.create_plan(conn), db.create_plan(conn)
    db.add_version(conn, other, {}, h(999), TREE, CFG)
    for i in range(1, keep + 6):
        assert db.add_version(conn, pid, {"i": i}, h(i), TREE, CFG) == i
    nums = [r[0] for r in conn.execute(
        "SELECT number FROM plan_versions WHERE plan_id = ? ORDER BY number", (pid,))]
    assert nums == list(range(6, keep + 6))
    plan = conn.execute("SELECT current_version FROM plans WHERE id = ?", (pid,)).fetchone()
    assert plan["current_version"] == keep + 5
    cur = conn.execute("SELECT result_hash FROM plan_versions WHERE plan_id = ? AND number = ?",
                       (pid, keep + 5)).fetchone()
    assert cur["result_hash"] == h(keep + 5)
    # another plan's versions are untouched
    assert conn.execute("SELECT count(*) FROM plan_versions WHERE plan_id = ?",
                        (other,)).fetchone()[0] == 1


def test_prune_with_explicit_keep(conn):
    pid = db.create_plan(conn)
    for i in range(5):
        db.add_version(conn, pid, {}, h(i), TREE, CFG, keep=100)
    with conn:
        assert db.prune_versions(conn, pid, keep=2) == 3
    with pytest.raises(ValueError):
        db.prune_versions(conn, pid, keep=0)


def test_version_inputs_must_be_json_object(conn):
    pid = db.create_plan(conn)
    for bad in ("[]", "not json", '"x"'):
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO plan_versions (plan_id, number, inputs, result_hash,"
                         " engine_tree, config_hash) VALUES (?, 1, ?, ?, ?, ?)",
                         (pid, bad, h(1), TREE, CFG))


# -------------------------------------------------------------------------------- share codes ----
def test_share_code_unique(conn):
    db.create_plan(conn, visibility="link", share_code="HL-7K2Q9M")
    with pytest.raises(sqlite3.IntegrityError):
        db.create_plan(conn, visibility="link", share_code="HL-7K2Q9M")


def test_share_code_format_in_db_and_python(conn):
    for bad in ("HL-7k2q9m", "HL-7K2Q9", "HL-7K2Q9MX", "HL-7K2QIM", "HL-7K2QOM", "HL-7K2QLM",
                "HL-7K2QUM", "XX-7K2Q9M", "HL7K2Q9M"):
        assert not db.check_share_code(bad), bad
        with pytest.raises(ValueError):
            db.create_plan(conn, share_code=bad)
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO plans (share_code) VALUES (?)", (bad,))


def test_new_share_code_matches_config(conn):
    codes = {db.new_share_code() for _ in range(200)}
    assert all(db.check_share_code(c) and len(c) == 9 for c in codes)
    for c in list(codes)[:20]:
        db.create_plan(conn, visibility="link", share_code=c)


def test_link_needs_a_code_and_visibility_is_config(conn):
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO plans (visibility) VALUES ('link')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO plans (visibility) VALUES ('public')")
    with pytest.raises(ValueError):
        db.create_plan(conn, visibility="public")
    pid = db.create_plan(conn)
    row = conn.execute("SELECT * FROM plans WHERE id = ?", (pid,)).fetchone()
    assert row["visibility"] == "private" and row["share_code"] is None
    assert row["current_version"] == 0 and len(row["id"]) == 32
    assert datetime.strptime(row["created_utc"], db.UTC_FORMAT)


# ----------------------------------------------------------------------------- titles, notes ----
def test_title_and_notes_capped_from_config(conn):
    lim = settings().limits
    db.create_plan(conn, title="t" * lim.title_max_chars, notes="n" * lim.notes_max_chars)
    with pytest.raises(ValueError, match="title"):
        db.create_plan(conn, title="t" * (lim.title_max_chars + 1))
    with pytest.raises(ValueError, match="notes"):
        db.create_plan(conn, notes="n" * (lim.notes_max_chars + 1))
    # characters, not bytes
    db.create_plan(conn, title="é" * lim.title_max_chars)


def test_text_is_stored_as_plain_text(conn):
    text = "<script>alert(1)</script> 'x'; DROP TABLE plans; --"
    pid = db.create_plan(conn, title=text, notes=text)
    row = conn.execute("SELECT title, notes FROM plans WHERE id = ?", (pid,)).fetchone()
    assert (row["title"], row["notes"]) == (text, text)


# ------------------------------------------------------------------------------- jobs, results ----
def test_job_constraints(conn):
    ins = "INSERT INTO jobs (type, result_hash, status, stages_done) VALUES (?, ?, ?, ?)"
    conn.execute(ins, ("plan", h(1), "queued", "[]"))
    for bad in [("nope", h(1), "queued", "[]"), ("plan", h(1), "lost", "[]"),
                ("plan", h(1), "queued", "{}"), ("plan", "xyz", "queued", "[]")]:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(ins, bad)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE jobs SET progress = 1.5")


def test_purge_ip_hashes_after_retention(conn):
    days = settings().limits.ip_hash_retention_days
    now = datetime(2026, 11, 20, 12, 0, tzinfo=UTC)
    old = (now - timedelta(days=days, seconds=1)).strftime(db.UTC_FORMAT)
    new = (now - timedelta(days=days) + timedelta(seconds=1)).strftime(db.UTC_FORMAT)
    with conn:
        for t in (old, new):
            conn.execute("INSERT INTO jobs (type, result_hash, status, requester_ip_hash,"
                         " created_utc) VALUES ('plan', ?, 'done', 'iphash', ?)", (h(1), t))
    assert db.purge_ip_hashes(conn, now) == 1
    rows = dict(conn.execute("SELECT created_utc, requester_ip_hash FROM jobs").fetchall())
    assert rows == {old: None, new: "iphash"}


def test_results_cache_row(conn):
    with conn:
        conn.execute("INSERT INTO results (hash, inputs, engine_tree, config_hash, status, pinned)"
                     " VALUES (?, '{}', ?, ?, 'done', 1)", (h(7), TREE, CFG))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO results (hash, inputs, engine_tree, config_hash, status)"
                     " VALUES (?, '{}', ?, ?, 'queued')", (h(8), TREE, CFG))
