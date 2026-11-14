-- HOMELINE backend database, SQLite (D59: no Supabase). File: $HL_SERVER_DATA/homeline.db.
-- Tables follow docs/backend.md §6 without owner/profile columns: there are no user accounts.
-- Access control (open reads, rate-limited creates, team token for rename/delete) lives in the API
-- (package O5), not here.
--
-- Idempotent: every statement is CREATE ... IF NOT EXISTS, so applying the file twice is a no-op.
-- Timestamps are UTC text 'YYYY-MM-DDTHH:MM:SSZ' (openapi.yaml Utc). JSON columns hold one object.
--
-- Values owned by config/backend.yaml or contracts/backend/ that appear below (visibility list,
-- share-code GLOB, result-hash length, job enums) are checked against their source by
-- server/tests/test_db_schema.py. Length caps and versions_kept are enforced in Python
-- (server/db/__init__.py) from config, so changing them needs no migration.

-- plans (F27, F28): the plan library. A plan stores inputs (in plan_versions), not results (D52).
-- visibility 'link' = resolvable by share code (D55); there is no public listing of private plans.
CREATE TABLE IF NOT EXISTS plans (
  id              TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  title           TEXT NOT NULL DEFAULT '',
  notes           TEXT NOT NULL DEFAULT '',
  visibility      TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'link')),
  share_code      TEXT UNIQUE CHECK (
                    share_code IS NULL OR (length(share_code) = 9 AND share_code GLOB
                    'HL-[0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z][0-9A-HJKMNP-TV-Z]')),
  current_version INTEGER NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  created_utc     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_utc     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (visibility <> 'link' OR share_code IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS plans_updated_idx ON plans (updated_utc);

-- plan_versions: every save is a version; the newest plans.versions_kept are kept
-- (server.db.add_version prunes). inputs = plan_inputs.json (K1); result_hash = its D57 hash;
-- engine_tree and config_hash = what it was computed with (openapi PlanVersion).
CREATE TABLE IF NOT EXISTS plan_versions (
  id          TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  plan_id     TEXT NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  number      INTEGER NOT NULL CHECK (number >= 1),
  inputs      TEXT NOT NULL CHECK (json_valid(inputs) AND json_type(inputs) = 'object'),
  result_hash TEXT NOT NULL CHECK (length(result_hash) = 16 AND result_hash NOT GLOB '*[^0-9a-f]*'),
  engine_tree TEXT NOT NULL CHECK (length(engine_tree) = 40 AND engine_tree NOT GLOB '*[^0-9a-f]*'),
  config_hash TEXT NOT NULL CHECK (length(config_hash) = 71 AND config_hash GLOB 'sha256:*'
                                   AND substr(config_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  created_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (plan_id, number)
);

-- results: cache index of result trees (results/{hash}/ on disk, run_record.json beside them).
-- No user data. pinned rows (cache.pinned: official, picker) are never evicted.
CREATE TABLE IF NOT EXISTS results (
  hash          TEXT PRIMARY KEY NOT NULL CHECK (length(hash) = 16 AND hash NOT GLOB '*[^0-9a-f]*'),
  inputs        TEXT NOT NULL CHECK (json_valid(inputs) AND json_type(inputs) = 'object'),
  engine_tree   TEXT NOT NULL CHECK (length(engine_tree) = 40 AND engine_tree NOT GLOB '*[^0-9a-f]*'),
  config_hash   TEXT NOT NULL CHECK (length(config_hash) = 71 AND config_hash GLOB 'sha256:*'
                                     AND substr(config_hash, 8) NOT GLOB '*[^0-9a-f]*'),
  terrain_hash  TEXT CHECK (terrain_hash IS NULL OR (length(terrain_hash) = 71
                            AND terrain_hash GLOB 'sha256:*'
                            AND substr(terrain_hash, 8) NOT GLOB '*[^0-9a-f]*')),
  status        TEXT NOT NULL CHECK (status IN ('done', 'partial', 'error', 'timeout')),
  size_bytes    INTEGER NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  pinned        INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  created_utc   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_used_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS results_lru_idx ON results (pinned, last_used_utc);

-- jobs: heavy jobs (contracts/backend/job.schema.json, F23). The requester is a hashed IP, never a
-- raw IP (spec §8); server.db.purge_ip_hashes clears it after limits.ip_hash_retention_days.
-- queue_position, attached and retry_after_s are per-response values and are not stored.
CREATE TABLE IF NOT EXISTS jobs (
  id                TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  type              TEXT NOT NULL CHECK (type IN ('plan', 'siting', 'replan')),
  result_hash       TEXT NOT NULL CHECK (length(result_hash) = 16 AND result_hash NOT GLOB '*[^0-9a-f]*'),
  status            TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'error', 'timeout', 'refused')),
  stage             TEXT,
  progress          REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
  stages_done       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(stages_done) AND json_type(stages_done) = 'array'),
  error             TEXT,
  requester_ip_hash TEXT,
  created_utc       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  started_utc       TEXT,
  finished_utc      TEXT
);
CREATE INDEX IF NOT EXISTS jobs_result_hash_idx ON jobs (result_hash);
CREATE INDEX IF NOT EXISTS jobs_created_idx ON jobs (created_utc);
