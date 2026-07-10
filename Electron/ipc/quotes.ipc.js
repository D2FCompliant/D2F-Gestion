// Electron/ipc/quotes.ipc.js
"use strict";

const { randomUUID } = require("crypto");
const { BrowserWindow } = require("electron");

// ✅ FIX chemin (ipc -> ../db) + fallback safe
let nowIso;
try {
  ({ nowIso } = require("../db"));
} catch (_e) {
  nowIso = () => new Date().toISOString();
}

// -------------------- small helpers --------------------
function s(v, def = "") {
  return String(v ?? def).trim();
}
function n(v, def = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : def;
}
function round2(x) {
  return Math.round((n(x, 0) + Number.EPSILON) * 100) / 100;
}
function toJson(v) {
  try {
    return typeof v === "string" ? v : JSON.stringify(v ?? {});
  } catch {
    return "{}";
  }
}

// ✅ Compat renderer: accepte id en string ("uuid") OU objet ({id:"uuid"})
function pickId(arg) {
  if (!arg) return "";

  if (typeof arg === "string") {
    return s(arg);
  }

  if (typeof arg === "object") {
    return s(arg.id || arg.number || arg.quoteId);
  }

  return "";
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
  const cols = columnSet(db, table);
  if (cols.has(col)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${typeAndDefault};`);
}

// -------------------- realtime broadcast --------------------
function broadcastQuotesChanged(payload) {
  // Broadcast to all windows (Dashboard included)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("quotes:changed", payload);
    }
  }
}

// (Optionnel) checkpoint WAL pour viewers externes.
// Ne change rien à l'app elle-même, mais évite de croire que "sqlite ne bouge pas".
function walCheckpoint(db) {
  try {
    db.pragma("wal_checkpoint(PASSIVE)");
  } catch {
    // ignore
  }
}

// -------------------- schema --------------------
function ensureQuotesSchema(db) {
  // quotes
  if (!tableExists(db, "quotes")) {
    db.exec(`
      CREATE TABLE quotes (
        id TEXT PRIMARY KEY,
        number TEXT,
        status TEXT NOT NULL DEFAULT 'draft',          -- draft|sent|accepted|rejected|cancelled
        date TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EUR',
        client_id TEXT,
        notes TEXT,
        
        -- Quote commercial fields
        validity_days INTEGER,     -- ex: 30
        valid_until TEXT,          -- YYYY-MM-DD
        payment_text TEXT,         -- ex: "Paiement à 30 jours fin de mois"

        -- ERP/EN hooks
        buyer_reference TEXT,
        purchase_order_ref TEXT,
        contract_ref TEXT,

        -- VAT logic for quote => reused by invoices
        vat_mode TEXT NOT NULL DEFAULT 'AUTO',         -- AUTO|VAT|NO_VAT|REVERSE_CHARGE|EXEMPT
        vat_exempt_reason TEXT,
        vat_exempt_code TEXT,

        -- Meta
        use_case_code TEXT,
        use_case_meta_json TEXT,
        meta_json TEXT,

        -- Totals
        total_ht REAL NOT NULL DEFAULT 0,
        total_tva REAL NOT NULL DEFAULT 0,
        total_ttc REAL NOT NULL DEFAULT 0,
        totals_json TEXT,
        tax_breakdown_json TEXT,

        created_at TEXT,
        updated_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
      CREATE INDEX IF NOT EXISTS idx_quotes_client ON quotes(client_id);
      CREATE INDEX IF NOT EXISTS idx_quotes_date   ON quotes(date);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_number ON quotes(number);
    `);
  } else {
    addColumnIfMissing(db, "quotes", "number", "TEXT");
    addColumnIfMissing(db, "quotes", "status", "TEXT NOT NULL DEFAULT 'draft'");
    addColumnIfMissing(db, "quotes", "date", "TEXT");
    addColumnIfMissing(db, "quotes", "currency", "TEXT NOT NULL DEFAULT 'EUR'");
    addColumnIfMissing(db, "quotes", "client_id", "TEXT");
    addColumnIfMissing(db, "quotes", "notes", "TEXT");
    addColumnIfMissing(db, "quotes", "validity_days", "INTEGER");
    addColumnIfMissing(db, "quotes", "valid_until", "TEXT");
    addColumnIfMissing(db, "quotes", "payment_text", "TEXT");

    addColumnIfMissing(db, "quotes", "buyer_reference", "TEXT");
    addColumnIfMissing(db, "quotes", "purchase_order_ref", "TEXT");
    addColumnIfMissing(db, "quotes", "contract_ref", "TEXT");

    addColumnIfMissing(db, "quotes", "vat_mode", "TEXT NOT NULL DEFAULT 'AUTO'");
    addColumnIfMissing(db, "quotes", "vat_exempt_reason", "TEXT");
    addColumnIfMissing(db, "quotes", "vat_exempt_code", "TEXT");

    addColumnIfMissing(db, "quotes", "use_case_code", "TEXT");
    addColumnIfMissing(db, "quotes", "use_case_meta_json", "TEXT");
    addColumnIfMissing(db, "quotes", "meta_json", "TEXT");

    addColumnIfMissing(db, "quotes", "total_ht", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "quotes", "total_tva", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "quotes", "total_ttc", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "quotes", "totals_json", "TEXT");
    addColumnIfMissing(db, "quotes", "tax_breakdown_json", "TEXT");

    addColumnIfMissing(db, "quotes", "created_at", "TEXT");
    addColumnIfMissing(db, "quotes", "updated_at", "TEXT");

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
      CREATE INDEX IF NOT EXISTS idx_quotes_client ON quotes(client_id);
      CREATE INDEX IF NOT EXISTS idx_quotes_date   ON quotes(date);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_number ON quotes(number);
    `);
  }

  // quote_lines
  if (!tableExists(db, "quote_lines")) {
    db.exec(`
      CREATE TABLE quote_lines (
        id TEXT PRIMARY KEY,
        quote_id TEXT NOT NULL,

        article_id TEXT,
        article_ref TEXT,

        description TEXT NOT NULL,
        details TEXT,

        quantity REAL NOT NULL DEFAULT 1,
        unit_code TEXT NOT NULL DEFAULT 'C62',
        unit_price_ht REAL NOT NULL DEFAULT 0,
        remise_percent REAL NOT NULL DEFAULT 0,

        -- VAT
        tva_percent REAL NOT NULL DEFAULT 20,
        vat_category TEXT NOT NULL DEFAULT 'S',
        vat_exempt_reason TEXT,
        vat_exempt_code TEXT,

        -- goods/services (FR CTC / reporting)
        item_type TEXT NOT NULL DEFAULT 'SERVICE',      -- GOODS|SERVICE

        total_ht REAL NOT NULL DEFAULT 0,

        -- ordering
        position INTEGER NOT NULL DEFAULT 0,

        created_at TEXT,
        updated_at TEXT,

        FOREIGN KEY(quote_id) REFERENCES quotes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_quote_lines_quote ON quote_lines(quote_id);
    `);
  } else {
    addColumnIfMissing(db, "quote_lines", "quote_id", "TEXT");
    addColumnIfMissing(db, "quote_lines", "article_id", "TEXT");
    addColumnIfMissing(db, "quote_lines", "article_ref", "TEXT");
    addColumnIfMissing(db, "quote_lines", "description", "TEXT");
    addColumnIfMissing(db, "quote_lines", "details", "TEXT");
    addColumnIfMissing(db, "quote_lines", "quantity", "REAL NOT NULL DEFAULT 1");
    addColumnIfMissing(db, "quote_lines", "unit_code", "TEXT NOT NULL DEFAULT 'C62'");
    addColumnIfMissing(db, "quote_lines", "unit_price_ht", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "quote_lines", "remise_percent", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "quote_lines", "tva_percent", "REAL NOT NULL DEFAULT 20");
    addColumnIfMissing(db, "quote_lines", "vat_category", "TEXT NOT NULL DEFAULT 'S'");
    addColumnIfMissing(db, "quote_lines", "vat_exempt_reason", "TEXT");
    addColumnIfMissing(db, "quote_lines", "vat_exempt_code", "TEXT");
    addColumnIfMissing(db, "quote_lines", "item_type", "TEXT NOT NULL DEFAULT 'SERVICE'");
    addColumnIfMissing(db, "quote_lines", "total_ht", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "quote_lines", "position", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "quote_lines", "created_at", "TEXT");
    addColumnIfMissing(db, "quote_lines", "updated_at", "TEXT");

    db.exec(`CREATE INDEX IF NOT EXISTS idx_quote_lines_quote ON quote_lines(quote_id);`);
  }
}

// -------------------- totals --------------------
function computeLineTotals(line) {
  const qty = n(line.quantity, 1);
  const unit = n(line.unit_price_ht, 0);
  const discount = n(line.remise_percent, 0);

  const base = qty * unit;
  const net = base * (1 - discount / 100);
  const tva = net * (n(line.tva_percent, 0) / 100);

  return { ht: round2(net), tva: round2(tva) };
}

function computeTotals(lines) {
  let ht = 0;
  let tva = 0;
  for (const l of lines) {
    const t = computeLineTotals(l);
    ht += t.ht;
    tva += t.tva;
  }
  ht = round2(ht);
  tva = round2(tva);
  return { total_ht: ht, total_tva: tva, total_ttc: round2(ht + tva) };
}

function computeTaxBreakdown(lines) {
  const map = new Map();
  for (const l of lines) {
    const lt = computeLineTotals(l);
    const rate = round2(n(l.tva_percent, 0));
    const cat = s(l.vat_category || (rate === 0 ? "Z" : "S")).toUpperCase() || "S";
    const key = `${cat}|${rate.toFixed(2)}`;

    const cur = map.get(key) || {
      vat_category: cat,
      tva_percent: rate,
      taxable_ht: 0,
      vat_amount: 0,
    };
    cur.taxable_ht = round2(cur.taxable_ht + lt.ht);
    cur.vat_amount = round2(cur.vat_amount + round2(lt.ht * (rate / 100)));
    map.set(key, cur);
  }
  return Array.from(map.values());
}

// -------------------- numbering --------------------
function nextQuoteNumber(db) {
  ensureQuotesSchema(db);

  const year = new Date().getFullYear();
  const prefix = `D${year}-`;

  const last = db
    .prepare(
      `
      SELECT number FROM quotes
      WHERE number LIKE ?
      ORDER BY number DESC
      LIMIT 1
    `
    )
    .get(`${prefix}%`);

  const lastSeq = last ? Number(String(last.number).split("-")[1]) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, "0")}`;
}

// -------------------- lines io --------------------
function loadLines(db, quoteId) {
  ensureQuotesSchema(db);

  return db
    .prepare(
      `
      SELECT
        id, quote_id, article_id, article_ref, description, details,
        quantity, unit_code, unit_price_ht, remise_percent,
        tva_percent, vat_category, vat_exempt_reason, vat_exempt_code,
        item_type, total_ht, position,
        created_at, updated_at
      FROM quote_lines
      WHERE quote_id = ?
      ORDER BY rowid ASC
    `
    )
    .all(quoteId);
}

function saveLines(db, quoteId, lines) {
  ensureQuotesSchema(db);

  db.prepare("DELETE FROM quote_lines WHERE quote_id = ?").run(quoteId);

  const ins = db.prepare(`
    INSERT INTO quote_lines (
      id, quote_id, article_id, article_ref, description, details,
      quantity, unit_code, unit_price_ht, remise_percent,
      tva_percent, vat_category, vat_exempt_reason, vat_exempt_code,
      item_type,
      total_ht, position,
      created_at, updated_at
    ) VALUES (
      @id, @quote_id, @article_id, @article_ref, @description, @details,
      @quantity, @unit_code, @unit_price_ht, @remise_percent,
      @tva_percent, @vat_category, @vat_exempt_reason, @vat_exempt_code,
      @item_type,
      @total_ht, @position,
      @created_at, @updated_at
    )
  `);

  const t = nowIso();

  const sanitized = (Array.isArray(lines) ? lines : []).map((l, idx) => {
    const qty = n(l.quantity, 1);
    const unit_price_ht = n(l.unit_price_ht, 0);
    const remise_percent = n(l.remise_percent, 0);
    const tva_percent = n(l.tva_percent, 20);

    const totals = computeLineTotals({
      quantity: qty,
      unit_price_ht,
      remise_percent,
      tva_percent,
      item_type: l.item_type,
    });

    const itemType =
      s(l.item_type || "SERVICE").toUpperCase() === "GOODS" ? "GOODS" : "SERVICE";

    const vatCategory =
      s(l.vat_category || (tva_percent === 0 ? "Z" : "S")).toUpperCase() || "S";

    return {
      id: s(l.id) || randomUUID(),
      quote_id: quoteId,
      article_id: s(l.article_id) || null,
      article_ref: s(l.article_ref),
      description: s(l.description),
      details: s(l.details),

      quantity: qty,
      unit_code: s(l.unit_code, "C62") || "C62",
      unit_price_ht,
      remise_percent,

      tva_percent,
      vat_category: vatCategory,
      vat_exempt_reason: s(l.vat_exempt_reason),
      vat_exempt_code: s(l.vat_exempt_code),

      item_type: itemType,

      total_ht: totals.ht,
      position: Number.isFinite(n(l.position)) ? n(l.position) : idx,

      created_at: t,
      updated_at: t,
    };
  });

  for (const l of sanitized) ins.run(l);
  return sanitized;
}

// -------------------- state checks --------------------
function ensureEditable(db, quoteId) {
  ensureQuotesSchema(db);

  const row = db.prepare("SELECT status FROM quotes WHERE id = ?").get(quoteId);
  if (!row) throw new Error("Devis introuvable");

  const st = s(row.status || "draft").toLowerCase();
  if (!["draft", "sent"].includes(st)) {
    throw new Error("Opération autorisée uniquement sur un devis brouillon ou envoyé");
  }
}

function getFull(db, id) {

  const quote =
    db.prepare(
      "SELECT * FROM quotes WHERE id = ?"
    ).get(id);

  if (!quote) return null;

  const lines =
    loadLines(db, id);

  const client =
    quote.client_id
      ? db.prepare(
          "SELECT * FROM clients WHERE id = ?"
        ).get(quote.client_id)
      : null;

  return {
    quote,
    lines,
    client
  };
}

// -------------------- remove (factorized) --------------------
function removeQuote(db, qid) {
  ensureQuotesSchema(db);

  if (!qid) throw new Error("Quote id required");

  // If invoices exist referencing this quote, block delete (ERP stability)
  try {
    if (tableExists(db, "invoices")) {
      const cnt =
        db.prepare("SELECT COUNT(1) AS n FROM invoices WHERE quote_id = ?").get(qid)?.n || 0;
      if (cnt > 0) {
        return {
          ok: false,
          message: "Suppression impossible: un ou plusieurs factures sont liées à ce devis.",
        };
      }
    }
  } catch {
    // ignore: keep delete attempt
  }

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM quote_lines WHERE quote_id = ?").run(qid);
    const info = db.prepare("DELETE FROM quotes WHERE id = ?").run(qid);
    if (info.changes !== 1) {
      throw new Error(`Delete failed: updated ${info.changes} rows for id=${qid}`);
    }
  });
  tx();

  walCheckpoint(db);

  return { ok: true };
}

// -------------------- IPC handlers --------------------
module.exports = (ipcMain, getDb) => {
  const db = () => getDb();

  // list
  ipcMain.handle("quotes:list", (_e, q = {}) => {
    ensureQuotesSchema(db());

    const params = [];
    let where = "1=1";

    if (q.status) {
      where += " AND q.status = ?";
      params.push(s(q.status));
    }
    if (q.client_id) {
      where += " AND q.client_id = ?";
      params.push(s(q.client_id));
    }

    const hasClients = tableExists(db(), "clients");

    const sql = hasClients
      ? `
        SELECT q.*, c.name AS client_name
        FROM quotes q
        LEFT JOIN clients c ON c.id = q.client_id
        WHERE ${where}
        ORDER BY COALESCE(q.updated_at, q.created_at) DESC
        LIMIT 500
      `
      : `
        SELECT q.*, NULL AS client_name
        FROM quotes q
        WHERE ${where}
        ORDER BY COALESCE(q.updated_at, q.created_at) DESC
        LIMIT 500
      `;

    return db().prepare(sql).all(...params);
  });

  // getFull ✅ compat string OU {id}
  ipcMain.handle("quotes:getFull", (_e, arg) => {
    const id = pickId(arg);
    return getFull(db(), id);
  });

  // get (compat) ✅ compat string OU {id}
  ipcMain.handle("quotes:get", (_e, arg) => {
    const id = pickId(arg);
    const full = getFull(db(), id);
    if (!full) return null;
    return { ...full.quote, lines: full.lines };
  });

  // create
  ipcMain.handle("quotes:create", (_e, payload = {}) => {
    ensureQuotesSchema(db());

    const id = randomUUID();
    const t = nowIso();

    const number = payload.number ? s(payload.number) : nextQuoteNumber(db());
    const lines = Array.isArray(payload.lines) ? payload.lines : [];

    const tx = db().transaction(() => {
      db()
        .prepare(
          `
          INSERT INTO quotes (
            id, number, status, date, currency, client_id, notes,
            validity_days, valid_until, payment_text,
            buyer_reference, purchase_order_ref, contract_ref,
            vat_mode, vat_exempt_reason, vat_exempt_code,
            use_case_code, use_case_meta_json,
            meta_json,
            totals_json, tax_breakdown_json,
            total_ht, total_tva, total_ttc,
            created_at, updated_at
          ) VALUES (
            @id, @number, 'draft', @date, @currency, @client_id, @notes,
            @validity_days, @valid_until, @payment_text,
            @buyer_reference, @purchase_order_ref, @contract_ref,
            @vat_mode, @vat_exempt_reason, @vat_exempt_code,
            @use_case_code, @use_case_meta_json,
            @meta_json,
            '', '',
            0, 0, 0,
            @created_at, @updated_at
          )
        `
        )
        .run({
          id,
          number,
          date: s(payload.date) ? s(payload.date) : t.slice(0, 10),
          currency: s(payload.currency, "EUR").toUpperCase(),
          client_id: payload.client_id || null,
          notes: s(payload.notes),

          validity_days: Number.isFinite(n(payload.validity_days)) ? n(payload.validity_days) : null,
          valid_until: s(payload.valid_until) || null,
          payment_text: s(payload.payment_text),

          buyer_reference: s(payload.buyer_reference),
          purchase_order_ref: s(payload.purchase_order_ref),
          contract_ref: s(payload.contract_ref),

          vat_mode: s(payload.vat_mode || "AUTO").toUpperCase(),
          vat_exempt_reason: s(payload.vat_exempt_reason),
          vat_exempt_code: s(payload.vat_exempt_code),

          use_case_code: s(payload.use_case_code),
          use_case_meta_json: toJson(payload.use_case_meta || {}),

          meta_json: toJson(payload.meta_json || payload.meta),

          created_at: t,
          updated_at: t,
        });

      const persisted = saveLines(db(), id, lines);
      const totals = computeTotals(persisted);
      const taxBreakdown = computeTaxBreakdown(persisted);

      const info = db()
        .prepare(
          `
          UPDATE quotes SET
            total_ht=@total_ht,
            total_tva=@total_tva,
            total_ttc=@total_ttc,
            totals_json=@totals_json,
            tax_breakdown_json=@tax_breakdown_json,
            updated_at=@updated_at
          WHERE id=@id
        `
        )
        .run({
          id,
          ...totals,
          totals_json: toJson(totals),
          tax_breakdown_json: toJson(taxBreakdown),
          updated_at: t,
        });

      if (info.changes !== 1) {
        throw new Error(`Create totals update failed: updated ${info.changes} rows for id=${id}`);
      }
    });

    tx();

    walCheckpoint(db());

    // ✅ realtime broadcast
    broadcastQuotesChanged({ type: "quote.created", id, number });

    return { ok: true, id, number };
  });

  // update/save (draft or sent)
  function updateQuote(payload = {}) {
    ensureQuotesSchema(db());

    const id = s(payload.id);
    if (!id) throw new Error("Quote id required");
    ensureEditable(db(), id);

    const status =
      payload.status &&
      ["draft", "sent", "accepted", "rejected", "cancelled"].includes(
        String(payload.status).toLowerCase()
      )
        ? String(payload.status).toLowerCase()
        : null;

    const t = nowIso();
    const lines = Array.isArray(payload.lines) ? payload.lines : [];

    const tx = db().transaction(() => {
      const persisted = saveLines(db(), id, lines);
      const totals = computeTotals(persisted);
      const taxBreakdown = computeTaxBreakdown(persisted);

      const info = db()
        .prepare(
          `
          UPDATE quotes SET
            status = COALESCE(@status, status),
            client_id=@client_id,
            date=@date,
            currency=@currency,
            notes=@notes,

            validity_days=@validity_days,
            valid_until=@valid_until,
            payment_text=@payment_text,

            buyer_reference=@buyer_reference,
            purchase_order_ref=@purchase_order_ref,
            contract_ref=@contract_ref,

            vat_mode=@vat_mode,
            vat_exempt_reason=@vat_exempt_reason,
            vat_exempt_code=@vat_exempt_code,

            use_case_code=@use_case_code,
            use_case_meta_json=@use_case_meta_json,
            meta_json=@meta_json,

            total_ht=@total_ht,
            total_tva=@total_tva,
            total_ttc=@total_ttc,
            totals_json=@totals_json,
            tax_breakdown_json=@tax_breakdown_json,

            updated_at=@updated_at
          WHERE id=@id
        `
        )
        .run({
          id,
          status,
          client_id: payload.client_id || null,
          date: s(payload.date) ? s(payload.date) : t.slice(0, 10),
          currency: s(payload.currency, "EUR").toUpperCase(),
          notes: s(payload.notes),

          validity_days: Number.isFinite(n(payload.validity_days)) ? n(payload.validity_days) : null,
          valid_until: s(payload.valid_until) || null,
          payment_text: s(payload.payment_text),

          buyer_reference: s(payload.buyer_reference),
          purchase_order_ref: s(payload.purchase_order_ref),
          contract_ref: s(payload.contract_ref),

          vat_mode: s(payload.vat_mode || "AUTO").toUpperCase(),
          vat_exempt_reason: s(payload.vat_exempt_reason),
          vat_exempt_code: s(payload.vat_exempt_code),

          use_case_code: s(payload.use_case_code),
          use_case_meta_json: toJson(payload.use_case_meta || {}),
          meta_json: toJson(payload.meta_json || payload.meta),

          ...totals,
          totals_json: toJson(totals),
          tax_breakdown_json: toJson(taxBreakdown),

          updated_at: t,
        });

      if (info.changes !== 1) {
        throw new Error(`Update failed: updated ${info.changes} rows for id=${id}`);
      }
    });

    tx();

    walCheckpoint(db());

    broadcastQuotesChanged({ type: "quote.updated", id });

    return { ok: true, id };
  }

  function setQuoteStatus({ id, number, quoteId, status } = {}) {
  ensureQuotesSchema(db());

  const key = s(id || number || quoteId);
  const st = s(status).toLowerCase();

  if (!key) throw new Error("Quote id/number required");
  if (!["draft", "sent", "accepted", "rejected", "cancelled"].includes(st)) {
    throw new Error("Statut devis invalide");
  }

  const row = db()
    .prepare("SELECT id, number, status FROM quotes WHERE id = ? OR number = ? LIMIT 1")
    .get(key, key);

  if (!row) {
    throw new Error(`Devis introuvable: ${key}`);
  }

  // On garde la règle métier actuelle : statut modifiable seulement sur draft/sent
  ensureEditable(db(), row.id);

  const t = nowIso();

  const info = db()
    .prepare("UPDATE quotes SET status = ?, updated_at = ? WHERE id = ?")
    .run(st, t, row.id);

  const updatedRow = db()
    .prepare("SELECT id, number, status, updated_at FROM quotes WHERE id = ? LIMIT 1")
    .get(row.id);

  console.log("[quotes:setStatus]", {
    key,
    resolved_id: row.id,
    st,
    changes: info.changes,
    row: updatedRow,
  });

  if (info.changes !== 1) {
    throw new Error(`setStatus failed: updated ${info.changes} rows for key=${key}`);
  }

  broadcastQuotesChanged({
    type: "quote.status",
    id: updatedRow?.id ?? row.id,
    number: updatedRow?.number ?? row.number,
    status: st,
  });

  return {
    ok: true,
    id: updatedRow?.id ?? row.id,
    number: updatedRow?.number ?? row.number,
    status: st,
    updated_at: updatedRow?.updated_at,
  };
}

// update/save
ipcMain.handle("quotes:update", (_e, payload = {}) => updateQuote(payload));
ipcMain.handle("quotes:save", (_e, payload = {}) => updateQuote(payload)); // alias

// status changes
ipcMain.handle("quotes:setStatus", (_e, payload = {}) => setQuoteStatus(payload));

// ✅ Stats (debug) : retourne les compteurs DB par status
ipcMain.handle("quotes:stats", () => {
  ensureQuotesSchema(db());
  return db()
    .prepare(
      `
      SELECT status, COUNT(1) AS n
      FROM quotes
      GROUP BY status
      ORDER BY status
    `
    )
    .all();
});

// ✅ Accept : compat string OU {id} OU {number}
ipcMain.handle("quotes:accept", (_e, arg) => {
  const key =
    typeof arg === "string"
      ? s(arg)
      : typeof arg === "object"
        ? s(arg.id || arg.number)
        : "";

  if (!key) throw new Error("Quote id/number required");

  // On résout l'UUID si on a reçu un number
  const row = db()
    .prepare("SELECT id, status FROM quotes WHERE id=? OR number=? LIMIT 1")
    .get(key, key);

  if (!row) throw new Error("Devis introuvable");

  // accept autorisé sur draft/sent
  ensureEditable(db(), row.id);

  return setQuoteStatus({ id: row.id, status: "accepted" });
});

ipcMain.handle("quotes:remove", (_e, arg) => {
  const key = pickId(arg);
  if (!key) throw new Error("Quote id/number required");

  const row = db()
    .prepare("SELECT id FROM quotes WHERE id = ? OR number = ? LIMIT 1")
    .get(key, key);

  if (!row) throw new Error(`Devis introuvable: ${key}`);

  const res = removeQuote(db(), row.id);
  if (res?.ok) {
    broadcastQuotesChanged({ type: "quote.deleted", id: row.id });
  }
  return res;
});

ipcMain.handle("quotes:delete", (_e, arg) => {
  const key = pickId(arg);
  if (!key) throw new Error("Quote id/number required");

  const row = db()
    .prepare("SELECT id FROM quotes WHERE id = ? OR number = ? LIMIT 1")
    .get(key, key);

  if (!row) throw new Error(`Devis introuvable: ${key}`);

  const res = removeQuote(db(), row.id);
  if (res?.ok) {
    broadcastQuotesChanged({ type: "quote.deleted", id: row.id });
  }
  return res;
});
};