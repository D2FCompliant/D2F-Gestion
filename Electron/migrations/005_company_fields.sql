-- 005_company_fields.sql
PRAGMA foreign_keys = ON;

-- =========================================================
-- COMPANY – champs UI (CGV / Banque / Logo / TVA régime)
-- Compatible avec ton runner de migrations (ignore "duplicate column").
-- =========================================================

-- Régime TVA DGFiP (utilisé par ton UI: co-vat-regime)
ALTER TABLE company ADD COLUMN vat_regime TEXT DEFAULT 'REAL_NORMAL_MONTHLY';

-- CGV imprimées sur PDF
ALTER TABLE company ADD COLUMN cgv_text TEXT;

-- Banque (labels imprimés sur PDF)
ALTER TABLE company ADD COLUMN bank_name   TEXT;
ALTER TABLE company ADD COLUMN bank_holder TEXT;
ALTER TABLE company ADD COLUMN bank_extra  TEXT;

-- Afficher logo sur PDF (0/1)
ALTER TABLE company ADD COLUMN show_logo INTEGER NOT NULL DEFAULT 1;

-- ---------------------------------------------------------
-- Backfill (si une DB existante a déjà la colonne mais NULL)
-- ---------------------------------------------------------
UPDATE company SET vat_regime = 'REAL_NORMAL_MONTHLY'
WHERE vat_regime IS NULL OR TRIM(vat_regime) = '';

UPDATE company SET show_logo = 1
WHERE show_logo IS NULL;

UPDATE company SET cgv_text = ''
WHERE cgv_text IS NULL;

UPDATE company SET bank_name = ''
WHERE bank_name IS NULL;

UPDATE company SET bank_holder = ''
WHERE bank_holder IS NULL;

UPDATE company SET bank_extra = ''
WHERE bank_extra IS NULL;
