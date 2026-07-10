-- 001_init.sql

PRAGMA foreign_keys = ON;

-- Registry migrations (si vous l’utilisez)
CREATE TABLE IF NOT EXISTS _migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- =========================================================
-- COMPANY (single row id=1)
-- =========================================================
CREATE TABLE IF NOT EXISTS company (
  id INTEGER PRIMARY KEY CHECK (id = 1),

  -- EN16931 seller core
  legal_name TEXT NOT NULL,                -- BT-27
  country TEXT NOT NULL DEFAULT 'FR',      -- ISO-2
  currency TEXT NOT NULL DEFAULT 'EUR',

  vat_id TEXT,
  legal_id TEXT,

  -- Address
  street TEXT,
  street2 TEXT,
  postal_code TEXT,
  city TEXT,
  state TEXT,

  -- Contact
  email TEXT,
  phone TEXT,

  -- Payment
  iban TEXT,
  bic TEXT,
  payment_terms TEXT,

  -- Peppol routing
  endpoint_id TEXT,
  endpoint_scheme TEXT,

  -- ERP config
  tax_regime TEXT DEFAULT 'STANDARD',
  vat_country_prefix TEXT DEFAULT 'FR',

  -- app meta
  use_case_code TEXT,
  use_case_meta_json TEXT NOT NULL DEFAULT '{}',
  meta_json TEXT NOT NULL DEFAULT '{}',

  -- logo (legacy + db)
  logo_path TEXT,
  logo_blob BLOB,
  logo_mime TEXT,
  logo_name TEXT,
  logo_updated_at TEXT,

  -- optional EN names
  seller_registration_name TEXT,
  seller_trade_name TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Ensure row exists (id=1)
INSERT OR IGNORE INTO company (id, legal_name, created_at, updated_at)
VALUES (1, 'Société', datetime('now'), datetime('now'));

-- =========================================================
-- CLIENTS (Buyer BG-7/BG-8)
-- =========================================================
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,

  name TEXT NOT NULL,                      -- BT-44
  customer_type TEXT NOT NULL DEFAULT 'B2B',  -- B2B|B2C|B2G
  vat_subject INTEGER NOT NULL DEFAULT 1,  -- 1 assujetti TVA / 0 non assujetti

  legal_id TEXT,
  vat_id TEXT,

  -- Address
  street TEXT,
  street2 TEXT,
  postal_code TEXT,
  city TEXT,
  state TEXT,
  country TEXT NOT NULL DEFAULT 'FR',

  -- Contact
  email TEXT,
  phone TEXT,

  -- EN / Peppol
  buyer_reference TEXT,                    -- BT-10 (souvent requis B2G)
  endpoint_id TEXT,
  endpoint_scheme TEXT,

  -- Flags (tax)
  reverse_charge INTEGER NOT NULL DEFAULT 0,
  self_billing INTEGER NOT NULL DEFAULT 0,
  vat_exempt_reason TEXT,
  vat_exempt_code TEXT,

  -- Payee (optional)
  payee_name TEXT,
  payee_iban TEXT,
  payee_bic TEXT,
  payee_mandate_ref TEXT,

  -- app meta
  use_case_code TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}',

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_clients_country ON clients(country);
CREATE INDEX IF NOT EXISTS idx_clients_vat_id ON clients(vat_id);
CREATE INDEX IF NOT EXISTS idx_clients_legal_id ON clients(legal_id);
CREATE INDEX IF NOT EXISTS idx_clients_type ON clients(customer_type);

-- =========================================================
-- ITEMS / ARTICLES (source lignes devis/factures)
-- (Votre code utilise "items" (pas "articles"))
-- =========================================================
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,

  ref TEXT,
  name TEXT NOT NULL,
  description TEXT,

  -- UN/ECE unit code (C62 etc.)
  unit_code TEXT NOT NULL DEFAULT 'C62',

  -- Pricing / VAT
  unit_price_ht REAL NOT NULL DEFAULT 0,
  tva_percent REAL NOT NULL DEFAULT 20,

  -- EN VAT category
  vat_category TEXT NOT NULL DEFAULT 'S',  -- S|Z|E|AE|O...
  vat_exempt_reason TEXT,
  vat_exempt_code TEXT,

  -- FR / reporting
  item_type TEXT NOT NULL DEFAULT 'SERVICE', -- GOODS|SERVICE
  active INTEGER NOT NULL DEFAULT 1,

  -- optional product/accounting
  product_code TEXT,
  classification_code TEXT,

  meta_json TEXT NOT NULL DEFAULT '{}',

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_ref ON items(ref);
CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
CREATE INDEX IF NOT EXISTS idx_items_active ON items(active);
CREATE INDEX IF NOT EXISTS idx_items_type ON items(item_type);

-- =========================================================
-- QUOTES / DEVIS
-- =========================================================
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,

  number TEXT,                               -- généré DYYYY-####
  status TEXT NOT NULL DEFAULT 'draft',      -- draft|sent|accepted|rejected|cancelled

  date TEXT NOT NULL,
  valid_until TEXT,

  currency TEXT NOT NULL DEFAULT 'EUR',
  client_id TEXT,
  notes TEXT,

  -- EN hooks
  buyer_reference TEXT,
  purchase_order_ref TEXT,
  contract_ref TEXT,

  vat_mode TEXT NOT NULL DEFAULT 'AUTO',     -- AUTO|VAT|NO_VAT|REVERSE_CHARGE|EXEMPT
  vat_exempt_reason TEXT,
  vat_exempt_code TEXT,

  use_case_code TEXT,
  use_case_meta_json TEXT NOT NULL DEFAULT '{}',
  meta_json TEXT NOT NULL DEFAULT '{}',

  totals_json TEXT,
  tax_breakdown_json TEXT,

  total_ht REAL NOT NULL DEFAULT 0,
  total_tva REAL NOT NULL DEFAULT 0,
  total_ttc REAL NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_number ON quotes(number);
CREATE INDEX IF NOT EXISTS idx_quotes_updated ON quotes(updated_at);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quotes_client ON quotes(client_id);

CREATE TABLE IF NOT EXISTS quote_lines (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL,

  article_id TEXT,       -- references items.id (legacy name kept for compatibility)
  article_ref TEXT,
  description TEXT NOT NULL,

  quantity REAL NOT NULL DEFAULT 1,
  unit_code TEXT NOT NULL DEFAULT 'C62',
  unit_price_ht REAL NOT NULL DEFAULT 0,
  remise_percent REAL NOT NULL DEFAULT 0,

  tva_percent REAL NOT NULL DEFAULT 20,
  vat_category TEXT NOT NULL DEFAULT 'S',
  vat_exempt_reason TEXT,
  vat_exempt_code TEXT,

  item_type TEXT NOT NULL DEFAULT 'SERVICE', -- GOODS|SERVICE
  line_type TEXT NOT NULL DEFAULT 'standard', -- standard|adjustment

  total_ht REAL NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,

  created_at TEXT,
  updated_at TEXT,

  FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_quote_lines_quote ON quote_lines(quote_id);

-- =========================================================
-- INVOICES
-- =========================================================
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,

  quote_id TEXT,
  client_id TEXT,

  type TEXT NOT NULL DEFAULT 'final',        -- final|deposit|credit_note
  status TEXT NOT NULL DEFAULT 'draft',      -- draft|issued|cancelled

  invoice_number TEXT,                       -- attribué à l'émission (issue)
  date TEXT NOT NULL,
  due_date TEXT,

  currency TEXT NOT NULL DEFAULT 'EUR',
  notes TEXT,

  -- EN hooks
  buyer_reference TEXT,
  purchase_order_ref TEXT,
  contract_ref TEXT,

  vat_mode TEXT NOT NULL DEFAULT 'AUTO',     -- AUTO|VAT|NO_VAT|REVERSE_CHARGE|EXEMPT
  vat_exempt_reason TEXT,
  vat_exempt_code TEXT,

  source_invoice_id TEXT,                    -- avoir -> facture source

  use_case_code TEXT,
  use_case_meta_json TEXT NOT NULL DEFAULT '{}',
  meta_json TEXT NOT NULL DEFAULT '{}',

  totals_json TEXT,
  tax_breakdown_json TEXT,

  total_ht REAL NOT NULL DEFAULT 0,
  total_tva REAL NOT NULL DEFAULT 0,
  total_ttc REAL NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE SET NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_updated ON invoices(updated_at);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,

  article_id TEXT,       -- references items.id (legacy name kept for compatibility)
  article_ref TEXT,
  description TEXT NOT NULL,

  quantity REAL NOT NULL DEFAULT 1,
  unit_code TEXT NOT NULL DEFAULT 'C62',
  unit_price_ht REAL NOT NULL DEFAULT 0,
  remise_percent REAL NOT NULL DEFAULT 0,

  tva_percent REAL NOT NULL DEFAULT 20,
  vat_category TEXT NOT NULL DEFAULT 'S',
  vat_exempt_reason TEXT,
  vat_exempt_code TEXT,

  item_type TEXT NOT NULL DEFAULT 'SERVICE', -- GOODS|SERVICE
  line_type TEXT NOT NULL DEFAULT 'standard', -- standard|adjustment

  total_ht REAL NOT NULL DEFAULT 0,

  created_at TEXT,
  updated_at TEXT,

  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);

-- =========================================================
-- INVOICE LINKS (avoir / acompte / complément)
-- =========================================================
CREATE TABLE IF NOT EXISTS invoice_links (
  id TEXT PRIMARY KEY,
  from_invoice_id TEXT NOT NULL,
  to_invoice_id TEXT NOT NULL,
  link_type TEXT NOT NULL,  -- credit_of|prepayment_of|final_of|other
  created_at TEXT NOT NULL,
  FOREIGN KEY (from_invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (to_invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_invoice_links_from ON invoice_links(from_invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_links_to ON invoice_links(to_invoice_id);
