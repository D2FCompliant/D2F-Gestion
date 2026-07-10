-- 007_invoices.sql

PRAGMA foreign_keys = ON;

-- =========================================================
-- INVOICES : index utiles (ERP + perf)
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_invoices_client
  ON invoices(client_id);

CREATE INDEX IF NOT EXISTS idx_invoices_quote
  ON invoices(quote_id);

CREATE INDEX IF NOT EXISTS idx_invoices_status
  ON invoices(status);

CREATE INDEX IF NOT EXISTS idx_invoices_type
  ON invoices(type);

CREATE INDEX IF NOT EXISTS idx_invoices_date
  ON invoices(date);

-- Numéro de facture : unicité quand non NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number_unique
  ON invoices(invoice_number)
  WHERE invoice_number IS NOT NULL;

-- =========================================================
-- INVOICE_LINES : index
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice
  ON invoice_lines(invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_article
  ON invoice_lines(article_id);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_type
  ON invoice_lines(line_type);

-- =========================================================
-- INVOICE_LINKS : index
-- (la table est créée en 002_invoice_links.sql)
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_invoice_links_from
  ON invoice_links(from_invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_links_to
  ON invoice_links(to_invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_links_type
  ON invoice_links(link_type);
