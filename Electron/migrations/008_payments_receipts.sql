-- !preview conn=DBI::dbConnect(RSQLite::SQLite())

-- 004_payments_receipts.sql
-- Encaissements (B2C indispensable) + rapprochement facture (B2B/B2C) + base pour exports
-- Compatible avec 001_init.sql + 002_invoice_links.sql + IPC existants (sans toucher au design)

PRAGMA foreign_keys = ON;

-- =========================================================
-- PAYMENTS (encaissements)
-- Un paiement peut être:
--  - affecté à une facture (B2B/B2C)
--  - affecté partiellement à plusieurs factures (allocations)
--  - enregistré sans facture (vente comptoir / B2C), puis rapproché plus tard
-- =========================================================
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,

  -- liens
  client_id TEXT,                 -- nullable (ex: vente comptoir sans client)
  invoice_id TEXT,                -- nullable (si paiement direct sur facture)
  invoice_number TEXT,            -- snapshot (utile si invoice_id devient NULL)

  -- dates
  payment_date TEXT NOT NULL,     -- YYYY-MM-DD
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  -- montants
  currency TEXT NOT NULL DEFAULT 'EUR',
  amount REAL NOT NULL DEFAULT 0,         -- montant encaissé (positif)
  direction TEXT NOT NULL DEFAULT 'in',   -- in|out (out = remboursement)

  -- méthode
  method TEXT NOT NULL DEFAULT 'OTHER',   -- CASH|CARD|TRANSFER|CHECK|OTHER
  reference TEXT,                         -- ref bancaire, ticket CB, etc.

  -- état
  status TEXT NOT NULL DEFAULT 'posted',  -- posted|reconciled|cancelled

  -- contexte FR e-reporting
  sales_channel TEXT,                     -- POS|ONLINE|OTHER (optionnel)
  location_country TEXT,                  -- ISO2 (lieu d’encaissement si différent)
  meta_json TEXT NOT NULL DEFAULT '{}',

  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_date      ON payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_client    ON payments(client_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice   ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_status    ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_method    ON payments(method);

-- =========================================================
-- PAYMENT_ALLOCATIONS
-- Permet d'affecter un paiement à 1..n factures
-- (utile si paiement reçu global puis réparti)
-- =========================================================
CREATE TABLE IF NOT EXISTS payment_allocations (
  id TEXT PRIMARY KEY,

  payment_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,

  -- montant affecté à cette facture
  currency TEXT NOT NULL DEFAULT 'EUR',
  amount REAL NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL,

  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_payment_alloc_payment ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_alloc_invoice ON payment_allocations(invoice_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_alloc_unique
  ON payment_allocations(payment_id, invoice_id);

-- =========================================================
-- RECEIPTS (tickets / justificatifs B2C)
-- Stocke un "reçu" B2C (peut être lié à une facture ou autonome)
-- Sert à reconstituer les encaissements/ventes en cas de caisse
-- =========================================================
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,

  receipt_number TEXT,                 -- num ticket caisse (optionnel)
  receipt_date TEXT NOT NULL,          -- YYYY-MM-DD

  -- liens
  client_id TEXT,
  invoice_id TEXT,                     -- si un reçu correspond à une facture
  payment_id TEXT,                     -- si un reçu correspond à un paiement

  -- montants (snapshot)
  currency TEXT NOT NULL DEFAULT 'EUR',
  total_ht REAL NOT NULL DEFAULT 0,
  total_tva REAL NOT NULL DEFAULT 0,
  total_ttc REAL NOT NULL DEFAULT 0,

  -- TVA & goods/services snapshot (facilite e-reporting)
  vat_breakdown_json TEXT NOT NULL DEFAULT '{}',
  goods_services_json TEXT NOT NULL DEFAULT '{}',

  -- méthode encaissement (snapshot)
  payment_method TEXT NOT NULL DEFAULT 'OTHER',
  payment_reference TEXT,

  -- meta
  meta_json TEXT NOT NULL DEFAULT '{}',

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_receipts_date     ON receipts(receipt_date);
CREATE INDEX IF NOT EXISTS idx_receipts_client   ON receipts(client_id);
CREATE INDEX IF NOT EXISTS idx_receipts_invoice  ON receipts(invoice_id);
CREATE INDEX IF NOT EXISTS idx_receipts_payment  ON receipts(payment_id);

-- Unicité ticket si tu le fournis (prévention doublons caisse)
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_number
  ON receipts(receipt_number);

-- =========================================================
-- OPTIONAL: Vue de rapprochement "solde facture"
-- (utile côté app sans recalcul lourd)
-- =========================================================
CREATE VIEW IF NOT EXISTS v_invoice_paid_amount AS
SELECT
  i.id AS invoice_id,
  i.invoice_number,
  i.client_id,
  i.total_ttc,
  COALESCE((
    SELECT SUM(pa.amount)
    FROM payment_allocations pa
    WHERE pa.invoice_id = i.id
  ), 0) +
  COALESCE((
    SELECT SUM(p.amount)
    FROM payments p
    WHERE p.invoice_id = i.id AND p.status != 'cancelled'
  ), 0) AS paid_amount
FROM invoices i;

-- =========================================================
-- OPTIONAL: Vue "reste à payer"
-- =========================================================
CREATE VIEW IF NOT EXISTS v_invoice_balance AS
SELECT
  v.invoice_id,
  v.invoice_number,
  v.client_id,
  v.total_ttc,
  v.paid_amount,
  (v.total_ttc - v.paid_amount) AS balance_due
FROM v_invoice_paid_amount v;

