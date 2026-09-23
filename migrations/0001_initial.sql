PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS races (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL UNIQUE,
  race_date TEXT NOT NULL,
  venue TEXT NOT NULL,
  race_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  corner_type TEXT,
  source_updated_at TEXT,
  synced_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  object_key TEXT NOT NULL,
  result_status TEXT NOT NULL DEFAULT 'pending',
  result_json TEXT,
  UNIQUE (race_date, venue, race_no)
);

CREATE INDEX IF NOT EXISTS races_date_venue_no
  ON races (race_date DESC, venue, race_no);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  listed INTEGER NOT NULL DEFAULT 0,
  imported INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  message TEXT
);

CREATE INDEX IF NOT EXISTS sync_runs_started
  ON sync_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS sync_state (
  state_key TEXT PRIMARY KEY,
  state_value TEXT NOT NULL
);

INSERT OR IGNORE INTO sync_state (state_key, state_value)
VALUES ('archive_cursor', '0');
