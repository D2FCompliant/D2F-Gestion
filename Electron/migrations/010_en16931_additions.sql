-- 010_en16931_additions.sql
PRAGMA foreign_keys = ON;

-- =========================================================
-- COMPANY: ajouts EN16931/PEPPOL + logo DB
-- =========================================================
ALTER TABLE company ADD COLUMN iban TEXT;
ALTER TABLE company ADD COLUMN bic TEXT;
ALTER TABLE company ADD COLUMN payment_terms TEXT;

ALTER TABLE company ADD COLUMN endpoint_id TEXT;
ALTER TABLE company ADD COLUMN endpoint_scheme TEXT;

ALTER TABLE company ADD COLUMN tax_regime TEXT DEFAULT 'STANDARD';
ALTER TABLE company ADD COLUMN vat_country_prefix TEXT DEFAULT 'FR';

ALTER TABLE company ADD COLUMN meta_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE company ADD COLUMN logo_blob BLOB;
ALTER TABLE company ADD COLUMN logo_mime TEXT;
ALTER TABLE company ADD COLUMN logo_name TEXT;
ALTER TABLE company ADD COLUMN logo_updated_at TEXT;

ALTER TABLE company ADD COLUMN seller_registration_name TEXT;
ALTER TABLE company ADD COLUMN seller_trade_name TEXT;

-- =========================================================
-- CLIENTS: champs Peppol/EN
-- =========================================================
ALTER TABLE clients ADD COLUMN buyer_reference TEXT;
ALTER TABLE clients ADD COLUMN endpoint_id TEXT;
ALTER TABLE clients ADD COLUMN endpoint_scheme TEXT;

-- =========================================================
-- ITEMS: goods/service + catégorie TVA
-- =========================================================
ALTER TABLE items ADD COLUMN vat_category TEXT NOT NULL DEFAULT 'S';
ALTER TABLE items ADD COLUMN vat_exempt_reason TEXT;
ALTER TABLE items ADD COLUMN vat_exempt_code TEXT;

ALTER TABLE items ADD COLUMN item_type TEXT NOT NULL DEFAULT 'SERVICE';  -- GOODS|SERVICE
ALTER TABLE items ADD COLUMN active INTEGER NOT NULL DEFAULT 1;

ALTER TABLE items ADD COLUMN meta_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_items_active ON items(active);
CREATE INDEX IF NOT EXISTS idx_items_type ON items(item_type);

-- =========================================================
-- QUOTES: métadonnées EN
-- =========================================================
ALTER TABLE quotes ADD COLUMN buyer_reference TEXT;
ALTER TABLE quotes ADD COLUMN purchase_order_ref TEXT;
ALTER TABLE quotes ADD COLUMN contract_ref TEXT;

ALTER TABLE quotes ADD COLUMN vat_mode TEXT NOT NULL DEFAULT 'AUTO';
ALTER TABLE quotes ADD COLUMN vat_exempt_reason TEXT;
ALTER TABLE quotes ADD COLUMN vat_exempt_code TEXT;

ALTER TABLE quotes ADD COLUMN use_case_code TEXT;
ALTER TABLE quotes ADD COLUMN use_case_meta_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE quotes ADD COLUMN totals_json TEXT;
ALTER TABLE quotes ADD COLUMN tax_breakdown_json TEXT;

-- =========================================================
-- INVOICES: métadonnées EN
-- =========================================================
ALTER TABLE invoices ADD COLUMN buyer_reference TEXT;
ALTER TABLE invoices ADD COLUMN purchase_order_ref TEXT;
ALTER TABLE invoices ADD COLUMN contract_ref TEXT;

ALTER TABLE invoices ADD COLUMN vat_mode TEXT NOT NULL DEFAULT 'AUTO';
ALTER TABLE invoices ADD COLUMN vat_exempt_reason TEXT;
ALTER TABLE invoices ADD COLUMN vat_exempt_code TEXT;

ALTER TABLE invoices ADD COLUMN source_invoice_id TEXT;

ALTER TABLE invoices ADD COLUMN totals_json TEXT;
ALTER TABLE invoices ADD COLUMN tax_breakdown_json TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);
