// Electron/ipc/payments.ipc.js
"use strict";

const { randomUUID } = require("crypto");

function nowIso() {
  return new Date().toISOString();
}

function isoDateOnly(x) {
  const v = String(x || "").trim();
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return "";
}

function num(x) {
  const v = Number(String(x ?? "").replace(",", "."));
  return Number.isFinite(v) ? v : 0;
}

function tableExists(db, name) {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
    .get(name);
}

function columnInfo(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all() || [];
}

function columnSet(db, table) {
  return new Set(columnInfo(db, table).map((r) => r.name));
}

function addColumnIfMissing(db, table, col, ddl) {
  const cols = columnSet(db, table);
  if (cols.has(col)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`);
}

function ensurePaymentsSchema(db) {
  if (!tableExists(db, "payments")) {
    db.exec(`
      CREATE TABLE payments (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,
        payment_date TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EUR',
        method TEXT,
        reference TEXT,
        notes TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
      CREATE INDEX IF NOT EXISTS idx_payments_payment_date ON payments(payment_date);
    `);
    return;
  }

  addColumnIfMissing(db, "payments", "currency", "currency TEXT NOT NULL DEFAULT 'EUR'");
  addColumnIfMissing(db, "payments", "method", "method TEXT");
  addColumnIfMissing(db, "payments", "reference", "reference TEXT");
  addColumnIfMissing(db, "payments", "notes", "notes TEXT");
  addColumnIfMissing(db, "payments", "created_at", "created_at TEXT");
  addColumnIfMissing(db, "payments", "updated_at", "updated_at TEXT");

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);`);
  } catch {}
}

function getDateColumns(db) {
  ensurePaymentsSchema(db);
  const cols = columnSet(db, "payments");
  return {
    hasDate: cols.has("date"),
    hasPaymentDate: cols.has("payment_date"),
  };
}

function dateExprForSelect(db) {
  const { hasDate, hasPaymentDate } = getDateColumns(db);
  if (hasPaymentDate && hasDate) return "COALESCE(p.payment_date, p.date)";
  if (hasPaymentDate) return "p.payment_date";
  if (hasDate) return "p.date";
  return "NULL";
}

module.exports = function registerPaymentsIpc(ipcMain, getDb) {
  if (!ipcMain) throw new Error("payments.ipc.js: ipcMain manquant");
  if (typeof getDb !== "function") throw new Error("payments.ipc.js: getDb doit être une fonction");

  ipcMain.handle("payments:list", async (_e, { invoiceId } = {}) => {
    const id = String(invoiceId || "").trim();
    if (!id) return [];

    const db = getDb();
    ensurePaymentsSchema(db);

    const dExpr = dateExprForSelect(db);

    const rows = db
      .prepare(
        `
        SELECT
          p.id,
          p.invoice_id,
          ${dExpr} AS date,
          p.amount,
          p.currency,
          p.method,
          p.reference,
          p.notes,
          p.created_at,
          p.updated_at,
          i.invoice_number,
          i.client_id,
          c.name AS client_name
        FROM payments p
        LEFT JOIN invoices i ON i.id = p.invoice_id
        LEFT JOIN clients  c ON c.id = i.client_id
        WHERE p.invoice_id = ?
        ORDER BY ${dExpr} DESC, p.created_at DESC
      `
      )
      .all(id);

    return Array.isArray(rows) ? rows : [];
  });

  ipcMain.handle("payments:listAll", async (_e, query = {}) => {
    const db = getDb();
    ensurePaymentsSchema(db);

    const q = query && typeof query === "object" ? query : {};
    const limit = Math.max(1, Math.min(5000, Number(q.limit || 500)));

    const dExpr = dateExprForSelect(db);

    const rows = db
      .prepare(
        `
        SELECT
          p.id,
          p.invoice_id,
          ${dExpr} AS date,
          p.amount,
          p.currency,
          p.method,
          p.reference,
          p.notes,
          p.created_at,
          p.updated_at,
          i.invoice_number,
          i.client_id,
          c.name AS client_name
        FROM payments p
        LEFT JOIN invoices i ON i.id = p.invoice_id
        LEFT JOIN clients  c ON c.id = i.client_id
        ORDER BY ${dExpr} DESC, p.created_at DESC
        LIMIT ?
      `
      )
      .all(limit);

    return Array.isArray(rows) ? rows : [];
  });

  ipcMain.handle("payments:record", async (_e, payload = {}) => {
    const p = payload && typeof payload === "object" ? payload : {};

    const invoice_id = String(p.invoice_id || p.invoiceId || "").trim();
    if (!invoice_id) throw new Error("payments:record: invoice_id manquant");

    const amount = num(p.amount);
    if (!(amount > 0)) throw new Error("payments:record: amount doit être > 0");

    const paymentDate = isoDateOnly(p.date || p.payment_date) || nowIso().slice(0, 10);

    const currency = String(p.currency || "EUR").toUpperCase().trim() || "EUR";
    const method = String(p.method || "other").toLowerCase().trim() || "other";
    const reference = String(p.reference || "").trim();
    const notes = String(p.notes || "").trim();

    const db = getDb();
    ensurePaymentsSchema(db);

    const { hasDate, hasPaymentDate } = getDateColumns(db);

    const id = randomUUID();
    const ts = nowIso();

    if (hasDate && hasPaymentDate) {
      db.prepare(
        `
        INSERT INTO payments (
          id, invoice_id,
          date, payment_date,
          amount, currency, method,
          reference, notes,
          created_at, updated_at
        ) VALUES (
          ?, ?,
          ?, ?,
          ?, ?, ?,
          ?, ?,
          ?, ?
        )
      `
      ).run(id, invoice_id, paymentDate, paymentDate, amount, currency, method, reference, notes, ts, ts);
    } else if (hasDate) {
      db.prepare(
        `
        INSERT INTO payments (
          id, invoice_id,
          date,
          amount, currency, method,
          reference, notes,
          created_at, updated_at
        ) VALUES (
          ?, ?,
          ?,
          ?, ?, ?,
          ?, ?,
          ?, ?
        )
      `
      ).run(id, invoice_id, paymentDate, amount, currency, method, reference, notes, ts, ts);
    } else if (hasPaymentDate) {
      db.prepare(
        `
        INSERT INTO payments (
          id, invoice_id,
          payment_date,
          amount, currency, method,
          reference, notes,
          created_at, updated_at
        ) VALUES (
          ?, ?,
          ?,
          ?, ?, ?,
          ?, ?,
          ?, ?
        )
      `
      ).run(id, invoice_id, paymentDate, amount, currency, method, reference, notes, ts, ts);
    } else {
      throw new Error("payments:record: schéma payments invalide");
    }

    return { ok: true, id };
  });

  ipcMain.handle("payments:delete", async (_e, { id } = {}) => {
    const pid = String(id || "").trim();
    if (!pid) throw new Error("payments:delete: id manquant");

    const db = getDb();
    ensurePaymentsSchema(db);

    const info = db.prepare(`DELETE FROM payments WHERE id = ?`).run(pid);
    return { ok: true, changes: info?.changes || 0 };
  });

  ipcMain.handle("payments:sumByInvoice", async (_e, { invoiceId } = {}) => {
    const id = String(invoiceId || "").trim();
    if (!id) return { total: 0 };

    const db = getDb();
    ensurePaymentsSchema(db);

    const row = db
      .prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE invoice_id = ?`)
      .get(id);

    return { total: Number(row?.total || 0) || 0 };
  });

  console.log("[IPC] payments.ipc.js loaded");
};
