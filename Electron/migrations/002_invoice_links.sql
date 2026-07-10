-- 002_invoice_links.sql
-- Migration complémentaire : liens entre factures
-- Compatible avec 001_init.sql + invoices.ipc.js
-- (idempotent, stable, EN16931 / ERP compliant)

PRAGMA foreign_keys = ON;

-- =========================================================
-- INVOICE LINKS
-- Permet de lier :
--  - avoir → facture d’origine        (credit_of)
--  - facture finale → acompte         (final_of / deposit_of)
--  - facture complémentaire           (supplement_of)
--  - autres relations métiers
-- =========================================================
CREATE TABLE IF NOT EXISTS invoice_links (
  id TEXT PRIMARY KEY,

  from_invoice_id TEXT NOT NULL,
  to_invoice_id   TEXT NOT NULL,

  -- Types autorisés (logique applicative)
  -- credit_of      : avoir → facture
  -- deposit_of     : acompte → facture/devis
  -- final_of       : facture finale → acompte(s)
  -- supplement_of : facture complémentaire
  -- other          : extension future
  link_type TEXT NOT NULL,

  created_at TEXT NOT NULL,

  FOREIGN KEY (from_invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (to_invoice_id)   REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_invoice_links_from
  ON invoice_links(from_invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_links_to
  ON invoice_links(to_invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_links_type
  ON invoice_links(link_type);
