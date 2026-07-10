// Electron/db/index.js
"use strict";

/**
 * SQLite DB bootstrap + migrations (stable / idempotent)
 * - Uses better-sqlite3
 * - Enforces PRAGMA foreign_keys = ON
 * - Provides:
 *    - getDb()
 *    - nowIso()
 *    - applyMigrations(db)
 *
 * IMPORTANT:
 * - Non-destructive: never drops tables.
 * - Compatible with your current schema (the SQL you pasted) + the IPC files we built:
 *   company.ipc.js / clients.ipc.js / items.ipc.js / quotes.ipc.js / invoices.ipc.js
 */

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { app } = require("electron");

let _db = null;

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function tableExists(db, name) {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
    .get(name);
}

function columnSet(db, table) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return new Set(rows.map((r) => r.name));
}

function addColumnIfMissing(db, table, col, typeAndDefault) {
  if (!tableExists(db, table)) return;
  const cols = columnSet(db, table);
  if (cols.has(col)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${typeAndDefault};`);
}

function createMigrationsRegistry(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

function isMigrationApplied(db, id) {
  return !!db.prepare("SELECT 1 FROM _migrations WHERE id=?").get(id);
}

function markMigrationApplied(db, id) {
  db.prepare("INSERT OR IGNORE INTO _migrations (id, applied_at) VALUES (?, ?)").run(id, nowIso());
}

/**
 * Baseline schema (matches the SQL you pasted) + minimal additions for ERP fields.
 * We keep baseline names (postal vs postal_code) aligned by adding missing columns,
 * not by renaming.
 */
function migration_0001_baseline(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS company (
      id TEXT PRIMARY KEY,
      name TEXT,
      legal_id TEXT,
      vat_id TEXT,
      street TEXT,
      street2 TEXT,
      postal TEXT,
      city TEXT,
      country TEXT,
      email TEXT,
      phone TEXT,
      logo_path TEXT,
      meta_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      vat_subject INTEGER DEFAULT 1,
      vat_id TEXT,
      legal_id TEXT,
      street TEXT,
      street2 TEXT,
      postal TEXT,
      city TEXT,
      country TEXT DEFAULT 'FR',
      meta_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      ref TEXT,
      name TEXT NOT NULL,
      description TEXT,
      unit_code TEXT DEFAULT 'C62',
      unit_price_ht REAL DEFAULT 0,
      tva_percent REAL DEFAULT 20,
      meta_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_items_ref ON items(ref);

    CREATE TABLE IF NOT EXISTS quotes (
      id TEXT PRIMARY KEY,
      number TEXT,
      status TEXT DEFAULT 'draft',
      date TEXT,
      currency TEXT DEFAULT 'EUR',
      client_id TEXT,
      notes TEXT,
      meta_json TEXT DEFAULT '{}',
      total_ht REAL DEFAULT 0,
      total_tva REAL DEFAULT 0,
      total_ttc REAL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_quotes_updated ON quotes(updated_at);

    CREATE TABLE IF NOT EXISTS quote_lines (
      id TEXT PRIMARY KEY,
      quote_id TEXT NOT NULL,
      article_id TEXT,
      article_ref TEXT,
      description TEXT,
      quantity REAL DEFAULT 1,
      unit_code TEXT DEFAULT 'C62',
      unit_price_ht REAL DEFAULT 0,
      remise_percent REAL DEFAULT 0,
      tva_percent REAL DEFAULT 20,
      total_ht REAL DEFAULT 0,
      position INTEGER DEFAULT 0,
      FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE,
      FOREIGN KEY (article_id) REFERENCES items(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_quote_lines_quote ON quote_lines(quote_id);

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      quote_id TEXT,
      client_id TEXT,
      type TEXT DEFAULT 'final',
      status TEXT DEFAULT 'draft',
      invoice_number TEXT,
      date TEXT,
      due_date TEXT,
      currency TEXT DEFAULT 'EUR',
      notes TEXT,
      use_case_code TEXT,
      use_case_meta_json TEXT DEFAULT '{}',
      meta_json TEXT DEFAULT '{}',
      total_ht REAL DEFAULT 0,
      total_tva REAL DEFAULT 0,
      total_ttc REAL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE SET NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_invoices_updated ON invoices(updated_at);

    CREATE TABLE IF NOT EXISTS invoice_lines (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      article_id TEXT,
      article_ref TEXT,
      description TEXT,
      quantity REAL DEFAULT 1,
      unit_code TEXT DEFAULT 'C62',
      unit_price_ht REAL DEFAULT 0,
      remise_percent REAL DEFAULT 0,
      tva_percent REAL DEFAULT 20,
      line_type TEXT DEFAULT 'standard',
      total_ht REAL DEFAULT 0,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
      FOREIGN KEY (article_id) REFERENCES items(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);

    CREATE TABLE IF NOT EXISTS invoice_links (
      id TEXT PRIMARY KEY,
      from_invoice_id TEXT NOT NULL,
      to_invoice_id TEXT NOT NULL,
      link_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (from_invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
      FOREIGN KEY (to_invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_invoice_links_from ON invoice_links(from_invoice_id);
    CREATE INDEX IF NOT EXISTS idx_invoice_links_to ON invoice_links(to_invoice_id);
  `);

  // Ensure single company row exists (id=1 by convention)
  const t = nowIso();
  const exists = db.prepare("SELECT 1 FROM company WHERE id='1'").get();
  if (!exists) {
    db.prepare(
      "INSERT INTO company (id, created_at, updated_at, meta_json) VALUES ('1', ?, ?, '{}')"
    ).run(t, t);
  }
}

/**
 * Add ERP/EN16931/Peppol columns used by IPC modules.
 * We do not rename existing columns; we add compatible aliases:
 * - company uses postal_code in IPC, baseline uses postal -> we add postal_code column (and keep postal).
 * - clients uses postal_code in IPC, baseline uses postal -> we add postal_code.
 */
function migration_0002_add_en_fields(db) {
  // COMPANY compatibility (company.ipc.js)
  addColumnIfMissing(db, "company", "legal_name", "TEXT");
  addColumnIfMissing(db, "company", "currency", "TEXT DEFAULT 'EUR'");
  addColumnIfMissing(db, "company", "state", "TEXT");

  addColumnIfMissing(db, "company", "postal_code", "TEXT");
  addColumnIfMissing(db, "company", "endpoint_id", "TEXT");
  addColumnIfMissing(db, "company", "endpoint_scheme", "TEXT");

  addColumnIfMissing(db, "company", "iban", "TEXT");
  addColumnIfMissing(db, "company", "bic", "TEXT");

  addColumnIfMissing(db, "company", "payment_terms", "TEXT");
  addColumnIfMissing(db, "company", "cgv_text", "TEXT DEFAULT ''");
  addColumnIfMissing(db, "company", "tax_regime", "TEXT DEFAULT 'STANDARD'");
  addColumnIfMissing(db, "company", "vat_country_prefix", "TEXT DEFAULT 'FR'");

  // Logo blob fields (company.ipc.js)
  addColumnIfMissing(db, "company", "logo_blob", "BLOB");
  addColumnIfMissing(db, "company", "logo_mime", "TEXT");
  addColumnIfMissing(db, "company", "logo_name", "TEXT");
  addColumnIfMissing(db, "company", "logo_updated_at", "TEXT");

  addColumnIfMissing(db, "company", "use_case_code", "TEXT");
  addColumnIfMissing(db, "company", "use_case_meta_json", "TEXT DEFAULT '{}'");
  addColumnIfMissing(db, "company", "seller_registration_name", "TEXT");
  addColumnIfMissing(db, "company", "seller_trade_name", "TEXT");

  // CLIENTS compatibility (clients.ipc.js)
  addColumnIfMissing(db, "clients", "postal_code", "TEXT");
  addColumnIfMissing(db, "clients", "state", "TEXT");

  addColumnIfMissing(db, "clients", "customer_type", "TEXT DEFAULT 'B2B'");
  addColumnIfMissing(db, "clients", "buyer_reference", "TEXT");
  addColumnIfMissing(db, "clients", "endpoint_id", "TEXT");
  addColumnIfMissing(db, "clients", "endpoint_scheme", "TEXT");
  addColumnIfMissing(db, "clients", "use_case_code", "TEXT");

  addColumnIfMissing(db, "clients", "reverse_charge", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "clients", "self_billing", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "clients", "vat_exempt_reason", "TEXT");
  addColumnIfMissing(db, "clients", "vat_exempt_code", "TEXT");

  addColumnIfMissing(db, "clients", "payee_name", "TEXT");
  addColumnIfMissing(db, "clients", "payee_iban", "TEXT");
  addColumnIfMissing(db, "clients", "payee_bic", "TEXT");
  addColumnIfMissing(db, "clients", "payee_mandate_ref", "TEXT");

  // ITEMS compatibility (items.ipc.js)
  addColumnIfMissing(db, "items", "item_type", "TEXT DEFAULT 'SERVICE'");
  addColumnIfMissing(db, "items", "active", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing(db, "items", "vat_category", "TEXT DEFAULT 'S'");
  addColumnIfMissing(db, "items", "vat_exempt_reason", "TEXT");
  addColumnIfMissing(db, "items", "vat_exempt_code", "TEXT");
  addColumnIfMissing(db, "items", "product_code", "TEXT");
  addColumnIfMissing(db, "items", "classification_code", "TEXT");

  // QUOTES compatibility (quotes.ipc.js)
  addColumnIfMissing(db, "quotes", "buyer_reference", "TEXT");
  addColumnIfMissing(db, "quotes", "purchase_order_ref", "TEXT");
  addColumnIfMissing(db, "quotes", "contract_ref", "TEXT");
  addColumnIfMissing(db, "quotes", "vat_mode", "TEXT DEFAULT 'AUTO'");
  addColumnIfMissing(db, "quotes", "vat_exempt_reason", "TEXT");
  addColumnIfMissing(db, "quotes", "vat_exempt_code", "TEXT");
  addColumnIfMissing(db, "quotes", "use_case_code", "TEXT");
  addColumnIfMissing(db, "quotes", "use_case_meta_json", "TEXT DEFAULT '{}'");
  addColumnIfMissing(db, "quotes", "totals_json", "TEXT");
  addColumnIfMissing(db, "quotes", "tax_breakdown_json", "TEXT");

  addColumnIfMissing(db, "quote_lines", "vat_category", "TEXT DEFAULT 'S'");
  addColumnIfMissing(db, "quote_lines", "vat_exempt_reason", "TEXT");
  addColumnIfMissing(db, "quote_lines", "vat_exempt_code", "TEXT");
  addColumnIfMissing(db, "quote_lines", "item_type", "TEXT DEFAULT 'SERVICE'");
  addColumnIfMissing(db, "quote_lines", "created_at", "TEXT");
  addColumnIfMissing(db, "quote_lines", "updated_at", "TEXT");

  // INVOICES compatibility (invoices.ipc.js)
  addColumnIfMissing(db, "invoices", "buyer_reference", "TEXT");
  addColumnIfMissing(db, "invoices", "purchase_order_ref", "TEXT");
  addColumnIfMissing(db, "invoices", "contract_ref", "TEXT");
  addColumnIfMissing(db, "invoices", "vat_mode", "TEXT DEFAULT 'AUTO'");
  addColumnIfMissing(db, "invoices", "vat_exempt_reason", "TEXT");
  addColumnIfMissing(db, "invoices", "vat_exempt_code", "TEXT");
  addColumnIfMissing(db, "invoices", "source_invoice_id", "TEXT");
  addColumnIfMissing(db, "invoices", "totals_json", "TEXT");
  addColumnIfMissing(db, "invoices", "tax_breakdown_json", "TEXT");

  addColumnIfMissing(db, "invoice_lines", "vat_category", "TEXT DEFAULT 'S'");
  addColumnIfMissing(db, "invoice_lines", "vat_exempt_reason", "TEXT");
  addColumnIfMissing(db, "invoice_lines", "vat_exempt_code", "TEXT");
  addColumnIfMissing(db, "invoice_lines", "item_type", "TEXT DEFAULT 'SERVICE'");
  addColumnIfMissing(db, "invoice_lines", "created_at", "TEXT");
  addColumnIfMissing(db, "invoice_lines", "updated_at", "TEXT");

  // Helpful indices (safe)
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_clients_country ON clients(country);
      CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
      CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updated_at);
      CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
      CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_number ON quotes(number);
    `);
  } catch {
    // ignore
  }

  // Normalize company row fields if empty
  try {
    const row = db.prepare("SELECT id, country, currency, vat_country_prefix FROM company WHERE id='1'").get();
    if (row) {
      const t = nowIso();
      const country = (row.country || "FR").toUpperCase();
      const currency = (row.currency || "EUR").toUpperCase();
      const prefix = (row.vat_country_prefix || country || "FR").toUpperCase();
      db.prepare(
        "UPDATE company SET country=?, currency=?, vat_country_prefix=?, updated_at=? WHERE id='1'"
      ).run(country, currency, prefix, t);
    }
  } catch {
    // ignore
  }
}

function applyMigrations(db) {
  createMigrationsRegistry(db);

  const steps = [
    { id: "0001_baseline", fn: migration_0001_baseline },
    { id: "0002_add_en_fields", fn: migration_0002_add_en_fields },
  ];

  const tx = db.transaction(() => {
    for (const step of steps) {
      if (isMigrationApplied(db, step.id)) continue;
      step.fn(db);
      markMigrationApplied(db, step.id);
    }
  });

  tx();
}

function getDb() {
  if (_db) return _db;

  const dir = path.join(app.getPath("userData"), "db");
  ensureDir(dir);

  const dbPath = path.join(dir, "erp.sqlite");
  _db = new Database(dbPath);

  // Stability & concurrency
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("temp_store = MEMORY");
  _db.pragma("foreign_keys = ON");
  _db.pragma("busy_timeout = 5000");

  applyMigrations(_db);

  return _db;
}

module.exports = {
  getDb,
  nowIso,
  applyMigrations,
};
