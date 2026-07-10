-- !preview conn=DBI::dbConnect(RSQLite::SQLite())

-- 040_connectors.sql

CREATE TABLE IF NOT EXISTS connectors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,         -- PPF, Chorus, PDP X, PEPPOL
  country TEXT,               -- FR, RS, ES, INTL
  kind TEXT NOT NULL,         -- PPF | PDP | PEPPOL | API
  endpoint TEXT,
  auth_type TEXT,             -- OAuth2 | Cert | APIKEY
  enabled INTEGER NOT NULL DEFAULT 1,

  last_ping_at TEXT,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error TEXT,

  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_connectors_name
  ON connectors(name);

