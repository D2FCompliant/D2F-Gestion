-- !preview conn=DBI::dbConnect(RSQLite::SQLite())

-- inbound documents (raw source of truth)
CREATE TABLE IF NOT EXISTS inbound_documents (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,          -- SFTP|WEBHOOK|GATEWAY
  source_name TEXT NOT NULL,          -- host/account/pdp name
  received_at TEXT NOT NULL,
  format TEXT NOT NULL,               -- UBL|CII|FACTURX|UNKNOWN
  content_type TEXT,
  filename TEXT,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RECEIVED',  -- RECEIVED|VALIDATED|ERROR|IMPORTED
  payload BLOB NOT NULL,
  meta_json TEXT,
  errors_json TEXT,
  warnings_json TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_documents_sha
  ON inbound_documents(source_type, source_name, sha256);

CREATE INDEX IF NOT EXISTS idx_inbound_documents_received
  ON inbound_documents(received_at);

-- canonical invoice extracted from raw
CREATE TABLE IF NOT EXISTS inbound_invoices (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,

  invoice_number TEXT,
  issue_date TEXT,
  currency TEXT,

  seller_json TEXT,
  buyer_json TEXT,
  totals_json TEXT,
  lines_json TEXT,

  created_at TEXT NOT NULL,

  FOREIGN KEY(document_id) REFERENCES inbound_documents(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_invoices_doc
  ON inbound_invoices(document_id);

-- audit/event log (append-only)
CREATE TABLE IF NOT EXISTS inbound_events (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT,
  FOREIGN KEY(document_id) REFERENCES inbound_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inbound_events_doc
  ON inbound_events(document_id, at);
