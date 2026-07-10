-- !preview conn=DBI::dbConnect(RSQLite::SQLite())

-- 030_outbound.sql

CREATE TABLE IF NOT EXISTS outbound_documents (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,

  direction TEXT NOT NULL DEFAULT 'OUT', -- OUT
  scope TEXT NOT NULL,                   -- FR | INTL
  channel TEXT NOT NULL,                 -- PPF | PDP | PEPPOL | API
  platform TEXT,                         -- nom PA/PDP

  format TEXT NOT NULL,                  -- UBL | CII | FACTURX
  status TEXT NOT NULL DEFAULT 'PENDING',
  -- PENDING | SENT | ACK | ACCEPTED | REJECTED | ERROR

  sent_at TEXT,
  ack_at TEXT,

  payload BLOB,
  response_json TEXT,
  error_json TEXT,

  created_at TEXT NOT NULL,

  FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_outbound_invoice
  ON outbound_documents(invoice_id);

CREATE INDEX IF NOT EXISTS idx_outbound_status
  ON outbound_documents(status);
