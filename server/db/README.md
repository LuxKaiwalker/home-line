# server/db: the backend database (SQLite)

Owner WS12. Decision D59: no Supabase. The backend keeps its state in a single SQLite file and uses
only the standard-library `sqlite3` module. The file is `$HL_SERVER_DATA/homeline.db`.
`HL_SERVER_DATA` defaults to `data/server` in the repo, which git ignores.

| Table | Holds | Spec |
| --- | --- | --- |
| `plans` | id, title, notes, visibility (`private`/`link`), share code, current version, created, updated | F27, F28, D55 |
| `plan_versions` | plan, number, inputs (`plan_inputs.json`, K1), result hash, engine tree, config hash, created | F27, D52, D57 |
| `results` | result hash, inputs, engine tree, config hash, terrain hash, status, size, pinned, created, last used | F23, F35 (cache index) |
| `jobs` | id, type, result hash, status, stage, progress, stages done, error, hashed requester IP, times | F23, `job.schema.json` |

These follow `docs/backend.md` §6 with these differences:

- There are no `profiles`, owner columns, auth tables, row-level security or roles.
- Sessions, telemetry, runs and conditions are not stored here yet.

Access control belongs to the API (package O5):

- Reads are open.
- Creating a plan, adding a version and duplicating are open but rate-limited.
- Rename and delete need the team token.

## Use

```python
from server import db

conn = db.connect()            # $HL_SERVER_DATA/homeline.db, WAL, foreign keys on, sqlite3.Row
db.migrate(conn)               # applies new migrations; returns their names ([] when current)
pid = db.create_plan(conn, title="Ridge loop", visibility="link", share_code=db.new_share_code())
n = db.add_version(conn, pid, inputs, result_hash, engine_tree, config_hash)  # prunes to versions_kept
```

The helpers enforce values that `config/backend.yaml` owns, so those values never appear in SQL:

| Helper | Enforces |
| --- | --- |
| `check_text` | `limits.title_max_chars`, `limits.notes_max_chars`. Text is stored as plain text and the client renders it as text. |
| `check_share_code`, `new_share_code` | `plans.share_code`: `HL-` plus 6 Crockford base32 characters. The schema also has a UNIQUE constraint and a GLOB CHECK on the column. |
| `add_version`, `prune_versions` | `plans.versions_kept` (20). Only the newest versions of each plan are kept. |
| `purge_ip_hashes` | `limits.ip_hash_retention_days`. The periodic ops job should call it. |

`foreign_keys` is set for each connection, so open every connection with `db.connect()`. Deleting
a plan cascades to its versions.

## Migrations

- Files are `migrations/NNNN_snake_case.sql`, numbered from `0001` with no gaps.
- `migrate()` applies the files newer than `PRAGMA user_version`, each in its own transaction, then
  sets `user_version` to that file's number.
- Every statement is `CREATE ... IF NOT EXISTS`, so running a file again is harmless.
- Never edit an applied migration. Add the next number instead.

The CHECK constraints copy a few values from their sources: the visibility list, the share-code
pattern, the result-hash length, and the job and result enums. `server/tests/test_db_schema.py`
fails if any of them drifts from `config/backend.yaml` or `contracts/backend/`.

To apply the migrations by hand without Python:

```sh
sqlite3 "$HL_SERVER_DATA/homeline.db" < server/db/migrations/0001_init.sql
```

This does not set `user_version`. `migrate()` would then re-run the file once, which is harmless.

## Backups

WAL mode keeps recent writes in `homeline.db-wal`, so do not `cp` the database while the API runs.
Take a consistent online copy instead:

```sh
sqlite3 "$HL_SERVER_DATA/homeline.db" ".backup '/path/to/backup/homeline-$(date -u +%Y%m%dT%H%MZ).db'"
```

You can also use `VACUUM INTO '/path/to/copy.db'`. Plans are the only data that cannot be
recomputed, because results are reproducible from their inputs (spec §9). Back them up daily
off the VM.

## Tests

```sh
uv run --no-sync pytest server/tests/test_db_schema.py server/tests/test_db_plans.py -q
make server-test
```

The tests use a temporary database file. They need no server and run in CI.
