-- 004_clients_ext.sql
PRAGMA foreign_keys = ON;

-- Ajouts EN16931/PEPPOL + TVA (SQLite compatible: pas de IF NOT EXISTS)
-- ATTENTION: ces ALTER échouent si la colonne existe déjà.
-- Dans ton système de migrations, ce fichier ne s'applique qu'une fois (DB propre).

-- Typologie client (B2B|B2C|B2G) + compat UI/IPC
ALTER TABLE clients ADD COLUMN customer_type TEXT NOT NULL DEFAULT 'B2B';

-- Colonne attendue par tes IPC (clients.ipc.js): vat_subject (1/0)
-- On garde is_vat_subject existant (001_init) pour compat, et on alimente vat_subject ensuite côté app si besoin.
ALTER TABLE clients ADD COLUMN vat_subject INTEGER NOT NULL DEFAULT 1;

-- EN16931 / Peppol
ALTER TABLE clients ADD COLUMN buyer_reference TEXT;
ALTER TABLE clients ADD COLUMN endpoint_id TEXT;
ALTER TABLE clients ADD COLUMN endpoint_scheme TEXT;

-- TVA / cas particuliers
ALTER TABLE clients ADD COLUMN reverse_charge INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN self_billing INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN vat_exempt_reason TEXT;
ALTER TABLE clients ADD COLUMN vat_exempt_code TEXT;

-- Payee (optionnel)
ALTER TABLE clients ADD COLUMN payee_name TEXT;
ALTER TABLE clients ADD COLUMN payee_iban TEXT;
ALTER TABLE clients ADD COLUMN payee_bic TEXT;
ALTER TABLE clients ADD COLUMN payee_mandate_ref TEXT;

-- App meta
ALTER TABLE clients ADD COLUMN use_case_code TEXT;

-- Index (idempotent)
CREATE INDEX IF NOT EXISTS idx_clients_country        ON clients(country);
CREATE INDEX IF NOT EXISTS idx_clients_vat_id         ON clients(vat_id);
CREATE INDEX IF NOT EXISTS idx_clients_legal_id       ON clients(legal_id);
CREATE INDEX IF NOT EXISTS idx_clients_customer_type  ON clients(customer_type);
CREATE INDEX IF NOT EXISTS idx_clients_buyer_ref      ON clients(buyer_reference);
