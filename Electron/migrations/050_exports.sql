-- !preview conn=DBI::dbConnect(RSQLite::SQLite())

-- 050_exports.sql

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL, -- invoice | quote
  entity_id TEXT NOT NULL,
  format TEXT NOT NULL,      -- PDF | UBL | XML
  locale TEXT,
  path TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exports_entity
  ON exports(entity_type, entity_id);

