-- !preview conn=DBI::dbConnect(RSQLite::SQLite())

-- 003_reporting_fr.sql
-- E-reporting France (DGFIP) - base ERP stable
-- Objectif: stocker les données nécessaires pour préparer les fichiers:
--  - B2C : données de vente + encaissement (cumul par période)  => F9 / F10
--  - B2B international : données de vente (et éventuellement encaissement) => F8 / F10
--
-- IMPORTANT:
-- - Ce fichier NE génère PAS les fichiers officiels (format XML/EDI etc.).
-- - Il crée une couche de "journal" + "agrégats" robuste, exploitable par ton code.
-- - Idempotent, sans ALTER (safe sur DB neuve). A exécuter après 001 et 002.

PRAGMA foreign_keys = ON;

-- =========================================================
-- ENUMS (documentés)
-- =========================================================
-- reporting_period_type: '10D' | 'MONTH' | 'QUARTER'
-- reporting_flow:        'SALE' | 'PAYMENT' | 'REFUND'
-- reporting_scope:       'B2C' | 'B2B_INTL'
-- buyer_country: ISO2
-- currency: ISO3
-- vat_mode: 'VAT' | 'NO_VAT' | 'REVERSE_CHARGE' | 'EXEMPT' | 'AUTO'
-- item_type: 'GOODS' | 'SERVICE'
-- payment_method: 'CASH'|'CARD'|'TRANSFER'|'CHECK'|'OTHER'

-- =========================================================
-- 1) Journal normalisé des évènements e-reporting
--    (source de vérité pour calculs / exports)
-- =========================================================
CREATE TABLE IF NOT EXISTS reporting_events (
  id TEXT PRIMARY KEY,

  -- Liens documentaires (vente)
  invoice_id TEXT,           -- facture émise (ou facture d'avoir)
  invoice_number TEXT,
  invoice_date TEXT,         -- YYYY-MM-DD
  invoice_type TEXT,         -- final|deposit|credit_note
  invoice_status TEXT,       -- issued|cancelled|...

  -- Client / buyer
  client_id TEXT,
  customer_type TEXT,        -- B2B|B2C|B2G (copie au moment de l'évènement)
  buyer_country TEXT,        -- ISO2
  buyer_vat_id TEXT,         -- si applicable

  -- Scope DGFIP
  reporting_scope TEXT NOT NULL,  -- B2C | B2B_INTL
  reporting_flow  TEXT NOT NULL,  -- SALE | PAYMENT | REFUND

  -- Montants (toujours en devise du document)
  currency TEXT NOT NULL DEFAULT 'EUR',
  amount_ht REAL NOT NULL DEFAULT 0,
  amount_tva REAL NOT NULL DEFAULT 0,
  amount_ttc REAL NOT NULL DEFAULT 0,

  -- TVA / catégories - snapshot agrégé
  vat_mode TEXT DEFAULT 'AUTO',
  vat_breakdown_json TEXT DEFAULT '{}',   -- ex: { "S|20.00": {"base":100,"vat":20}, ... }

  -- Goods/Services - snapshot agrégé
  goods_services_json TEXT DEFAULT '{}',  -- ex: {"GOODS": 120, "SERVICE": 0} en TTC ou HT selon ton choix (documenté côté code)

  -- Références paiement (si flow=PAYMENT/REFUND)
  payment_id TEXT,
  payment_method TEXT,
  payment_date TEXT,              -- YYYY-MM-DD
  payment_ref TEXT,

  -- Métadonnées
  meta_json TEXT DEFAULT '{}',

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
  FOREIGN KEY (client_id)  REFERENCES clients(id)  ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reporting_events_invoice   ON reporting_events(invoice_id);
CREATE INDEX IF NOT EXISTS idx_reporting_events_client    ON reporting_events(client_id);
CREATE INDEX IF NOT EXISTS idx_reporting_events_scope     ON reporting_events(reporting_scope);
CREATE INDEX IF NOT EXISTS idx_reporting_events_flow      ON reporting_events(reporting_flow);
CREATE INDEX IF NOT EXISTS idx_reporting_events_inv_date  ON reporting_events(invoice_date);
CREATE INDEX IF NOT EXISTS idx_reporting_events_pay_date  ON reporting_events(payment_date);

-- =========================================================
-- 2) Définition des périodes de reporting (10 jours / mois / trimestre)
-- =========================================================
CREATE TABLE IF NOT EXISTS reporting_periods (
  id TEXT PRIMARY KEY,

  period_type TEXT NOT NULL,     -- 10D|MONTH|QUARTER
  start_date TEXT NOT NULL,      -- YYYY-MM-DD
  end_date   TEXT NOT NULL,      -- YYYY-MM-DD (inclusif)
  label TEXT,                    -- ex: 2025-01-P1 / 2025-01 / 2025-Q1

  -- état de génération / export (géré par app)
  status TEXT NOT NULL DEFAULT 'open',  -- open|locked|exported|cancelled

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reporting_periods_unique
  ON reporting_periods(period_type, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_reporting_periods_status
  ON reporting_periods(status);

-- =========================================================
-- 3) Agrégats par période (pré-calcul pour exports)
--    -> on évite de recalculer à chaque fois
-- =========================================================
CREATE TABLE IF NOT EXISTS reporting_aggregates (
  id TEXT PRIMARY KEY,

  period_id TEXT NOT NULL,
  reporting_scope TEXT NOT NULL,     -- B2C|B2B_INTL
  currency TEXT NOT NULL DEFAULT 'EUR',

  -- Dimensions principales (minimum utile)
  buyer_country TEXT,                -- obligatoire pour B2B_INTL
  vat_mode TEXT,                     -- VAT|NO_VAT|REVERSE_CHARGE|EXEMPT|AUTO
  item_type TEXT,                    -- GOODS|SERVICE|NULL (si mix => calcul côté code)

  -- Totaux cumulés
  sales_count INTEGER NOT NULL DEFAULT 0,
  sales_ht REAL NOT NULL DEFAULT 0,
  sales_tva REAL NOT NULL DEFAULT 0,
  sales_ttc REAL NOT NULL DEFAULT 0,

  payments_count INTEGER NOT NULL DEFAULT 0,
  payments_amount REAL NOT NULL DEFAULT 0,

  refunds_count INTEGER NOT NULL DEFAULT 0,
  refunds_amount REAL NOT NULL DEFAULT 0,

  -- Snapshots d'analyse
  vat_breakdown_json TEXT DEFAULT '{}',
  goods_services_json TEXT DEFAULT '{}',

  meta_json TEXT DEFAULT '{}',

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (period_id) REFERENCES reporting_periods(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reporting_aggr_period ON reporting_aggregates(period_id);
CREATE INDEX IF NOT EXISTS idx_reporting_aggr_scope  ON reporting_aggregates(reporting_scope);
CREATE INDEX IF NOT EXISTS idx_reporting_aggr_country ON reporting_aggregates(buyer_country);

-- Unicité logique (une ligne par dimension)
CREATE UNIQUE INDEX IF NOT EXISTS idx_reporting_aggr_unique
  ON reporting_aggregates(period_id, reporting_scope, currency, buyer_country, vat_mode, item_type);

-- =========================================================
-- 4) Trace des exports (audit)
-- =========================================================
CREATE TABLE IF NOT EXISTS reporting_exports (
  id TEXT PRIMARY KEY,

  period_id TEXT NOT NULL,
  exported_at TEXT NOT NULL,

  -- type d’export (ex: "DGFIP_F8", "DGFIP_F9", "DGFIP_F10")
  export_type TEXT NOT NULL,

  -- hash / checksum / chemin fichier (si tu stockes localement)
  file_name TEXT,
  file_sha256 TEXT,
  file_path TEXT,

  meta_json TEXT DEFAULT '{}',

  FOREIGN KEY (period_id) REFERENCES reporting_periods(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reporting_exports_period ON reporting_exports(period_id);
CREATE INDEX IF NOT EXISTS idx_reporting_exports_type ON reporting_exports(export_type);

-- =========================================================
-- 5) Optionnel: vue utile pour debug (lecture)
-- =========================================================
CREATE VIEW IF NOT EXISTS v_reporting_events_min AS
SELECT
  e.id,
  e.reporting_scope,
  e.reporting_flow,
  e.invoice_date,
  e.payment_date,
  e.currency,
  e.amount_ttc,
  e.buyer_country,
  e.customer_type,
  e.invoice_number,
  e.invoice_type,
  e.client_id
FROM reporting_events e;

