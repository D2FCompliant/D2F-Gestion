// Electron/ipc/invoices.ipc.js
"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const https = require("node:https");
const { randomUUID } = require("crypto");
const crypto = require("node:crypto");
const { appendAuditEvent, getAuditLogPath } = require("../audit/audit");
const fsSync = require("fs");
const pathSync = require("path");
const validateUblModule = require("../validation/validate-ubl");
const validateFile = validateUblModule.validateFile;
const validateUblSchematron = validateUblModule.validateUblSchematron;
const { ipcMain, app } = require("electron");
const fetch = require("node-fetch");

let nowIso; try {({ nowIso } = require("../db")); } catch (_e) {
  nowIso = () => new Date().toISOString();
}

// -------------------- small helpers --------------------
function s(v, def = "") { return String(v ?? def).trim(); }
function n(v, def = 0) { const num = Number(v); return Number.isFinite(num) ? num : def; }
function toJson(value) { if (value == null) return "{}"; try { return typeof value === "string" ? value : JSON.stringify(value); } catch { return "{}"; } }
function safeJsonParse(str, def = {}) { try { if (!str) return def; return JSON.parse(str); } catch { return def; } }
function round2(x) { return Math.round((n(x, 0) + Number.EPSILON) * 100) / 100; }
function eXml(x) { return String(x ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isoDate(d) { const t = s(d); if (!t) return ""; if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t; return new Date(t).toISOString().slice(0, 10); }
function ensureExportDir() {
  const dir = pathSync.join(app.getPath("downloads"), "D2F_Gestion", "exports");
  return fsSync.promises.mkdir(dir, { recursive: true }).then(() => dir);
}

function tableExists(db, name) { return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
    .get(name);
}

function columnSet(db, table) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return new Set(rows.map((r) => r.name));
}

function addColumnIfMissing(db, table, colName, colTypeAndDefault) {
  const cols = columnSet(db, table);
  if (cols.has(colName)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colTypeAndDefault};`);
}

// -------------------- schema (non destructive) --------------------
function ensurePeppolPartySchema(db) {
  // --- COMPANY
  if (tableExists(db, "company")) {
    addColumnIfMissing(db, "company", "endpoint_id", "TEXT");
    addColumnIfMissing(db, "company", "endpoint_scheme", "TEXT");
    addColumnIfMissing(db, "company", "vat_id", "TEXT");
    addColumnIfMissing(db, "company", "meta_json", "TEXT");
  }

  // --- CLIENTS
  if (tableExists(db, "clients")) {
    addColumnIfMissing(db, "clients", "endpoint_id", "TEXT");
    addColumnIfMissing(db, "clients", "endpoint_scheme", "TEXT");
    addColumnIfMissing(db, "clients", "vat_id", "TEXT");
    addColumnIfMissing(db, "clients", "meta_json", "TEXT");
  }
}

function ensureInvoicesSchema(db) {
  // invoices
  if (!tableExists(db, "invoices")) {
    db.exec(`
      CREATE TABLE invoices (
        id TEXT PRIMARY KEY,

        quote_id TEXT,
        client_id TEXT,

        -- types: final|deposit|credit_note
        type TEXT NOT NULL DEFAULT 'final',

        -- status: draft|issued|cancelled
        status TEXT NOT NULL DEFAULT 'draft',

        -- immutable once issued
        invoice_number TEXT,

        date TEXT NOT NULL,
        due_date TEXT,
        currency TEXT NOT NULL DEFAULT 'EUR',

        notes TEXT,

        -- EN16931 / business meta
        buyer_reference TEXT,
        purchase_order_ref TEXT,
        contract_ref TEXT,

        -- VAT logic control: AUTO|VAT|NO_VAT|REVERSE_CHARGE|EXEMPT
        vat_mode TEXT NOT NULL DEFAULT 'AUTO',
        vat_exempt_reason TEXT,
        vat_exempt_code TEXT,

        -- invoice links / context
        source_invoice_id TEXT,

        -- ✅ EN16931 BT-113
        prepaid_amount REAL NOT NULL DEFAULT 0,

        -- ✅ EN16931 BT-115 (PayableAmount / Net à payer)
        amount_due REAL NOT NULL DEFAULT 0,
        
        -- PEPPOL
        peppol_exported_at TEXT,
        peppol_export_hash TEXT,
        peppol_export_profile TEXT,
        peppol_export_filename TEXT,
        peppol_export_count INTEGER NOT NULL DEFAULT 0,

        -- app-specific
        use_case_code TEXT,
        use_case_meta_json TEXT,
        meta_json TEXT,

        -- totals snapshot
        total_ht REAL NOT NULL DEFAULT 0,
        total_tva REAL NOT NULL DEFAULT 0,
        total_ttc REAL NOT NULL DEFAULT 0,
        totals_json TEXT,
        tax_breakdown_json TEXT,

        created_at TEXT,
        updated_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
      CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_date   ON invoices(date);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
    `);
  } else {
    addColumnIfMissing(db, "invoices", "quote_id", "TEXT");
    addColumnIfMissing(db, "invoices", "client_id", "TEXT");
    addColumnIfMissing(db, "invoices", "type", "TEXT NOT NULL DEFAULT 'final'");
    addColumnIfMissing(db, "invoices", "status", "TEXT NOT NULL DEFAULT 'draft'");
    addColumnIfMissing(db, "invoices", "invoice_number", "TEXT");
    addColumnIfMissing(db, "invoices", "date", "TEXT");
    addColumnIfMissing(db, "invoices", "due_date", "TEXT");
    addColumnIfMissing(db, "invoices", "currency", "TEXT NOT NULL DEFAULT 'EUR'");
    addColumnIfMissing(db, "invoices", "notes", "TEXT");
    addColumnIfMissing(db, "invoices", "buyer_reference", "TEXT");
    addColumnIfMissing(db, "invoices", "purchase_order_ref", "TEXT");
    addColumnIfMissing(db, "invoices", "contract_ref", "TEXT");
    addColumnIfMissing(db, "invoices", "vat_mode", "TEXT NOT NULL DEFAULT 'AUTO'");
    addColumnIfMissing(db, "invoices", "vat_exempt_reason", "TEXT");
    addColumnIfMissing(db, "invoices", "vat_exempt_code", "TEXT");
    addColumnIfMissing(db, "invoices", "source_invoice_id", "TEXT");
    addColumnIfMissing(db, "invoices", "prepaid_amount", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "invoices", "amount_due", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "invoices", "use_case_code", "TEXT");
    addColumnIfMissing(db, "invoices", "use_case_meta_json", "TEXT");
    addColumnIfMissing(db, "invoices", "meta_json", "TEXT");
    addColumnIfMissing(db, "invoices", "total_ht", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "invoices", "total_tva", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "invoices", "total_ttc", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "invoices", "totals_json", "TEXT");
    addColumnIfMissing(db, "invoices", "tax_breakdown_json", "TEXT");
    addColumnIfMissing(db, "invoices", "created_at", "TEXT");
    addColumnIfMissing(db, "invoices", "updated_at", "TEXT");
    addColumnIfMissing(db, "invoices", "peppol_exported_at", "TEXT");
    addColumnIfMissing(db, "invoices", "peppol_export_hash", "TEXT");
    addColumnIfMissing(db, "invoices", "peppol_export_profile", "TEXT");
    addColumnIfMissing(db, "invoices", "peppol_export_filename", "TEXT");
    addColumnIfMissing(db, "invoices", "peppol_export_count", "INTEGER NOT NULL DEFAULT 0");

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
      CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_date   ON invoices(date);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
    `);
  }

  // invoice_lines
  if (!tableExists(db, "invoice_lines")) {
    db.exec(`
      CREATE TABLE invoice_lines (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,

        article_id TEXT,
        article_ref TEXT,

        description TEXT NOT NULL,

        quantity REAL NOT NULL DEFAULT 1,
        unit_code TEXT NOT NULL DEFAULT 'C62',

        unit_price_ht REAL NOT NULL DEFAULT 0,
        remise_percent REAL NOT NULL DEFAULT 0,

        -- VAT
        tva_percent REAL NOT NULL DEFAULT 0,
        vat_category TEXT NOT NULL DEFAULT 'S',
        vat_exempt_reason TEXT,
        vat_exempt_code TEXT,

        -- goods/service
        line_type TEXT NOT NULL DEFAULT 'standard',
        item_type TEXT NOT NULL DEFAULT 'SERVICE',

        total_ht REAL NOT NULL DEFAULT 0,
        created_at TEXT,
        updated_at TEXT,

        FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);
    `);
  } else {
    addColumnIfMissing(db, "invoice_lines", "invoice_id", "TEXT");
    addColumnIfMissing(db, "invoice_lines", "article_id", "TEXT");
    addColumnIfMissing(db, "invoice_lines", "article_ref", "TEXT");
    addColumnIfMissing(db, "invoice_lines", "description", "TEXT");
    addColumnIfMissing(db, "invoice_lines", "quantity", "REAL NOT NULL DEFAULT 1");
    addColumnIfMissing(db, "invoice_lines", "unit_code", "TEXT NOT NULL DEFAULT 'C62'");
    addColumnIfMissing(db, "invoice_lines", "unit_price_ht", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "invoice_lines", "remise_percent", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "invoice_lines", "tva_percent", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "invoice_lines", "vat_category", "TEXT NOT NULL DEFAULT 'S'");
    addColumnIfMissing(db, "invoice_lines", "vat_exempt_reason", "TEXT");
    addColumnIfMissing(db, "invoice_lines", "vat_exempt_code", "TEXT");
    addColumnIfMissing(db, "invoice_lines", "line_type", "TEXT NOT NULL DEFAULT 'standard'");
    addColumnIfMissing(db, "invoice_lines", "item_type", "TEXT NOT NULL DEFAULT 'SERVICE'");
    addColumnIfMissing(db, "invoice_lines", "total_ht", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "invoice_lines", "created_at", "TEXT");
    addColumnIfMissing(db, "invoice_lines", "updated_at", "TEXT");
    db.exec(`CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);`);
  }

  // invoice_links
  if (!tableExists(db, "invoice_links")) {
    db.exec(`
      CREATE TABLE invoice_links (
        id TEXT PRIMARY KEY,
        from_invoice_id TEXT NOT NULL,
        to_invoice_id TEXT NOT NULL,
        link_type TEXT NOT NULL, -- credit_of|prepayment_of|final_of
        created_at TEXT NOT NULL,
        FOREIGN KEY(from_invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
        FOREIGN KEY(to_invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_invoice_links_from ON invoice_links(from_invoice_id);
      CREATE INDEX IF NOT EXISTS idx_invoice_links_to ON invoice_links(to_invoice_id);
    `);
  }
}

// -------------------- totals / VAT logic --------------------
function computeLineTotals(line) {
  const qty = n(line.quantity);
  const unit = n(line.unit_price_ht);
  const discount = n(line.remise_percent);
  const base = qty * unit;
  const net = base * (1 - discount / 100);
  const vat = net * (n(line.tva_percent) / 100);
  return { ht: round2(net), tva: round2(vat) };
}

function computeInvoiceTotals(lines) {
  let totalHt = 0;
  let totalTva = 0;

  for (const l of lines) {
    const t = computeLineTotals(l);
    totalHt += t.ht;
    totalTva += t.tva;
  }

  totalHt = round2(totalHt);
  totalTva = round2(totalTva);

  return {
    total_ht: totalHt,
    total_tva: totalTva,
    total_ttc: round2(totalHt + totalTva),
  };
}

function computeTaxBreakdown(lines) {
  const map = new Map();

  for (const l of lines) {
    const ht = computeLineTotals(l).ht;
    const rate = round2(n(l.tva_percent));
    const cat = s(l.vat_category || (rate === 0 ? "Z" : "S")) || "S";
    const key = `${cat}|${rate.toFixed(2)}`;

    const cur = map.get(key) || {
      vat_category: cat,
      tva_percent: rate,
      taxable_ht: 0,
      vat_amount: 0,
    };

    cur.taxable_ht = round2(cur.taxable_ht + ht);
    cur.vat_amount = round2(cur.vat_amount + round2(ht * (rate / 100)));
    map.set(key, cur);
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.vat_category !== b.vat_category) return a.vat_category.localeCompare(b.vat_category);
    return a.tva_percent - b.tva_percent;
  });
}

function applyVatModeToLines({ company, client, invoice, lines }) {
  const sellerCountry = s(company?.country || "FR").toUpperCase();
  const buyerCountry = s(client?.country || "FR").toUpperCase();
  const buyerType = s(client?.customer_type || "B2C").toUpperCase();
  const buyerVatId = s(client?.vat_id);

  const mode = s(invoice?.vat_mode || "AUTO").toUpperCase();

  const effectiveMode = (() => {
    if (mode !== "AUTO") return mode;
    if (sellerCountry && buyerCountry && sellerCountry === buyerCountry) return "VAT";
    const buyerIsBusiness = buyerType === "B2B" || buyerType === "B2G";
    if (buyerIsBusiness && buyerVatId) return "REVERSE_CHARGE";
    return "NO_VAT";
  })();

  const patched = lines.map((l) => {
    const out = { ...l };

    if (effectiveMode === "VAT") {
      out.vat_category = s(out.vat_category || (n(out.tva_percent) === 0 ? "Z" : "S")) || "S";
      return out;
    }

    if (effectiveMode === "REVERSE_CHARGE") {
      out.tva_percent = 0;
      out.vat_category = "AE";
      out.vat_exempt_reason = s(invoice?.vat_exempt_reason) || "Reverse charge";
      out.vat_exempt_code = s(invoice?.vat_exempt_code) || "";
      return out;
    }

    if (effectiveMode === "EXEMPT") {
      out.tva_percent = 0;
      out.vat_category = "E";
      out.vat_exempt_reason = s(invoice?.vat_exempt_reason) || "Exempt";
      out.vat_exempt_code = s(invoice?.vat_exempt_code) || "";
      return out;
    }

    // NO_VAT
    out.tva_percent = 0;
    out.vat_category = "Z";
    out.vat_exempt_reason = s(invoice?.vat_exempt_reason) || "";
    out.vat_exempt_code = s(invoice?.vat_exempt_code) || "";
    return out;
  });

  return { effectiveMode, lines: patched };
}

// -------------------- payable / due --------------------
function payableAmount(totalTtc, prepaid) {
  return round2(Math.max(0, round2(n(totalTtc, 0)) - round2(n(prepaid, 0))));
}

function computeAmountDueByType(type, totalTtc, prepaid) {
  const tp = s(type || "final");
  if (tp === "credit_note") {
    // Credit note can be negative; do not clamp.
    return round2(round2(n(totalTtc, 0)) - round2(n(prepaid, 0)));
  }
  return payableAmount(totalTtc, prepaid);
}

// -------------------- numbering / state --------------------
function ensureDraft(db, id) {
  const row = db.prepare("SELECT status FROM invoices WHERE id = ?").get(id);
  if (!row) throw new Error("Facture introuvable");
  if (row.status !== "draft") throw new Error("Opération autorisée uniquement sur un brouillon");
}

function nextInvoiceNumber(db, type) {
  const year = new Date().getFullYear();
  const prefix =
    type === "credit_note" ? `AV${year}-` : type === "deposit" ? `AC${year}-` : `F${year}-`;

  const last = db
    .prepare(
      `
      SELECT invoice_number FROM invoices
      WHERE invoice_number LIKE ?
      ORDER BY invoice_number DESC
      LIMIT 1
    `
    )
    .get(`${prefix}%`);

  const lastSeq = last ? Number(String(last.invoice_number).split("-")[1]) || 0 : 0;
  const nextSeq = String(lastSeq + 1).padStart(4, "0");
  return `${prefix}${nextSeq}`;
}

// -------------------- lines persistence --------------------
function persistInvoiceLines(db, invoiceId, lines) {
  db.prepare("DELETE FROM invoice_lines WHERE invoice_id = ?").run(invoiceId);

  const ins = db.prepare(
    `
    INSERT INTO invoice_lines (
      id, invoice_id, article_id, article_ref, description,
      quantity, unit_code, unit_price_ht, remise_percent,
      tva_percent, vat_category, vat_exempt_reason, vat_exempt_code,
      line_type, item_type,
      total_ht,
      created_at, updated_at
    ) VALUES (
      @id, @invoice_id, @article_id, @article_ref, @description,
      @quantity, @unit_code, @unit_price_ht, @remise_percent,
      @tva_percent, @vat_category, @vat_exempt_reason, @vat_exempt_code,
      @line_type, @item_type,
      @total_ht,
      @created_at, @updated_at
    )
  `
  );

  const t = nowIso();

  const sanitized = (Array.isArray(lines) ? lines : []).map((l) => {
    const qty = n(l.quantity, 1);
    const unit_price_ht = n(l.unit_price_ht, 0);
    const remise_percent = n(l.remise_percent, 0);
    const tva_percent = n(l.tva_percent, 0);

    const totals = computeLineTotals({
      quantity: qty,
      unit_price_ht,
      remise_percent,
      tva_percent,
    });

    return {
      id: s(l.id) || randomUUID(),
      invoice_id: invoiceId,

      article_id: s(l.article_id) || null,
      article_ref: s(l.article_ref),

      description: s(l.description),
      quantity: qty,
      unit_code: s(l.unit_code) || "C62",

      unit_price_ht,
      remise_percent,

      tva_percent,
      vat_category: s(l.vat_category || (tva_percent === 0 ? "Z" : "S")) || "S",
      vat_exempt_reason: s(l.vat_exempt_reason),
      vat_exempt_code: s(l.vat_exempt_code),

      line_type: s(l.line_type) || "standard",
      item_type: s(l.item_type || "SERVICE").toUpperCase() === "GOODS" ? "GOODS" : "SERVICE",

      total_ht: totals.ht,

      created_at: t,
      updated_at: t,
    };
  });

  for (const l of sanitized) ins.run(l);
  return sanitized;
}

function loadInvoiceLines(db, id) {
  ensureInvoicesSchema(db);
  return db
    .prepare(
      `
      SELECT
        id, invoice_id, article_id, article_ref, description,
        quantity, unit_code, unit_price_ht, remise_percent,
        tva_percent, vat_category, vat_exempt_reason, vat_exempt_code,
        line_type, item_type, total_ht,
        created_at, updated_at
      FROM invoice_lines
      WHERE invoice_id = ?
      ORDER BY rowid
    `
    )
    .all(id);
}

// -------------------- load full --------------------
function getFull(db, id) {
  ensureInvoicesSchema(db);

  const inv = db
    .prepare(
      `
      SELECT
        id, quote_id, client_id, type, status, invoice_number,
        date, due_date, currency, notes,
        buyer_reference, purchase_order_ref, contract_ref,
        vat_mode, vat_exempt_reason, vat_exempt_code,
        source_invoice_id,
        prepaid_amount,
        amount_due,
        use_case_code, use_case_meta_json, meta_json,
        total_ht, total_tva, total_ttc,
        totals_json, tax_breakdown_json,
        created_at, updated_at
      FROM invoices
      WHERE id = ?
    `
    )
    .get(id);

  if (!inv) return null;

  const lines = loadInvoiceLines(db, id);

  const prepaid = round2(n(inv.prepaid_amount, 0));
  const totalTtc = round2(n(inv.total_ttc, 0));

  // stored amount_due is the truth; fallback if missing/zero-inconsistent
  const storedDue = round2(n(inv.amount_due, 0));
  const computedDue = computeAmountDueByType(inv.type, totalTtc, prepaid);
  const due =
    Number.isFinite(storedDue) && !(storedDue === 0 && computedDue !== 0) ? storedDue : computedDue;

  const client = db
  .prepare("SELECT * FROM clients WHERE id = ?")
  .get(inv.client_id);

return {
  invoice: {
    ...inv,
    prepaid_amount: prepaid,
    amount_due: due,
    payable_amount: due
  },
  buyer: client,
  lines
};
}

// -------------------- EN16931 pragmatic validations --------------------
function ensureCompanyForIssue(company) {
  if (!s(company?.legal_name))
    throw new Error("Société: raison sociale obligatoire (EN16931 BG-4/BT-27).");
  if (!s(company?.country))
    throw new Error("Société: pays obligatoire (ISO) (EN16931 BG-4/BT-40).");
  if (!s(company?.street) || !s(company?.postal_code) || !s(company?.city))
    throw new Error("Société: adresse complète obligatoire (EN16931 BG-5).");
}

function ensureClientForIssue(client, invoice) {
  if (!s(client?.name)) throw new Error("Client: nom obligatoire (EN16931 BG-7/BT-44).");
  if (!s(client?.country)) throw new Error("Client: pays obligatoire (EN16931 BG-8/BT-55).");
  if (!s(client?.street) || !s(client?.postal_code) || !s(client?.city))
    throw new Error("Client: adresse complète obligatoire (EN16931 BG-8).");

  if (s(client?.customer_type).toUpperCase() === "B2G") {
    const br = s(invoice?.buyer_reference) || s(client?.buyer_reference);
    if (!br) throw new Error("B2G: BuyerReference requis (EN16931 BT-10).");
  }
}

function ensureLinesForIssue(lines) {
  if (!Array.isArray(lines) || lines.length === 0)
    throw new Error("Facture: au moins une ligne est requise (EN16931 BG-25).");
  for (const l of lines) {
    if (!s(l.description)) throw new Error("Ligne: description obligatoire (EN16931 BT-153).");
    if (!(n(l.quantity) > 0 || n(l.quantity) < 0)) throw new Error("Ligne: quantité invalide.");
    if (!(n(l.unit_price_ht) >= 0)) throw new Error("Ligne: prix unitaire HT invalide.");
    if (!(n(l.remise_percent) >= 0)) throw new Error("Ligne: remise invalide.");
    if (!(n(l.tva_percent) >= 0)) throw new Error("Ligne: TVA invalide.");
  }
}

function sP(x) { return String(x ?? "").trim(); }
function upperNoSpaceP(x) { return sP(x).toUpperCase().replace(/\s+/g, ""); }
function digitsP(x) { return sP(x).replace(/\D+/g, ""); }
function safeJsonParseP(x) {
  if (!x) return {};
  if (typeof x === "object") return x;
  try { return JSON.parse(String(x)); } catch { return {}; }
}

function pickVatId(entity, meta) {
  return upperNoSpaceP(
    entity?.vat_id ??
    entity?.vat_number ??
    entity?.vat ??
    entity?.tax_id ??
    entity?.pib ??                 // très probable côté Serbie
    entity?.company_vat ??
    meta?.vat_id ??
    meta?.vat_number ??
    meta?.vat ??
    meta?.tax_id ??
    meta?.pib
  );
}

const PEPPOL_CODELISTS_INDEX_URL = "https://docs.peppol.eu/edelivery/codelists/";
let _peppolSchemesInitPromise = null;

// Indexes (UNIQUE: ne pas dupliquer ailleurs dans le fichier)
let PEPPOL_SCHEMES_BY_COUNTRY = Object.create(null);
let PEPPOL_SCHEMES_BY_SCHEMEID = Object.create(null);

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: "GET", headers: { "user-agent": "D2F_Gestion/2.0" } },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve(data);
          else reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function fetchText(url) { return await httpGet(url); }
async function fetchJson(url) { return JSON.parse(await httpGet(url)); }

async function findLatestParticipantSchemesJsonUrl() {
  const html = await fetchText(PEPPOL_CODELISTS_INDEX_URL);

  const re1 = /href="([^"]*Participant%20identifier%20schemes[^"]*\.json)"/i;
  const m1 = html.match(re1);
  if (m1 && m1[1]) return new URL(m1[1], PEPPOL_CODELISTS_INDEX_URL).toString();

  const re2 = /href="([^"]*Participant[^"]*identifier[^"]*schemes[^"]*\.json)"/i;
  const m2 = html.match(re2);
  if (m2 && m2[1]) return new URL(m2[1], PEPPOL_CODELISTS_INDEX_URL).toString();

  throw new Error("PEPPOL: cannot find Participant identifier schemes JSON link");
}

function buildSchemeIndexes(data) {
  const byCountry = Object.create(null);
  const bySchemeId = Object.create(null);

  const values = Array.isArray(data?.values) ? data.values : [];

  for (const v of values) {
    const schemeid = sP(v?.schemeid);
    const iso6523 = sP(v?.iso6523);
    const country = upperNoSpaceP(v?.country);
    const state = sP(v?.state).toLowerCase();
    const name = sP(v?.scheme || v?.schemeName || v?.name);

    if (!schemeid || !iso6523) continue;
    if (state && state !== "active") continue;

    const rec = { schemeid, iso6523, country, name };

    bySchemeId[schemeid] = rec;

    if (/^[A-Z]{2}$/.test(country)) {
      if (!byCountry[country]) byCountry[country] = [];
      byCountry[country].push(rec);
    }
  }

  for (const cc of Object.keys(byCountry)) {
    byCountry[cc].sort((a, b) => a.schemeid.localeCompare(b.schemeid));
  }

  PEPPOL_SCHEMES_BY_COUNTRY = byCountry;
  PEPPOL_SCHEMES_BY_SCHEMEID = bySchemeId;
}

async function loadPeppolParticipantIdentifierSchemes() {
  if (_peppolSchemesInitPromise) return _peppolSchemesInitPromise;

  _peppolSchemesInitPromise = (async () => {
    const cacheFile = path.join(app.getPath("userData"), "peppol-participant-identifier-schemes.json");

    // 1) cache local
    try {
      const raw = await fsp.readFile(cacheFile, "utf8");
      const data = JSON.parse(raw);
      buildSchemeIndexes(data);
      if (Object.keys(PEPPOL_SCHEMES_BY_SCHEMEID).length) return;
    } catch {
      // ignore
    }

    // 2) download latest
    const url = await findLatestParticipantSchemesJsonUrl();
    const data = await fetchJson(url);

    // 3) persist + build
    await fsp.writeFile(cacheFile, JSON.stringify(data, null, 2), "utf8");
    buildSchemeIndexes(data);

    if (!Object.keys(PEPPOL_SCHEMES_BY_SCHEMEID).length) {
      throw new Error("PEPPOL: schemes index empty after load (unexpected JSON)");
    }
  })();

  return _peppolSchemesInitPromise;
}

/**
 * Résolution pragmatique (sans DNS) :
 * - si endpoint_id/scheme déjà fourni => OK
 * - sinon si country+vat => utilise `${CC}:VAT` si présent dans codelist
 * - sinon GLN (13 digits) => 0088
 * - sinon meta peppol_schemeid + peppol_participant_id
 * - sinon vide
 */
function resolveEndpointAuto(entity) {
  const meta = safeJsonParseP(entity?.meta_json);

  const country = upperNoSpaceP(entity?.country_code || entity?.country || meta?.country);

  // Helpers: sanity checks (pragmatiques, anti-rejets AP)
  const isIso6523 = (x) => /^\d{4}$/.test(String(x || ""));
  const isSaneEndpointId = (id) => {
    const v = upperNoSpaceP(id);
    if (!v) return false;
    if (v.length < 3 || v.length > 50) return false;
    if (/\s/.test(v)) return false;
    // évite placeholders du type NLSSSSSSSSSSSS / XXXXX / 000000...
    if (/^(.)\1{5,}$/.test(v)) return false;
    if (!/[0-9]/.test(v)) return false; // doit contenir au moins 1 chiffre
    if (!/^[A-Z0-9\-\.\:]+$/.test(v)) return false;
    return true;
  };

  const normalizeProvided = (endpoint_id, endpoint_scheme) => {
    const id = upperNoSpaceP(endpoint_id);
    const scheme = sP(endpoint_scheme);

    if (!id || !scheme) return null;
    if (!isIso6523(scheme)) return null;
    if (!isSaneEndpointId(id)) return null;

    // si scheme = VAT d'un pays, on vérifie au moins le préfixe (ex: AT..., FR..., NL...)
    // (pas parfait, mais évite beaucoup de rejets)
    if (country && PEPPOL_SCHEMES_BY_SCHEMEID?.[`${country}:VAT`]?.iso6523 === scheme) {
      if (!id.startsWith(country)) return null;
    }

    return { endpoint_id: id, endpoint_scheme: scheme };
  };

  // 0) déjà fourni (DB ou meta) => on valide
  {
    const provided = normalizeProvided(
      sP(entity?.endpoint_id) || sP(meta?.peppol_endpoint_id),
      sP(entity?.endpoint_scheme) || sP(meta?.peppol_endpoint_scheme)
    );
    if (provided) return provided;
  }

  // 1) explicite dans meta_json via schemeid + participant_id (recommandé) => on valide
  {
    const schemeid = sP(meta?.peppol_schemeid || meta?.participant_schemeid);
    const participantId = sP(meta?.peppol_participant_id || meta?.participant_id);

    if (schemeid && participantId) {
      const rec = PEPPOL_SCHEMES_BY_SCHEMEID?.[schemeid];
      const iso6523 = sP(rec?.iso6523);
      const normalized = normalizeProvided(participantId, iso6523);
      if (normalized) return normalized;
    }
  }

  // 2) GLN global fallback (le plus stable)
  {
    const gln = digitsP(entity?.gln || meta?.gln);
    if (/^\d{13}$/.test(gln)) {
      return { endpoint_id: gln, endpoint_scheme: "0088" };
    }
  }

  // 3) VAT country scheme (uniquement si VAT crédible + scheme actif)
  {
    const vatIdRaw = pickVatId(entity, meta);
    const vatId = upperNoSpaceP(vatIdRaw);

    if (country && vatId && isSaneEndpointId(vatId)) {
      const rec = PEPPOL_SCHEMES_BY_SCHEMEID?.[`${country}:VAT`];
      const iso6523 = sP(rec?.iso6523);

      // on n’utilise VAT que si on a bien un scheme ISO6523 actif
      if (iso6523 && isIso6523(iso6523)) {
        // garde-fou important : VAT doit commencer par le code pays (AT..., FR..., NL..., RS...)
        if (vatId.startsWith(country)) {
          return { endpoint_id: vatId, endpoint_scheme: iso6523 };
        }
      }
    }
  }

  return { endpoint_id: "", endpoint_scheme: "" };
}

function ensurePeppolExportPrereqsAuto(company, client) {
  const seller = resolveEndpointAuto(company);
  const buyer = resolveEndpointAuto(client);

  if (seller.endpoint_id && seller.endpoint_scheme) {
    company.endpoint_id = seller.endpoint_id;
    company.endpoint_scheme = seller.endpoint_scheme;
  }
  if (buyer.endpoint_id && buyer.endpoint_scheme) {
    client.endpoint_id = buyer.endpoint_id;
    client.endpoint_scheme = buyer.endpoint_scheme;
  }

  if (!sP(company?.endpoint_id) || !sP(company?.endpoint_scheme)) {
    throw new Error("PEPPOL: Seller EndpointID + scheme requis.");
  }
  const buyerCountry = upperNoSpaceP(client?.country);

  const hasEndpoint =
  sP(client?.endpoint_id) &&
  sP(client?.endpoint_scheme);

  const strictPeppol =
    opts?.profile === "peppol-bis3" &&
    opts?.transport === "peppol";

  if (strictPeppol && !hasEndpoint) {
    throw new Error(
      "Client non résolu dans le réseau PEPPOL. EndpointID requis."
    );
  }
}

async function ensurePeppolExportPrereqsAutoUniversal(company, client, _opts = {}) {
  await loadPeppolParticipantIdentifierSchemes();
  return ensurePeppolExportPrereqsAuto(company, client);
}

// -------------------- Profiles / Customization --------------------
function resolveCustomizationId(profile) {
  const p = s(profile);

  switch (p) {
    // PEPPOL BIS Billing 3.0 (UBL 2.1)
    case "peppol-bis3":
      return "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";

    // CTC-FR (si tu utilises ce profil)
    case "ctc-fr-extended":
      return "urn:cen.eu:en16931:2017#conformant#urn.cpro.gouv.fr:1p0:extended-ctc-fr";

    case "ctc-fr-en16931":
      return "urn:cen.eu:en16931:2017";

    default:
      throw new Error(`Unknown e-invoicing profile: ${p}`);
  }
}

function resolveProfileId(profile, businessProcessId) {
  const p = s(profile);

  switch (p) {
    // PEPPOL BIS Billing 3.0
    case "peppol-bis3":
      return "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

    // CTC-FR : ne pas laisser vide (tolérance validateurs)
    case "ctc-fr-extended":
    case "ctc-fr-en16931":
      return s(businessProcessId) || "urn:cen.eu:en16931:2017";

    default:
      throw new Error(`Unknown e-invoicing profile: ${p}`);
  }
}

// -------------------- UBL 2.1 (EN16931 / CTC-FR / PEPPOL BIS) --------------------
function buildPeppolUbl21Document({
  company,
  client,
  invoice,
  lines,
  refs = {
    prepayments: [], // [{ id, invoice_number, date }]
    original: null,  // { id, invoice_number, date }
  },
  profile = "peppol-bis3", // ✅ IMPORTANT: PEPPOL par défaut pour usage international
}) {
  const currency = s(invoice.currency || company.currency || "EUR").toUpperCase();
  const issueDate = isoDate(invoice.date);
  const dueDate = invoice.due_date ? isoDate(invoice.due_date) : "";

  const type = s(invoice.type || "final");
  const isCredit = type === "credit_note";
  const isDeposit = type === "deposit";

  // IDs calculés
  const customizationId = resolveCustomizationId(profile);
  const profileId = resolveProfileId(
    profile,
    invoice?.business_process_id || invoice?.meta?.business_process_id
  );

  // Document identifiers
  const docId = s(invoice.invoice_number || invoice.id);
  const buyerReference = s(invoice.buyer_reference) || s(client.buyer_reference);

  // Totals snapshot
  const totalsSnapshot = safeJsonParse(invoice.totals_json, null);
  const taxSnapshot = safeJsonParse(invoice.tax_breakdown_json, null);

  const totals = totalsSnapshot || {
    total_ht: round2(invoice.total_ht),
    total_tva: round2(invoice.total_tva),
    total_ttc: round2(invoice.total_ttc),
  };

  const taxBreakdown = taxSnapshot || computeTaxBreakdown(lines);

  // BT-113 / BT-115
  const prepaid = round2(n(invoice.prepaid_amount, 0));
  const computedPayable = computeAmountDueByType(type, totals.total_ttc, prepaid);
  const payable = round2(n(invoice.amount_due, computedPayable));

  // --- endpoints
  const sellerEndpointId = s(company.endpoint_id);
  const sellerEndpointScheme = s(company.endpoint_scheme);
  const buyerEndpointId = s(client.endpoint_id);
  const buyerEndpointScheme = s(client.endpoint_scheme);

  const endpointXml = (id, scheme) => {
    if (!id || !scheme) return "";
    return `<cbc:EndpointID schemeID="${eXml(scheme)}">${eXml(id)}</cbc:EndpointID>`;
  };

  // --- Party helpers
  const partyAddress = (p) => `
    <cac:PostalAddress>
      <cbc:StreetName>${eXml(s(p.street))}</cbc:StreetName>
      ${s(p.street2) ? `<cbc:AdditionalStreetName>${eXml(s(p.street2))}</cbc:AdditionalStreetName>` : ""}
      <cbc:CityName>${eXml(s(p.city))}</cbc:CityName>
      ${s(p.state) ? `<cbc:CountrySubentity>${eXml(s(p.state))}</cbc:CountrySubentity>` : ""}
      <cbc:PostalZone>${eXml(s(p.postal_code))}</cbc:PostalZone>
      <cac:Country><cbc:IdentificationCode>${eXml(s(p.country).toUpperCase())}</cbc:IdentificationCode></cac:Country>
    </cac:PostalAddress>`;

  const partyContact = (p) => {
    const phone = s(p.phone);
    const email = s(p.email);
    if (!phone && !email) return "";
    return `
      <cac:Contact>
        ${phone ? `<cbc:Telephone>${eXml(phone)}</cbc:Telephone>` : ""}
        ${email ? `<cbc:ElectronicMail>${eXml(email)}</cbc:ElectronicMail>` : ""}
      </cac:Contact>`;
  };

  const partyTaxScheme = (vatId) => {
    if (!vatId) return "";
    return `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${eXml(vatId)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>`;
  };

  const partyIdentification = (id, scheme) => {
    if (!s(id)) return "";
    const schemeAttr = s(scheme) ? ` schemeID="${eXml(scheme)}"` : "";
    return `
      <cac:PartyIdentification>
        <cbc:ID${schemeAttr}>${eXml(s(id))}</cbc:ID>
      </cac:PartyIdentification>`;
  };

  // PEPPOL helper: si AE et pas de code => VATEX-EU-AE
  function normalizeTaxExemption({ vat_category, vat_exempt_reason, vat_exempt_code }) {
    const cat = s(vat_category || "").toUpperCase();
    const reason = s(vat_exempt_reason);
    let code = s(vat_exempt_code);

    if (cat === "AE" && !code) code = "VATEX-EU-AE"; // PEPPOL VATEX list

    return { cat, reason, code };
  }

  function taxExemptionXml({ vat_category, vat_exempt_reason, vat_exempt_code }) {
    const { cat, reason, code } = normalizeTaxExemption({
      vat_category,
      vat_exempt_reason,
      vat_exempt_code,
    });

    if (!reason && !code && !["AE", "E", "Z", "O", "G", "K"].includes(cat)) return "";

    return `
          ${code ? `<cbc:TaxExemptionReasonCode>${eXml(code)}</cbc:TaxExemptionReasonCode>` : ""}
          ${reason ? `<cbc:TaxExemptionReason>${eXml(reason)}</cbc:TaxExemptionReason>` : ""}`;
  }

  const orderRef = s(invoice.purchase_order_ref)
    ? `<cac:OrderReference><cbc:ID>${eXml(s(invoice.purchase_order_ref))}</cbc:ID></cac:OrderReference>`
    : "";

  const contractRef = s(invoice.contract_ref)
    ? `<cac:ContractDocumentReference><cbc:ID>${eXml(s(invoice.contract_ref))}</cbc:ID></cac:ContractDocumentReference>`
    : "";

  const billingRefs = [];

  for (const p of Array.isArray(refs.prepayments) ? refs.prepayments : []) {
    const id = s(p.invoice_number || p.id);
    if (!id) continue;
    billingRefs.push(`
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${eXml(id)}</cbc:ID>
      ${p.date ? `<cbc:IssueDate>${eXml(isoDate(p.date))}</cbc:IssueDate>` : ""}
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>`);
  }

  if (isCredit && refs.original && s(refs.original.invoice_number || refs.original.id)) {
    const oid = s(refs.original.invoice_number || refs.original.id);
    billingRefs.push(`
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${eXml(oid)}</cbc:ID>
      ${refs.original.date ? `<cbc:IssueDate>${eXml(isoDate(refs.original.date))}</cbc:IssueDate>` : ""}
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>`);
  }

  const billingReferencesXml = billingRefs.join("\n");

  const paymentMeansCode = "30";
  const paymentTerms = s(company.payment_terms);

  const paymentBlock = isCredit
    ? ""
    : `
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode listID="UNCL4461">${eXml(paymentMeansCode)}</cbc:PaymentMeansCode>
    ${
      s(company.iban)
        ? `
    <cac:PayeeFinancialAccount>
      <cbc:ID>${eXml(s(company.iban))}</cbc:ID>
      ${
        s(company.bic)
          ? `<cac:FinancialInstitutionBranch><cbc:ID>${eXml(s(company.bic))}</cbc:ID></cac:FinancialInstitutionBranch>`
          : ""
      }
    </cac:PayeeFinancialAccount>`
        : ""
    }
  </cac:PaymentMeans>
  ${paymentTerms ? `<cac:PaymentTerms><cbc:Note>${eXml(paymentTerms)}</cbc:Note></cac:PaymentTerms>` : ""}`;

  const taxTotal = `
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${eXml(currency)}">${round2(totals.total_tva).toFixed(2)}</cbc:TaxAmount>
    ${taxBreakdown
      .map((tb) => {
        const cat = s(tb.vat_category || "S").toUpperCase();
        const rate = round2(tb.tva_percent);
        const taxable = round2(tb.taxable_ht);
        const vat = round2(tb.vat_amount);

        return `
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${eXml(currency)}">${taxable.toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${eXml(currency)}">${vat.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${eXml(cat)}</cbc:ID>
        <cbc:Percent>${rate.toFixed(2)}</cbc:Percent>${taxExemptionXml({
          vat_category: cat,
          vat_exempt_reason: tb.vat_exempt_reason || invoice.vat_exempt_reason,
          vat_exempt_code: tb.vat_exempt_code || invoice.vat_exempt_code,
        })}
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`;
      })
      .join("")}
  </cac:TaxTotal>`;

  const monetary = `
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${eXml(currency)}">${round2(totals.total_ht).toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${eXml(currency)}">${round2(totals.total_ht).toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${eXml(currency)}">${round2(totals.total_ttc).toFixed(2)}</cbc:TaxInclusiveAmount>
    ${!isCredit && prepaid !== 0 ? `<cbc:PrepaidAmount currencyID="${eXml(currency)}">${prepaid.toFixed(2)}</cbc:PrepaidAmount>` : ""}
    <cbc:PayableAmount currencyID="${eXml(currency)}">${round2(payable).toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>`;

  function lineAllowanceChargeXml({ qty, unitPrice, discountPercent }) {
    const discount = round2(discountPercent);
    if (!(discount > 0)) return "";

    const baseAmount = round2(qty * unitPrice);
    const amount = round2(baseAmount * (discount / 100));

    return `
    <cac:AllowanceCharge>
      <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
      <cbc:MultiplierFactorNumeric>${(discount / 100).toFixed(4)}</cbc:MultiplierFactorNumeric>
      <cbc:Amount currencyID="${eXml(currency)}">${amount.toFixed(2)}</cbc:Amount>
      <cbc:BaseAmount currencyID="${eXml(currency)}">${baseAmount.toFixed(2)}</cbc:BaseAmount>
    </cac:AllowanceCharge>`;
  }

  const lineTag = isCredit ? "cac:CreditNoteLine" : "cac:InvoiceLine";
  const qtyTag = isCredit ? "cbc:CreditedQuantity" : "cbc:InvoicedQuantity";

  const linesXml = (Array.isArray(lines) ? lines : [])
    .map((l, idx) => {
      // CreditNote: quantité positive pour interop, montants peuvent rester négatifs
      const qtyRaw = n(l.quantity, 1);
      const qty = isCredit ? Math.abs(qtyRaw) : qtyRaw;

      const unitCode = s(l.unit_code || "C62");
      const unitPrice = round2(l.unit_price_ht);
      const discount = round2(l.remise_percent);

      const lineNet = round2(computeLineTotals(l).ht);

      const cat = s(l.vat_category || (n(l.tva_percent) === 0 ? "Z" : "S")).toUpperCase() || "S";
      const rate = round2(l.tva_percent);

      return `
  <${lineTag}>
    <cbc:ID>${idx + 1}</cbc:ID>
    <${qtyTag} unitCode="${eXml(unitCode)}">${round2(qty).toFixed(2)}</${qtyTag}>
    <cbc:LineExtensionAmount currencyID="${eXml(currency)}">${lineNet.toFixed(2)}</cbc:LineExtensionAmount>
    ${lineAllowanceChargeXml({ qty, unitPrice, discountPercent: discount })}
    <cac:Item>
      <cbc:Name>${eXml(s(l.description))}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${eXml(cat)}</cbc:ID>
        <cbc:Percent>${rate.toFixed(2)}</cbc:Percent>${taxExemptionXml({
          vat_category: cat,
          vat_exempt_reason: s(l.vat_exempt_reason) || s(invoice.vat_exempt_reason),
          vat_exempt_code: s(l.vat_exempt_code) || s(invoice.vat_exempt_code),
        })}
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${eXml(currency)}">${unitPrice.toFixed(2)}</cbc:PriceAmount>
    </cac:Price>
  </${lineTag}>`;
    })
    .join("\n");

  const supplierParty = `
  <cac:AccountingSupplierParty>
    <cac:Party>
      ${endpointXml(sellerEndpointId, sellerEndpointScheme)}
      ${partyIdentification(company.legal_id, company.legal_id_scheme)}
      <cac:PartyName><cbc:Name>${eXml(s(company.legal_name))}</cbc:Name></cac:PartyName>
      ${partyAddress(company)}
      ${partyTaxScheme(s(company.vat_id))}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${eXml(s(company.legal_name))}</cbc:RegistrationName>
        ${s(company.legal_id) ? `<cbc:CompanyID>${eXml(s(company.legal_id))}</cbc:CompanyID>` : ""}
      </cac:PartyLegalEntity>
      ${partyContact(company)}
    </cac:Party>
  </cac:AccountingSupplierParty>`;

  const customerParty = `
  <cac:AccountingCustomerParty>
    <cac:Party>
      ${endpointXml(buyerEndpointId, buyerEndpointScheme)}
      ${partyIdentification(client.legal_id, client.legal_id_scheme)}
      <cac:PartyName><cbc:Name>${eXml(s(client.name))}</cbc:Name></cac:PartyName>
      ${partyAddress(client)}
      ${partyTaxScheme(s(client.vat_id))}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${eXml(s(client.name))}</cbc:RegistrationName>
        ${s(client.legal_id) ? `<cbc:CompanyID>${eXml(s(client.legal_id))}</cbc:CompanyID>` : ""}
      </cac:PartyLegalEntity>
      ${partyContact(client)}
    </cac:Party>
  </cac:AccountingCustomerParty>`;

  if (isCredit) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">

  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>${eXml(customizationId)}</cbc:CustomizationID>
  <cbc:ProfileID>${eXml(profileId)}</cbc:ProfileID>

  <cbc:ID>${eXml(docId)}</cbc:ID>
  <cbc:IssueDate>${eXml(issueDate)}</cbc:IssueDate>
  <cbc:CreditNoteTypeCode listID="UNCL1001">381</cbc:CreditNoteTypeCode>
  <cbc:DocumentCurrencyCode>${eXml(currency)}</cbc:DocumentCurrencyCode>

  ${buyerReference ? `<cbc:BuyerReference>${eXml(buyerReference)}</cbc:BuyerReference>` : ""}
  ${s(invoice.notes) ? `<cbc:Note>${eXml(s(invoice.notes))}</cbc:Note>` : ""}

  ${orderRef}
  ${contractRef}
  ${billingReferencesXml}

  ${supplierParty}
  ${customerParty}

  ${taxTotal}
  ${monetary}

  ${linesXml}

</CreditNote>`;
  }

  const invoiceTypeCode = isDeposit ? "386" : "380";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">

  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>${eXml(customizationId)}</cbc:CustomizationID>
  <cbc:ProfileID>${eXml(profileId)}</cbc:ProfileID>

  <cbc:ID>${eXml(docId)}</cbc:ID>
  <cbc:IssueDate>${eXml(issueDate)}</cbc:IssueDate>
  ${dueDate ? `<cbc:DueDate>${eXml(dueDate)}</cbc:DueDate>` : ""}
  <cbc:InvoiceTypeCode listID="UNCL1001">${eXml(invoiceTypeCode)}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${eXml(currency)}</cbc:DocumentCurrencyCode>

  ${buyerReference ? `<cbc:BuyerReference>${eXml(buyerReference)}</cbc:BuyerReference>` : ""}
  ${s(invoice.notes) ? `<cbc:Note>${eXml(s(invoice.notes))}</cbc:Note>` : ""}

  ${orderRef}
  ${contractRef}
  ${billingReferencesXml}

  ${supplierParty}
  ${customerParty}

  ${paymentBlock}

  ${taxTotal}
  ${monetary}

  ${linesXml}

</Invoice>`;
}

// -------------------- AUDIT helpers --------------------
function sha256Hex(data) {
  return crypto.createHash("sha256").update(String(data)).digest("hex");
}

function stableStringify(obj) {
  if (obj == null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",")}}`;
}

function invoiceAuditFingerprint(invoice, lines) {
  const core = {
    id: invoice?.id,
    quote_id: invoice?.quote_id || null,
    client_id: invoice?.client_id || null,
    type: invoice?.type,
    status: invoice?.status,
    invoice_number: invoice?.invoice_number || null,
    date: invoice?.date || null,
    due_date: invoice?.due_date || null,
    currency: invoice?.currency || "EUR",
    vat_mode: invoice?.vat_mode || "AUTO",
    prepaid_amount: round2(n(invoice?.prepaid_amount, 0)),
    amount_due: round2(n(invoice?.amount_due, 0)),
    totals: {
      total_ht: round2(n(invoice?.total_ht, 0)),
      total_tva: round2(n(invoice?.total_tva, 0)),
      total_ttc: round2(n(invoice?.total_ttc, 0)),
    },
    lines: (Array.isArray(lines) ? lines : []).map((l) => ({
      description: s(l.description),
      quantity: round2(n(l.quantity, 0)),
      unit_price_ht: round2(n(l.unit_price_ht, 0)),
      remise_percent: round2(n(l.remise_percent, 0)),
      tva_percent: round2(n(l.tva_percent, 0)),
      vat_category: s(l.vat_category || ""),
      unit_code: s(l.unit_code || "C62"),
      line_type: s(l.line_type || "standard"),
      item_type: s(l.item_type || "SERVICE"),
    })),
  };

  const canonical = stableStringify(core);
  return {
    fingerprint_sha256: sha256Hex(canonical),
    lines_count: core.lines.length,
    totals: core.totals,
  };
}

function getAuditConfig() {
  return {
    logPath: getAuditLogPath(app),
    hmacSecret: process.env.AUDIT_HMAC_SECRET || null,
    tsaUrl: process.env.AUDIT_TSA_URL || null,
    appMeta: {
      app: "myapp",
      version: app?.getVersion ? app.getVersion() : "",
      env: process.env.NODE_ENV || "",
    },
    auditReads: String(process.env.AUDIT_READS || "").toLowerCase() === "1",
  };
}

function auditSafe(e, { action, entityType, entityId, payload, refs }) {
  try {
    const cfg = getAuditConfig();
    const actor =
      (payload && payload.actor) ||
      (e?.senderFrame?.url ? `renderer:${e.senderFrame.url}` : "system");

    return appendAuditEvent({
      logPath: cfg.logPath,
      hmacSecret: cfg.hmacSecret,
      tsaUrl: cfg.tsaUrl,
      actor,
      action,
      entityType,
      entityId,
      payload: payload || {},
      refs: refs || {},
      appMeta: cfg.appMeta,
    });
  } catch (err) {
    try {
      console.error("[AUDIT] failed:", err?.message || err);
    } catch {}
    return null;
  }
}

// -------------------- deposits helpers (linking + prepaid) --------------------
function listIssuedDepositsByQuote(db, quoteId) {
  return db
    .prepare(
      `
      SELECT id, invoice_number, date, total_ttc
      FROM invoices
      WHERE quote_id = ?
        AND type = 'deposit'
        AND status = 'issued'
      ORDER BY date ASC, invoice_number ASC, id ASC
    `
    )
    .all(quoteId);
}

function sumIssuedDepositsTtcByQuote(db, quoteId) {
  const row = db
    .prepare(
      `
      WITH
      dep AS (
        SELECT COALESCE(SUM(COALESCE(total_ttc,0)),0) AS dep_ttc
        FROM invoices
        WHERE quote_id = ?
          AND type = 'deposit'
          AND status = 'issued'
      ),
      cred AS (
        -- Avoirs émis dont la source est un acompte de CE devis
        SELECT COALESCE(SUM(COALESCE(cn.total_ttc,0)),0) AS cred_ttc
        FROM invoices cn
        JOIN invoices src ON src.id = cn.source_invoice_id
        WHERE cn.type='credit_note'
          AND cn.status='issued'
          AND src.type='deposit'
          AND src.status='issued'
          AND src.quote_id = ?
      )
      SELECT dep.dep_ttc AS dep_ttc, cred.cred_ttc AS cred_ttc
      FROM dep, cred;
      `
    )
    .get(quoteId, quoteId);

  return round2(n(row?.dep_ttc) + n(row?.cred_ttc));
}


function syncPrepaymentLinks(db, { quoteId, finalInvoiceId, now }) {
  if (!tableExists(db, "invoice_links")) return;

  db.prepare(
    `
    DELETE FROM invoice_links
    WHERE to_invoice_id = ?
      AND link_type = 'prepayment_of'
  `
  ).run(finalInvoiceId);

  const deposits = listIssuedDepositsByQuote(db, quoteId);

  const ins = db.prepare(
    `
    INSERT INTO invoice_links (id, from_invoice_id, to_invoice_id, link_type, created_at)
    VALUES (@id, @from_id, @to_id, 'prepayment_of', @created_at)
  `
  );

  for (const d of deposits) {
    ins.run({
      id: randomUUID(),
      from_id: d.id,
      to_id: finalInvoiceId,
      created_at: now,
    });
  }
}

// -------------------- PEPPOL/EN16931 validations (pragmatic, actionable) --------------------
function money(x) {
  return round2(n(x, 0));
}

function isIso4217(code) {
  return /^[A-Z]{3}$/.test(String(code || "").toUpperCase());
}

function isIso3166(code) {
  return /^[A-Z]{2}$/.test(String(code || "").toUpperCase());
}

// Renvoie [{code, path, message, hint}]
function validatePeppolEn16931({ company, client, invoice, lines, totals, taxBreakdown }) {
  const issues = [];
  const add = (code, path, message, hint = "") => issues.push({ code, path, message, hint });

  const currency = String(invoice?.currency || company?.currency || "EUR").toUpperCase();

  if (!s(invoice?.date)) add("EN16931", "invoice.date", "Date de facture manquante (BT-2).");
  if (!isIso4217(currency)) add("EN16931", "invoice.currency", "Devise invalide (BT-5).", "Ex: EUR");

  if (!s(company?.legal_name))
    add("EN16931", "company.legal_name", "Raison sociale vendeur manquante (BT-27).");
  if (!s(company?.street) || !s(company?.postal_code) || !s(company?.city))
    add("EN16931", "company.address", "Adresse vendeur incomplète (BG-5).");
  if (!isIso3166(company?.country))
    add(
      "EN16931",
      "company.country",
      "Pays vendeur invalide (BT-40).",
      "Code ISO-3166-1 alpha-2 (ex: FR)"
    );

  if (!s(client?.name))
    add("EN16931", "client.name", "Nom/raison sociale client manquant (BT-44).");
  if (!s(client?.street) || !s(client?.postal_code) || !s(client?.city))
    add("EN16931", "client.address", "Adresse client incomplète (BG-8).");
  if (!isIso3166(client?.country))
    add(
      "EN16931",
      "client.country",
      "Pays client invalide (BT-55).",
      "Code ISO-3166-1 alpha-2 (ex: FR)"
    );

  if (!Array.isArray(lines) || lines.length === 0)
    add("EN16931", "lines", "Au moins une ligne est requise (BG-25).");
  else {
    lines.forEach((l, i) => {
      const idx = i + 1;
      if (!s(l.description))
        add("EN16931", `lines[${idx}].description`, "Description ligne manquante (BT-153).");
      if (!Number.isFinite(n(l.quantity)) || n(l.quantity) === 0)
        add("EN16931", `lines[${idx}].quantity`, "Quantité ligne invalide (BT-129).");
      if (!Number.isFinite(n(l.unit_price_ht)) || n(l.unit_price_ht) < 0)
        add("EN16931", `lines[${idx}].unit_price_ht`, "Prix unitaire HT invalide (BT-146).");
      if (!Number.isFinite(n(l.tva_percent)) || n(l.tva_percent) < 0)
        add("EN16931", `lines[${idx}].tva_percent`, "TVA % invalide (BT-152).");
      const cat = s(l.vat_category || "").toUpperCase();
      if (!cat)
        add(
          "EN16931",
          `lines[${idx}].vat_category`,
          "Catégorie TVA manquante (BT-151).",
          "Ex: S, Z, AE, E"
        );
    });
  }

  const totalHt = money(totals?.total_ht ?? invoice?.total_ht);
  const totalTva = money(totals?.total_tva ?? invoice?.total_tva);
  const totalTtc = money(totals?.total_ttc ?? invoice?.total_ttc);

  const prepaid = money(invoice?.prepaid_amount);
  const amountDue = money(invoice?.amount_due);

  const recomputed = computeInvoiceTotals(lines || []);
  const recHt = money(recomputed.total_ht);
  const recTva = money(recomputed.total_tva);
  const recTtc = money(recomputed.total_ttc);

  if (Math.abs(totalHt - recHt) > 0.01)
    add(
      "EN16931",
      "totals.total_ht",
      `Total HT incohérent. DB=${totalHt.toFixed(2)} vs calcul=${recHt.toFixed(2)}.`
    );

  if (Math.abs(totalTva - recTva) > 0.01)
    add(
      "EN16931",
      "totals.total_tva",
      `Total TVA incohérent. DB=${totalTva.toFixed(2)} vs calcul=${recTva.toFixed(2)}.`
    );

  if (Math.abs(totalTtc - (totalHt + totalTva)) > 0.01)
    add(
      "EN16931",
      "totals.total_ttc",
      `Total TTC doit être HT+TVA. TTC=${totalTtc.toFixed(2)} vs HT+TVA=${(totalHt + totalTva).toFixed(2)}.`
    );

  const expectedDue = computeAmountDueByType(invoice?.type, totalTtc, prepaid);
  if (Math.abs(amountDue - expectedDue) > 0.01) {
    add(
      "EN16931",
      "invoice.amount_due",
      `Reste à payer incohérent (BT-115). DB=${amountDue.toFixed(2)} vs attendu=${expectedDue.toFixed(2)}.`,
      "Vérifie les acomptes (BT-113) et le TTC."
    );
  }

  const breakdown = Array.isArray(taxBreakdown) ? taxBreakdown : computeTaxBreakdown(lines || []);
  const sumTaxable = money(breakdown.reduce((a, x) => a + money(x.taxable_ht), 0));
  const sumVat = money(breakdown.reduce((a, x) => a + money(x.vat_amount), 0));

  if (Math.abs(sumTaxable - totalHt) > 0.02) {
    add(
      "EN16931",
      "tax_breakdown.taxable_sum",
      `Somme des bases TVA incohérente. ΣTaxable=${sumTaxable.toFixed(2)} vs TotalHT=${totalHt.toFixed(2)}.`,
      "Vérifie les catégories TVA des lignes."
    );
  }
  if (Math.abs(sumVat - totalTva) > 0.02) {
    add(
      "EN16931",
      "tax_breakdown.vat_sum",
      `Somme des montants TVA incohérente. ΣTVA=${sumVat.toFixed(2)} vs TotalTVA=${totalTva.toFixed(2)}.`,
      "Vérifie les taux TVA et l’arrondi."
    );
  }

  if (!s(company?.endpoint_id) || !s(company?.endpoint_scheme))
    add(
      "PEPPOL",
      "company.endpoint",
      "Endpoint vendeur manquant.",
      "Renseigne endpoint_id + endpoint_scheme (ex: 0088 + GLN)."
    );

  if (!s(client?.endpoint_id) || !s(client?.endpoint_scheme))
    add(
      "PEPPOL",
      "client.endpoint",
      "Endpoint client manquant.",
      "Renseigne endpoint_id + endpoint_scheme (ex: 0002 + SIREN)."
    );

  if (String(client?.customer_type || "").toUpperCase() === "B2G") {
    const br = s(invoice?.buyer_reference) || s(client?.buyer_reference);
    if (!br) add("PEPPOL", "invoice.buyer_reference", "BuyerReference requis en B2G (BT-10).");
  }

  return issues;
}

// -------------------- IPC handlers --------------------
module.exports = (ipcMain, getDb) => {
  const db = () => getDb();

  // -------- list
  ipcMain.handle("invoices:list", (_e, query = {}) => {
    ensureInvoicesSchema(db());

    const cfg = getAuditConfig();
    if (cfg.auditReads) {
      auditSafe(_e, {
        action: "invoices.list",
        entityType: "invoice",
        entityId: "*",
        refs: {
          query: { status: s(query.status), type: s(query.type), client_id: s(query.client_id) },
        },
      });
    }

    const params = [];
    let where = "1=1";

    if (query.status) {
      where += " AND i.status = ?";
      params.push(s(query.status));
    }
    if (query.type) {
      where += " AND i.type = ?";
      params.push(s(query.type));
    }
    if (query.client_id) {
      where += " AND i.client_id = ?";
      params.push(s(query.client_id));
    }

    return db()
      .prepare(
        `
        SELECT
          i.*,
          c.name AS client_name,
          COALESCE(i.amount_due, ROUND(COALESCE(i.total_ttc,0) - COALESCE(i.prepaid_amount,0), 2)) AS payable_amount
        FROM invoices i
        LEFT JOIN clients c ON c.id = i.client_id
        WHERE ${where}
        ORDER BY COALESCE(i.updated_at, i.created_at) DESC
      `
      )
      .all(...params);
  });

  // -------- getFull
  ipcMain.handle("invoices:getFull", (_e, { id } = {}) => {
    const cfg = getAuditConfig();
    if (cfg.auditReads) {
      auditSafe(_e, { action: "invoices.getFull", entityType: "invoice", entityId: s(id) });
    }
    return getFull(db(), s(id));
  });

  // -------- get (compat)
  ipcMain.handle("invoices:get", (_e, { id } = {}) => {
    const cfg = getAuditConfig();
    if (cfg.auditReads) {
      auditSafe(_e, { action: "invoices.get", entityType: "invoice", entityId: s(id) });
    }
    const full = getFull(db(), s(id));
    if (!full) return null;
    return { ...full.invoice, lines: full.lines };
  });

  // -------- create (draft)
  ipcMain.handle("invoices:create", (_e, payload = {}) => {
    ensureInvoicesSchema(db());

    const id = randomUUID();
    const t = nowIso();

    const linesIn = Array.isArray(payload.lines) ? payload.lines : [];
    const currency = s(payload.currency) || "EUR";
    const wantedType = (() => {
      const tp = s(payload.type) || "final";
      return ["final", "deposit", "credit_note"].includes(tp) ? tp : "final";
    })();

    auditSafe(_e, {
      action: "invoices.create_requested",
      entityType: "invoice",
      entityId: id,
      refs: {
        quote_id: payload.quote_id || null,
        client_id: payload.client_id || null,
        currency,
        type: wantedType,
      },
      payload: {
        status_after: "draft",
        input: { has_lines: Array.isArray(linesIn) && linesIn.length > 0 },
      },
    });

    const tx = db().transaction(() => {
      const prepaid0 = round2(n(payload.prepaid_amount, 0));

      db()
        .prepare(
          `
          INSERT INTO invoices (
            id, quote_id, client_id, type, status,
            date, due_date, currency, notes,
            buyer_reference, purchase_order_ref, contract_ref,
            vat_mode, vat_exempt_reason, vat_exempt_code,
            source_invoice_id,
            prepaid_amount,
            amount_due,
            use_case_code, use_case_meta_json, meta_json,
            totals_json, tax_breakdown_json,
            total_ht, total_tva, total_ttc,
            created_at, updated_at
          ) VALUES (
            @id, @quote_id, @client_id, @type, 'draft',
            @date, @due_date, @currency, @notes,
            @buyer_reference, @purchase_order_ref, @contract_ref,
            @vat_mode, @vat_exempt_reason, @vat_exempt_code,
            @source_invoice_id,
            @prepaid_amount,
            0,
            @use_case_code, @use_case_meta_json, @meta_json,
            '', '',
            0, 0, 0,
            @created_at, @updated_at
          )
        `
        )
        .run({
          id,
          quote_id: payload.quote_id || null,
          client_id: payload.client_id || null,
          type: wantedType,
          date: isoDate(payload.date) || t.slice(0, 10),
          due_date: payload.due_date ? isoDate(payload.due_date) : null,
          currency,
          notes: s(payload.notes),

          buyer_reference: s(payload.buyer_reference),
          purchase_order_ref: s(payload.purchase_order_ref),
          contract_ref: s(payload.contract_ref),

          vat_mode: s(payload.vat_mode || "AUTO").toUpperCase(),
          vat_exempt_reason: s(payload.vat_exempt_reason),
          vat_exempt_code: s(payload.vat_exempt_code),

          source_invoice_id: payload.source_invoice_id || null,
          prepaid_amount: prepaid0,

          use_case_code: s(payload.use_case_code),
          use_case_meta_json: toJson(payload.use_case_meta || {}),
          meta_json: toJson(payload.meta_json || payload.meta || {}),

          created_at: t,
          updated_at: t,
        });

      const persisted = persistInvoiceLines(db(), id, linesIn);
      const totals = computeInvoiceTotals(persisted);
      const taxBreakdown = computeTaxBreakdown(persisted);

      const due = computeAmountDueByType(wantedType, totals.total_ttc, prepaid0);

      const fp = invoiceAuditFingerprint(
        {
          id,
          quote_id: payload.quote_id || null,
          client_id: payload.client_id || null,
          type: wantedType,
          status: "draft",
          date: isoDate(payload.date) || t.slice(0, 10),
          currency,
          vat_mode: s(payload.vat_mode || "AUTO").toUpperCase(),
          prepaid_amount: prepaid0,
          amount_due: due,
          ...totals,
        },
        persisted
      );

      auditSafe(_e, {
        action: "invoices.snapshot",
        entityType: "invoice",
        entityId: id,
        refs: {
          phase: "draft_after_create",
          lines_count: fp.lines_count,
          total_ttc: fp.totals.total_ttc,
          prepaid_amount: prepaid0,
          amount_due: due,
        },
        payload: { fingerprint_sha256: fp.fingerprint_sha256 },
      });

      db()
        .prepare(
          `
          UPDATE invoices SET
            total_ht=@total_ht,
            total_tva=@total_tva,
            total_ttc=@total_ttc,
            amount_due=@amount_due,
            tax_breakdown_json=@tax_breakdown_json,
            totals_json=@totals_json,
            updated_at=@updated_at
          WHERE id=@id
        `
        )
        .run({
          id,
          total_ht: totals.total_ht,
          total_tva: totals.total_tva,
          total_ttc: totals.total_ttc,
          amount_due: due,
          totals_json: toJson(totals),
          tax_breakdown_json: toJson(taxBreakdown),
          updated_at: t,
        });
    });

    tx();

    auditSafe(_e, {
      action: "invoices.create_committed",
      entityType: "invoice",
      entityId: id,
      refs: { status_after: "draft" },
    });

    return { ok: true, id };
  });

  // -------- update/save (draft only)
  function updateDraft(_e, payload = {}) {
    ensureInvoicesSchema(db());

    const id = s(payload.id);
    if (!id) throw new Error("Invoice id required");
    ensureDraft(db(), id);

    const t = nowIso();
    const linesIn = Array.isArray(payload.lines) ? payload.lines : [];

    const wantedType = (() => {
      const tp = s(payload.type) || "final";
      return ["final", "deposit", "credit_note"].includes(tp) ? tp : "final";
    })();

    const tx = db().transaction(() => {
      const persisted = persistInvoiceLines(db(), id, linesIn);
      const totals = computeInvoiceTotals(persisted);
      const taxBreakdown = computeTaxBreakdown(persisted);

      const prepaid = round2(n(payload.prepaid_amount, 0));
      const due = computeAmountDueByType(wantedType, totals.total_ttc, prepaid);

      const fp = invoiceAuditFingerprint(
        {
          id,
          status: "draft",
          client_id: payload.client_id || null,
          type: wantedType,
          date: isoDate(payload.date) || t.slice(0, 10),
          currency: s(payload.currency) || "EUR",
          vat_mode: s(payload.vat_mode || "AUTO").toUpperCase(),
          prepaid_amount: prepaid,
          amount_due: due,
          ...totals,
        },
        persisted
      );

      auditSafe(_e, {
        action: "invoices.update_draft",
        entityType: "invoice",
        entityId: id,
        refs: {
          phase: "draft_after_update",
          lines_count: fp.lines_count,
          total_ttc: fp.totals.total_ttc,
          prepaid_amount: prepaid,
          amount_due: due,
        },
        payload: { fingerprint_sha256: fp.fingerprint_sha256 },
      });

      db()
        .prepare(
          `
          UPDATE invoices SET
            client_id = @client_id,
            type = @type,
            date = @date,
            due_date = @due_date,
            currency = @currency,
            notes = @notes,

            buyer_reference = @buyer_reference,
            purchase_order_ref = @purchase_order_ref,
            contract_ref = @contract_ref,

            vat_mode = @vat_mode,
            vat_exempt_reason = @vat_exempt_reason,
            vat_exempt_code = @vat_exempt_code,

            prepaid_amount = @prepaid_amount,
            amount_due = @amount_due,

            use_case_code = @use_case_code,
            use_case_meta_json = @use_case_meta_json,
            meta_json = @meta_json,

            total_ht = @total_ht,
            total_tva = @total_tva,
            total_ttc = @total_ttc,
            totals_json = @totals_json,
            tax_breakdown_json = @tax_breakdown_json,

            updated_at = @updated_at
          WHERE id = @id
        `
        )
        .run({
          id,
          client_id: payload.client_id || null,
          type: wantedType,
          date: isoDate(payload.date) || t.slice(0, 10),
          due_date: payload.due_date ? isoDate(payload.due_date) : null,
          currency: s(payload.currency) || "EUR",
          notes: s(payload.notes),

          buyer_reference: s(payload.buyer_reference),
          purchase_order_ref: s(payload.purchase_order_ref),
          contract_ref: s(payload.contract_ref),

          vat_mode: s(payload.vat_mode || "AUTO").toUpperCase(),
          vat_exempt_reason: s(payload.vat_exempt_reason),
          vat_exempt_code: s(payload.vat_exempt_code),

          prepaid_amount: prepaid,
          amount_due: due,

          use_case_code: s(payload.use_case_code),
          use_case_meta_json: toJson(payload.use_case_meta || {}),
          meta_json: toJson(payload.meta_json || payload.meta || {}),

          total_ht: totals.total_ht,
          total_tva: totals.total_tva,
          total_ttc: totals.total_ttc,
          totals_json: toJson(totals),
          tax_breakdown_json: toJson(taxBreakdown),

          updated_at: t,
        });
    });

    tx();
    return { ok: true, id };
  }

  ipcMain.handle("invoices:update", (_e, payload = {}) => updateDraft(_e, payload));
  ipcMain.handle("invoices:save", (_e, payload = {}) => updateDraft(_e, payload));

  // -------- remove (draft only)
  function removeDraft(_e, { id } = {}) {
    ensureInvoicesSchema(db());
    const invoiceId = s(id);
    if (!invoiceId) throw new Error("Invoice id required");
    ensureDraft(db(), invoiceId);

    auditSafe(_e, {
      action: "invoices.remove_draft_requested",
      entityType: "invoice",
      entityId: invoiceId,
    });

    const tx = db().transaction(() => {
      db().prepare("DELETE FROM invoice_lines WHERE invoice_id = ?").run(invoiceId);
      db().prepare("DELETE FROM invoices WHERE id = ?").run(invoiceId);
      try {
        db()
          .prepare("DELETE FROM invoice_links WHERE from_invoice_id = ? OR to_invoice_id = ?")
          .run(invoiceId, invoiceId);
      } catch {}
    });

    tx();

    auditSafe(_e, {
      action: "invoices.remove_draft_committed",
      entityType: "invoice",
      entityId: invoiceId,
    });

    return { ok: true };
  }

  ipcMain.handle("invoices:remove", removeDraft);
  ipcMain.handle("invoices:delete", removeDraft);

  // -------- issue
  ipcMain.handle("invoices:issue", async (_e, { id } = {}) => {
  await loadPeppolParticipantIdentifierSchemes();

  ensureInvoicesSchema(db());
  const invoiceId = s(id);
  ensureDraft(db(), invoiceId);

  const t = nowIso();

  // 1) transaction sync pour charger / valider (sans réseau)
  const ctx = db().transaction(() => {
    const invoice = db().prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId);
    if (!invoice) throw new Error("Facture introuvable");

    const company = db().prepare("SELECT * FROM company WHERE id = 1").get();
    const client = db().prepare("SELECT * FROM clients WHERE id = ?").get(invoice.client_id);
    if (!company) throw new Error("Société introuvable");
    if (!client) throw new Error("Client introuvable");

    const linesRaw = loadInvoiceLines(db(), invoiceId);

    ensureCompanyForIssue(company);
    ensureClientForIssue(client, invoice);
    ensureLinesForIssue(linesRaw);

    return { invoice, company, client, linesRaw };
  })();

  // 2) résolution PEPPOL universelle (réseau)
  await ensurePeppolExportPrereqsAutoUniversal(ctx.company, ctx.client, {
    smlZone: "sml.peppolcentral.org",
    maxCandidates: 120,
  });

console.log("[PEPPOL] company endpoint =", company?.endpoint_scheme, company?.endpoint_id);
console.log("[PEPPOL] client  endpoint =", client?.endpoint_scheme, client?.endpoint_id);
console.log("[PEPPOL] resolve company =", resolveEndpointAuto(company));
console.log("[PEPPOL] resolve client  =", resolveEndpointAuto(client));

  // 3) transaction sync pour persister l’émission
  return db().transaction(() => {
    const invoice = ctx.invoice;
    const company = ctx.company;
    const client = ctx.client;
    const linesRaw = ctx.linesRaw;

    const { lines: linesVatApplied, effectiveMode } = applyVatModeToLines({
      company,
      client,
      invoice,
      lines: linesRaw,
    });

    persistInvoiceLines(db(), invoiceId, linesVatApplied);

    const lines = loadInvoiceLines(db(), invoiceId);
    const totals = computeInvoiceTotals(lines);
    const taxBreakdown = computeTaxBreakdown(lines);

    let prepaid = round2(n(invoice.prepaid_amount, 0));
    if (s(invoice.type) === "final" && s(invoice.quote_id)) {
      prepaid = sumIssuedDepositsTtcByQuote(db(), s(invoice.quote_id));
      syncPrepaymentLinks(db(), { quoteId: s(invoice.quote_id), finalInvoiceId: invoiceId, now: t });
    }

    const due = computeAmountDueByType(invoice.type, totals.total_ttc, prepaid);
    const number = s(invoice.invoice_number) || nextInvoiceNumber(db(), s(invoice.type) || "final");

    db()
      .prepare(
        `
        UPDATE invoices
        SET status = 'issued',
            invoice_number = @invoice_number,
            total_ht = @total_ht,
            total_tva = @total_tva,
            total_ttc = @total_ttc,
            prepaid_amount = @prepaid_amount,
            amount_due = @amount_due,
            totals_json = @totals_json,
            tax_breakdown_json = @tax_breakdown_json,
            updated_at = @updated_at
        WHERE id = @id
        `
      )
      .run({
        id: invoiceId,
        invoice_number: number,
        total_ht: totals.total_ht,
        total_tva: totals.total_tva,
        total_ttc: totals.total_ttc,
        prepaid_amount: prepaid,
        amount_due: due,
        totals_json: toJson(totals),
        tax_breakdown_json: toJson(taxBreakdown),
        updated_at: t,
      });

    auditSafe(_e, {
      action: "invoices.issued",
      entityType: "invoice",
      entityId: invoiceId,
      refs: {
        invoice_number: number,
        client_id: invoice.client_id,
        quote_id: invoice.quote_id || null,
        type: invoice.type,
        vat_mode_effective: effectiveMode,
        total_ttc: totals.total_ttc,
        prepaid_amount: prepaid,
        amount_due: due,
      },
    });

    return { ok: true, invoice_number: number };
  })();
});

// -------- exportUbl 
ipcMain.handle(
  "invoices:exportUbl",
  async (_e, { id, profile = "peppol-bis3", force = false } = {}) => {
    ensureInvoicesSchema(db());

    const raw = { id, profile, force };
    console.log("[IPC exportUbl] raw args =", raw);

    const invoiceId = s(id);
    console.log("[IPC exportUbl] normalized invoiceId =", invoiceId);

    const exists = db()
      .prepare("SELECT id, status, invoice_number FROM invoices WHERE id = ?")
      .get(invoiceId);
    console.log("[IPC exportUbl] exists =", exists);

    const full = getFull(db(), invoiceId);
    if (!full) throw new Error("Facture introuvable");

    const invoice = full.invoice;
    if (invoice.status !== "issued") throw new Error("Exporter UBL: facture doit être émise.");

    const allowedProfiles = new Set(["peppol-bis3", "ctc-fr-extended", "ctc-fr-en16931"]);
    if (!allowedProfiles.has(s(profile))) {
      throw new Error(`Exporter UBL: profil inconnu "${s(profile)}"`);
    }

    const company = db().prepare("SELECT * FROM company WHERE id = 1").get();
    const client = db().prepare("SELECT * FROM clients WHERE id = ?").get(invoice.client_id);

    if (!company) throw new Error("Société introuvable");
    if (!client) throw new Error("Client introuvable");

    // contrôles existants
    ensureCompanyForIssue(company);
    ensureClientForIssue(client, invoice);
    ensureLinesForIssue(full.lines);

    ensurePeppolPartySchema(db());

    // PEPPOL schemes cache + endpoint resolution
    await loadPeppolParticipantIdentifierSchemes();
    await ensurePeppolExportPrereqsAutoUniversal(company, client, {
      smlZone: "sml.peppolcentral.org",
      maxCandidates: 120,
    });

    // snapshots totals/breakdown
    const totals =
      safeJsonParse(invoice.totals_json, null) || {
        total_ht: round2(invoice.total_ht),
        total_tva: round2(invoice.total_tva),
        total_ttc: round2(invoice.total_ttc),
      };

    const taxBreakdown =
      safeJsonParse(invoice.tax_breakdown_json, null) || computeTaxBreakdown(full.lines);

    // validate before building XML
    const issues = validatePeppolEn16931({
      company,
      client,
      invoice,
      lines: full.lines,
      totals,
      taxBreakdown,
    });

    if (issues.length) {
      return {
        ok: false,
        error: `Non conforme PEPPOL/EN16931 (${issues.length} point(s)).`,
        details: issues,
      };
    }

    // references (prepayments / original invoice for credit note)
    const refs = { prepayments: [], original: null };

    try {
      if (tableExists(db(), "invoice_links")) {
        const prepayRows = db()
          .prepare(
            `
            SELECT i.id, i.invoice_number, i.date
            FROM invoice_links l
            JOIN invoices i ON i.id = l.from_invoice_id
            WHERE l.to_invoice_id = ?
              AND l.link_type = 'prepayment_of'
              AND i.status = 'issued'
            ORDER BY i.date ASC, i.invoice_number ASC, i.id ASC
          `
          )
          .all(invoiceId);

        refs.prepayments = prepayRows.map((r) => ({
          id: r.id,
          invoice_number: r.invoice_number,
          date: r.date,
        }));
      }

      if (s(invoice.type) === "credit_note" && s(invoice.source_invoice_id)) {
        const orig = db()
          .prepare(`SELECT id, invoice_number, date FROM invoices WHERE id = ?`)
          .get(s(invoice.source_invoice_id));

        if (orig) {
          refs.original = { id: orig.id, invoice_number: orig.invoice_number, date: orig.date };
        }
      }
    } catch {
      // keep refs empty
    }

    // build xml with explicit profile
    const xml = buildPeppolUbl21Document({
      company,
      client,
      invoice,
      lines: full.lines,
      refs,
      profile: s(profile),
    });

    const filename = s(invoice.invoice_number) || `invoice-${invoice.id}`;
    const resourcesDir = path.join(__dirname, "..", "resources");

    // schematron validation (your module)
    let validation = { ok: true, errors: [] };
    try {
      validation = validateUblSchematron({ xml, resourcesDir });
    } catch (err) {
      return {
        ok: false,
        error: `Validation Schematron impossible: ${err?.message || err}`,
        details: { where: "validateUblSchematron" },
      };
    }

    auditSafe(_e, {
      action: "invoices.export_ubl",
      entityType: "invoice",
      entityId: invoiceId,
      refs: {
        profile: s(profile),
        filename,
        valid: validation.ok,
        errors_count: validation.errors.length,
      },
    });

    if (!validation.ok) {
      return {
        ok: false,
        error: "XML non conforme (Schematron).",
        details: validation.errors,
        xml,
        filename,
        profile: s(profile),
      };
    }

    // ANTI-DOUBLON: PEPPOL BIS3
    if (s(profile) === "peppol-bis3") {
      const fp = invoiceAuditFingerprint(invoice, full.lines);
      const exportHash = fp.fingerprint_sha256;

      const prev = db()
        .prepare(
          "SELECT peppol_export_hash, peppol_exported_at, peppol_export_count FROM invoices WHERE id = ?"
        )
        .get(invoiceId);

      if (!force && prev?.peppol_export_hash && prev.peppol_export_hash === exportHash) {
        return {
          ok: false,
          error: "Déjà exportée PEPPOL (même contenu).",
          details: {
            peppol_exported_at: prev.peppol_exported_at,
            peppol_export_count: prev.peppol_export_count,
            hint: "Passe force=true pour régénérer malgré tout.",
          },
        };
      }

      const now = nowIso();
      db()
        .prepare(
          `
          UPDATE invoices
          SET peppol_exported_at = @at,
              peppol_export_hash = @hash,
              peppol_export_profile = @profile,
              peppol_export_filename = @filename,
              peppol_export_count = COALESCE(peppol_export_count, 0) + 1,
              updated_at = @at
          WHERE id = @id
        `
        )
        .run({
          id: invoiceId,
          at: now,
          hash: exportHash,
          profile: s(profile),
          filename,
        });
    }

    // --- write file to disk (XML) ---
    const exportDir = await ensureExportDir();
    const outName = `${filename}.xml`;
    const outPath = path.join(exportDir, outName);

    await fsp.writeFile(outPath, xml, "utf8");
    return { ok: true, xml, filename, profile: s(profile), outPath };
  }
);

  // -------- createFromQuote (draft final invoice from quote lines + prepaid_amount + amount_due + invoice_links)
  ipcMain.handle("invoices:createFromQuote", (_e, { quoteId } = {}) => {
    ensureInvoicesSchema(db());

    const qid = s(quoteId);
    if (!qid) throw new Error("quoteId required");

    if (!tableExists(db(), "quotes") || !tableExists(db(), "quote_lines")) {
      throw new Error("Schéma devis manquant (quotes/quote_lines).");
    }

    const quote = db()
      .prepare("SELECT id, number, client_id, meta_json, use_case_code, use_case_meta_json FROM quotes WHERE id = ? OR number = ?")
      .get(qid);

    if (!quote) throw new Error("Devis introuvable");

    const quoteLines = db()
      .prepare(
        `
        SELECT
          article_id, article_ref, description,
          quantity, unit_code, unit_price_ht, remise_percent,
          tva_percent,
          line_type,
          item_type,
          vat_category, vat_exempt_reason, vat_exempt_code
        FROM quote_lines
        WHERE quote_id = ?
        ORDER BY rowid ASC
      `
      )
      .all(qid);

    const invId = randomUUID();
    const t = nowIso();

    auditSafe(_e, {
      action: "invoices.create_from_quote_requested",
      entityType: "invoice",
      entityId: invId,
      refs: { quote_id: qid, quote_number: quote.number || null, client_id: quote.client_id || null },
    });

    const tx = db().transaction(() => {
      db()
        .prepare(
          `
          INSERT INTO invoices (
            id, quote_id, client_id, type, status,
            date, currency, notes,
            prepaid_amount, amount_due,
            use_case_code, use_case_meta_json, meta_json,
            total_ht, total_tva, total_ttc,
            created_at, updated_at
          ) VALUES (
            @id, @quote_id, @client_id, 'final', 'draft',
            @date, 'EUR', NULL,
            0, 0,
            @use_case_code, @use_case_meta_json, @meta_json,
            0, 0, 0,
            @created_at, @updated_at
          )
        `
        )
        .run({
          id: invId,
          quote_id: qid,
          client_id: quote.client_id || null,
          date: t.slice(0, 10),
          use_case_code: s(quote.use_case_code),
          use_case_meta_json: s(quote.use_case_meta_json) || "{}",
          meta_json: s(quote.meta_json) || "{}",
          created_at: t,
          updated_at: t,
        });

      const persisted = persistInvoiceLines(db(), invId, quoteLines);
      const totals = computeInvoiceTotals(persisted);
      const taxBreakdown = computeTaxBreakdown(persisted);

      const depositsPaid = sumIssuedDepositsTtcByQuote(db(), qid);
      syncPrepaymentLinks(db(), { quoteId: qid, finalInvoiceId: invId, now: t });

      const due = computeAmountDueByType("final", totals.total_ttc, depositsPaid);

      db()
        .prepare(
          `UPDATE invoices
           SET total_ht=@ht, total_tva=@tva, total_ttc=@ttc,
               prepaid_amount=@prepaid,
               amount_due=@due,
               totals_json=@tj, tax_breakdown_json=@xb, updated_at=@u
           WHERE id=@id`
        )
        .run({
          id: invId,
          ht: totals.total_ht,
          tva: totals.total_tva,
          ttc: totals.total_ttc,
          prepaid: depositsPaid,
          due,
          tj: toJson(totals),
          xb: toJson(taxBreakdown),
          u: t,
        });

      const fp = invoiceAuditFingerprint(
        {
          id: invId,
          quote_id: qid,
          client_id: quote.client_id || null,
          type: "final",
          status: "draft",
          date: t.slice(0, 10),
          currency: "EUR",
          prepaid_amount: depositsPaid,
          amount_due: due,
          ...totals,
        },
        persisted
      );

      auditSafe(_e, {
        action: "invoices.create_from_quote_snapshot",
        entityType: "invoice",
        entityId: invId,
        refs: {
          quote_id: qid,
          deposits_sum_ttc: depositsPaid,
          total_ttc: totals.total_ttc,
          amount_due: due,
        },
        payload: { fingerprint_sha256: fp.fingerprint_sha256 },
      });
    });

    tx();

    auditSafe(_e, {
      action: "invoices.create_from_quote_committed",
      entityType: "invoice",
      entityId: invId,
      refs: { status_after: "draft" },
    });

    return { ok: true, id: invId };
  });

  // -------- createCreditNote
  ipcMain.handle("invoices:createCreditNote", (_e, { invoiceId } = {}) => {
    ensureInvoicesSchema(db());

    const srcId = s(invoiceId);
    if (!srcId) throw new Error("invoiceId required");

    const orig = db().prepare("SELECT id, client_id, status FROM invoices WHERE id = ?").get(srcId);
    if (!orig) throw new Error("Facture d'origine introuvable");
    if (orig.status !== "issued") throw new Error("Créer un avoir sur une facture émise");

    const origLines = loadInvoiceLines(db(), srcId);

    const creditLines = origLines.map((l) => ({
      ...l,
      id: randomUUID(),
      quantity: -Math.abs(n(l.quantity, 1)),
      line_type: "adjustment",
    }));

    const newId = randomUUID();
    const t = nowIso();

    auditSafe(_e, {
      action: "invoices.create_credit_note_requested",
      entityType: "invoice",
      entityId: newId,
      refs: { source_invoice_id: srcId, client_id: orig.client_id },
    });

    const tx = db().transaction(() => {
      const creditMeta = {
        kind: "credit_note",
        scope: "EXTERNAL",
        source: { invoice_id: srcId },
      };

      db()
        .prepare(
          `
          INSERT INTO invoices (
            id, source_invoice_id, client_id, type, status,
            date, currency, notes,
            prepaid_amount, amount_due,
            meta_json,
            total_ht, total_tva, total_ttc,
            created_at, updated_at
          ) VALUES (
            @id, @source_invoice_id, @client_id, 'credit_note', 'draft',
            @date, 'EUR', 'Avoir sur facture',
            0, 0,
            @meta_json,
            0, 0, 0,
            @created_at, @updated_at
          )
        `
        )
        .run({
          id: newId,
          source_invoice_id: srcId,
          client_id: orig.client_id,
          date: t.slice(0, 10),
          meta_json: toJson(creditMeta),
          created_at: t,
          updated_at: t,
        });

      const persisted = persistInvoiceLines(db(), newId, creditLines);
      const totals = computeInvoiceTotals(persisted);
      const taxBreakdown = computeTaxBreakdown(persisted);

      const due = computeAmountDueByType("credit_note", totals.total_ttc, 0);

      const fp = invoiceAuditFingerprint(
        {
          id: newId,
          source_invoice_id: srcId,
          client_id: orig.client_id,
          type: "credit_note",
          status: "draft",
          date: t.slice(0, 10),
          currency: "EUR",
          prepaid_amount: 0,
          amount_due: due,
          ...totals,
        },
        persisted
      );

      auditSafe(_e, {
        action: "invoices.create_credit_note_snapshot",
        entityType: "invoice",
        entityId: newId,
        refs: { source_invoice_id: srcId, total_ttc: totals.total_ttc, amount_due: due },
        payload: { fingerprint_sha256: fp.fingerprint_sha256 },
      });

      db()
        .prepare(
          `UPDATE invoices
           SET total_ht=@ht, total_tva=@tva, total_ttc=@ttc,
               amount_due=@due,
               totals_json=@tj, tax_breakdown_json=@xb
           WHERE id=@id`
        )
        .run({
          ht: totals.total_ht,
          tva: totals.total_tva,
          ttc: totals.total_ttc,
          due,
          tj: toJson(totals),
          xb: toJson(taxBreakdown),
          id: newId,
        });
    });

    tx();

    auditSafe(_e, {
      action: "invoices.create_credit_note_committed",
      entityType: "invoice",
      entityId: newId,
      refs: { status_after: "draft" },
    });

    return { ok: true, id: newId };
  });

  // -------- createBlank (compat)
  ipcMain.handle("invoices:createBlank", (_e, payload = {}) => {
    ensureInvoicesSchema(db());

    const id = randomUUID();
    const t = nowIso();

    auditSafe(_e, {
      action: "invoices.create_blank_requested",
      entityType: "invoice",
      entityId: id,
      refs: { client_id: payload.client_id || null, type: s(payload.type) || "final" },
    });

    const type = (() => {
      const tp = s(payload.type) || "final";
      return ["final", "deposit", "credit_note"].includes(tp) ? tp : "final";
    })();

    const prepaid = round2(n(payload.prepaid_amount, 0));
    const due = computeAmountDueByType(type, 0, prepaid);

    db()
      .prepare(
        `
        INSERT INTO invoices (
          id, quote_id, client_id, type, status,
          date, due_date, currency, notes,
          prepaid_amount, amount_due,
          use_case_code, use_case_meta_json, meta_json,
          total_ht, total_tva, total_ttc,
          created_at, updated_at
        ) VALUES (
          @id, NULL, @client_id, @type, 'draft',
          @date, @due_date, @currency, @notes,
          @prepaid_amount, @amount_due,
          @use_case_code, @use_case_meta_json, @meta_json,
          0, 0, 0,
          @created_at, @updated_at
        )
      `
      )
      .run({
        id,
        client_id: payload.client_id || null,
        type,
        date: isoDate(payload.date) || t.slice(0, 10),
        due_date: payload.due_date ? isoDate(payload.due_date) : null,
        currency: s(payload.currency) || "EUR",
        notes: s(payload.notes),

        prepaid_amount: prepaid,
        amount_due: due,

        use_case_code: s(payload.use_case_code),
        use_case_meta_json: toJson(payload.use_case_meta || {}),
        meta_json: toJson(payload.meta_json || {}),
        created_at: t,
        updated_at: t,
      });

    auditSafe(_e, {
      action: "invoices.create_blank_committed",
      entityType: "invoice",
      entityId: id,
      refs: { status_after: "draft" },
    });

    return { ok: true, id };
  });

  // -------- exportPeppolPdf (STUB)
  ipcMain.handle("invoices:exportPeppolPdf", (_e, { id, profile = "peppol-bis3" } = {}) => {
    ensureInvoicesSchema(db());
    const invoiceId = s(id);
    if (!invoiceId) throw new Error("Invoice id required");

    auditSafe(_e, {
      action: "invoices.export_peppol_pdf_requested",
      entityType: "invoice",
      entityId: invoiceId,
      refs: { profile: s(profile) },
    });

    return {
      ok: false,
      error: `PDF PEPPOL: handler stub. Implémenter invoices:exportPeppolPdf côté IPC (profil=${s(profile)}).`,
    };
  });
};

// -------------------- schema (non destructive) --------------------
function ensureInvoicesSchema(db) {
  // invoices
  if (!tableExists(db, "invoices")) {
    db.exec(`
      CREATE TABLE invoices (
        id TEXT PRIMARY KEY,

        quote_id TEXT,
        client_id TEXT,

        -- types: final|deposit|credit_note
        type TEXT NOT NULL DEFAULT 'final',

        -- status: draft|issued|cancelled
        status TEXT NOT NULL DEFAULT 'draft',

        -- immutable once issued
        invoice_number TEXT,

        date TEXT NOT NULL,
        due_date TEXT,
        currency TEXT NOT NULL DEFAULT 'EUR',

        notes TEXT,

        -- EN16931 / business meta
        buyer_reference TEXT,
        purchase_order_ref TEXT,
        contract_ref TEXT,

        -- VAT logic control: AUTO|VAT|NO_VAT|REVERSE_CHARGE|EXEMPT
        vat_mode TEXT NOT NULL DEFAULT 'AUTO',
        vat_exempt_reason TEXT,
        vat_exempt_code TEXT,

        -- invoice links / context
        source_invoice_id TEXT,

        -- ✅ EN16931 BT-113
        prepaid_amount REAL NOT NULL DEFAULT 0,

        -- ✅ EN16931 BT-115 (PayableAmount / Net à payer)
        amount_due REAL NOT NULL DEFAULT 0,
        
        -- PEPPOL
        peppol_exported_at TEXT,
        peppol_export_hash TEXT,
        peppol_export_profile TEXT,
        peppol_export_filename TEXT,
        peppol_export_count INTEGER NOT NULL DEFAULT 0,

        -- app-specific
        use_case_code TEXT,
        use_case_meta_json TEXT,
        meta_json TEXT,

        -- totals snapshot
        total_ht REAL NOT NULL DEFAULT 0,
        total_tva REAL NOT NULL DEFAULT 0,
        total_ttc REAL NOT NULL DEFAULT 0,
        totals_json TEXT,
        tax_breakdown_json TEXT,

        created_at TEXT,
        updated_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
      CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_date   ON invoices(date);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
    `);
  } else {
    addColumnIfMissing(db, "invoices", "quote_id", "TEXT");
    addColumnIfMissing(db, "invoices", "client_id", "TEXT");
    addColumnIfMissing(db, "invoices", "type", "TEXT NOT NULL DEFAULT 'final'");
    addColumnIfMissing(db, "invoices", "status", "TEXT NOT NULL DEFAULT 'draft'");
    addColumnIfMissing(db, "invoices", "invoice_number", "TEXT");
    addColumnIfMissing(db, "invoices", "date", "TEXT");
    addColumnIfMissing(db, "invoices", "due_date", "TEXT");
    addColumnIfMissing(db, "invoices", "currency", "TEXT NOT NULL DEFAULT 'EUR'");
    addColumnIfMissing(db, "invoices", "notes", "TEXT");
    addColumnIfMissing(db, "invoices", "buyer_reference", "TEXT");
    addColumnIfMissing(db, "invoices", "purchase_order_ref", "TEXT");
    addColumnIfMissing(db, "invoices", "contract_ref", "TEXT");
    addColumnIfMissing(db, "invoices", "vat_mode", "TEXT NOT NULL DEFAULT 'AUTO'");
    addColumnIfMissing(db, "invoices", "vat_exempt_reason", "TEXT");
    addColumnIfMissing(db, "invoices", "vat_exempt_code", "TEXT");
    addColumnIfMissing(db, "invoices", "source_invoice_id", "TEXT");
    addColumnIfMissing(db, "invoices", "prepaid_amount", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "invoices", "amount_due", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "invoices", "use_case_code", "TEXT");
    addColumnIfMissing(db, "invoices", "use_case_meta_json", "TEXT");
    addColumnIfMissing(db, "invoices", "meta_json", "TEXT");
    addColumnIfMissing(db, "invoices", "total_ht", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "invoices", "total_tva", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "invoices", "total_ttc", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "invoices", "totals_json", "TEXT");
    addColumnIfMissing(db, "invoices", "tax_breakdown_json", "TEXT");
    addColumnIfMissing(db, "invoices", "created_at", "TEXT");
    addColumnIfMissing(db, "invoices", "updated_at", "TEXT");
    addColumnIfMissing(db, "invoices", "peppol_exported_at", "TEXT");
    addColumnIfMissing(db, "invoices", "peppol_export_hash", "TEXT");
    addColumnIfMissing(db, "invoices", "peppol_export_profile", "TEXT");
    addColumnIfMissing(db, "invoices", "peppol_export_filename", "TEXT");
    addColumnIfMissing(db, "invoices", "peppol_export_count", "INTEGER NOT NULL DEFAULT 0");

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
      CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_date   ON invoices(date);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
    `);
  }

  // invoice_lines
  if (!tableExists(db, "invoice_lines")) {
    db.exec(`
      CREATE TABLE invoice_lines (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,

        article_id TEXT,
        article_ref TEXT,

        description TEXT NOT NULL,

        quantity REAL NOT NULL DEFAULT 1,
        unit_code TEXT NOT NULL DEFAULT 'C62',

        unit_price_ht REAL NOT NULL DEFAULT 0,
        remise_percent REAL NOT NULL DEFAULT 0,

        -- VAT
        tva_percent REAL NOT NULL DEFAULT 0,
        vat_category TEXT NOT NULL DEFAULT 'S',
        vat_exempt_reason TEXT,
        vat_exempt_code TEXT,

        -- goods/service
        line_type TEXT NOT NULL DEFAULT 'standard',
        item_type TEXT NOT NULL DEFAULT 'SERVICE',

        total_ht REAL NOT NULL DEFAULT 0,
        created_at TEXT,
        updated_at TEXT,

        FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);
    `);
  } else {
    addColumnIfMissing(db, "invoice_lines", "invoice_id", "TEXT");
    addColumnIfMissing(db, "invoice_lines", "article_id", "TEXT");
    addColumnIfMissing(db, "invoice_lines", "article_ref", "TEXT");
    addColumnIfMissing(db, "invoice_lines", "description", "TEXT");
    addColumnIfMissing(db, "invoice_lines", "quantity", "REAL NOT NULL DEFAULT 1");
    addColumnIfMissing(db, "invoice_lines", "unit_code", "TEXT NOT NULL DEFAULT 'C62'");
    addColumnIfMissing(db, "invoice_lines", "unit_price_ht", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "invoice_lines", "remise_percent", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "invoice_lines", "tva_percent", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "invoice_lines", "vat_category", "TEXT NOT NULL DEFAULT 'S'");
    addColumnIfMissing(db, "invoice_lines", "vat_exempt_reason", "TEXT");
    addColumnIfMissing(db, "invoice_lines", "vat_exempt_code", "TEXT");
    addColumnIfMissing(db, "invoice_lines", "line_type", "TEXT NOT NULL DEFAULT 'standard'");
    addColumnIfMissing(db, "invoice_lines", "item_type", "TEXT NOT NULL DEFAULT 'SERVICE'");
    addColumnIfMissing(db, "invoice_lines", "total_ht", "REAL NOT NULL DEFAULT 0");
    addColumnIfMissing(db, "invoice_lines", "created_at", "TEXT");
    addColumnIfMissing(db, "invoice_lines", "updated_at", "TEXT");
    db.exec(`CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);`);
  }

  // invoice_links
  if (!tableExists(db, "invoice_links")) {
    db.exec(`
      CREATE TABLE invoice_links (
        id TEXT PRIMARY KEY,
        from_invoice_id TEXT NOT NULL,
        to_invoice_id TEXT NOT NULL,
        link_type TEXT NOT NULL, -- credit_of|prepayment_of|final_of
        created_at TEXT NOT NULL,
        FOREIGN KEY(from_invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
        FOREIGN KEY(to_invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_invoice_links_from ON invoice_links(from_invoice_id);
      CREATE INDEX IF NOT EXISTS idx_invoice_links_to ON invoice_links(to_invoice_id);
    `);
  }
}

// -------------------- totals / VAT logic --------------------
function computeLineTotals(line) {
  const qty = n(line.quantity);
  const unit = n(line.unit_price_ht);
  const discount = n(line.remise_percent);
  const base = qty * unit;
  const net = base * (1 - discount / 100);
  const vat = net * (n(line.tva_percent) / 100);
  return { ht: round2(net), tva: round2(vat) };
}

function computeInvoiceTotals(lines) {
  let totalHt = 0;
  let totalTva = 0;

  for (const l of lines) {
    const t = computeLineTotals(l);
    totalHt += t.ht;
    totalTva += t.tva;
  }

  totalHt = round2(totalHt);
  totalTva = round2(totalTva);

  return {
    total_ht: totalHt,
    total_tva: totalTva,
    total_ttc: round2(totalHt + totalTva),
  };
}

function computeTaxBreakdown(lines) {
  const map = new Map();

  for (const l of lines) {
    const ht = computeLineTotals(l).ht;
    const rate = round2(n(l.tva_percent));
    const cat = s(l.vat_category || (rate === 0 ? "Z" : "S")) || "S";
    const key = `${cat}|${rate.toFixed(2)}`;

    const cur = map.get(key) || {
      vat_category: cat,
      tva_percent: rate,
      taxable_ht: 0,
      vat_amount: 0,
    };

    cur.taxable_ht = round2(cur.taxable_ht + ht);
    cur.vat_amount = round2(cur.vat_amount + round2(ht * (rate / 100)));
    map.set(key, cur);
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.vat_category !== b.vat_category) return a.vat_category.localeCompare(b.vat_category);
    return a.tva_percent - b.tva_percent;
  });
}

function applyVatModeToLines({ company, client, invoice, lines }) {
  const sellerCountry = s(company?.country || "FR").toUpperCase();
  const buyerCountry = s(client?.country || "FR").toUpperCase();
  const buyerType = s(client?.customer_type || "B2C").toUpperCase();
  const buyerVatId = s(client?.vat_id);

  const mode = s(invoice?.vat_mode || "AUTO").toUpperCase();

  const effectiveMode = (() => {
    if (mode !== "AUTO") return mode;
    if (sellerCountry && buyerCountry && sellerCountry === buyerCountry) return "VAT";
    const buyerIsBusiness = buyerType === "B2B" || buyerType === "B2G";
    if (buyerIsBusiness && buyerVatId) return "REVERSE_CHARGE";
    return "NO_VAT";
  })();

  const patched = lines.map((l) => {
    const out = { ...l };

    if (effectiveMode === "VAT") {
      out.vat_category = s(out.vat_category || (n(out.tva_percent) === 0 ? "Z" : "S")) || "S";
      return out;
    }

    if (effectiveMode === "REVERSE_CHARGE") {
      out.tva_percent = 0;
      out.vat_category = "AE";
      out.vat_exempt_reason = s(invoice?.vat_exempt_reason) || "Reverse charge";
      out.vat_exempt_code = s(invoice?.vat_exempt_code) || "";
      return out;
    }

    if (effectiveMode === "EXEMPT") {
      out.tva_percent = 0;
      out.vat_category = "E";
      out.vat_exempt_reason = s(invoice?.vat_exempt_reason) || "Exempt";
      out.vat_exempt_code = s(invoice?.vat_exempt_code) || "";
      return out;
    }

    // NO_VAT
    out.tva_percent = 0;
    out.vat_category = "Z";
    out.vat_exempt_reason = s(invoice?.vat_exempt_reason) || "";
    out.vat_exempt_code = s(invoice?.vat_exempt_code) || "";
    return out;
  });

  return { effectiveMode, lines: patched };
}

// -------------------- payable / due --------------------
function payableAmount(totalTtc, prepaid) {
  return round2(Math.max(0, round2(n(totalTtc, 0)) - round2(n(prepaid, 0))));
}

function computeAmountDueByType(type, totalTtc, prepaid) {
  const tp = s(type || "final");
  if (tp === "credit_note") {
    // Credit note can be negative; do not clamp.
    return round2(round2(n(totalTtc, 0)) - round2(n(prepaid, 0)));
  }
  return payableAmount(totalTtc, prepaid);
}

// -------------------- numbering / state --------------------
function ensureDraft(db, id) {
  const row = db.prepare("SELECT status FROM invoices WHERE id = ?").get(id);
  if (!row) throw new Error("Facture introuvable");
  if (row.status !== "draft") throw new Error("Opération autorisée uniquement sur un brouillon");
}

function nextInvoiceNumber(db, type) {
  const year = new Date().getFullYear();
  const prefix =
    type === "credit_note" ? `AV${year}-` : type === "deposit" ? `AC${year}-` : `F${year}-`;

  const last = db
    .prepare(
      `
      SELECT invoice_number FROM invoices
      WHERE invoice_number LIKE ?
      ORDER BY invoice_number DESC
      LIMIT 1
    `
    )
    .get(`${prefix}%`);

  const lastSeq = last ? Number(String(last.invoice_number).split("-")[1]) || 0 : 0;
  const nextSeq = String(lastSeq + 1).padStart(4, "0");
  return `${prefix}${nextSeq}`;
}

// -------------------- lines persistence --------------------
function persistInvoiceLines(db, invoiceId, lines) {
  db.prepare("DELETE FROM invoice_lines WHERE invoice_id = ?").run(invoiceId);

  const ins = db.prepare(
    `
    INSERT INTO invoice_lines (
      id, invoice_id, article_id, article_ref, description,
      quantity, unit_code, unit_price_ht, remise_percent,
      tva_percent, vat_category, vat_exempt_reason, vat_exempt_code,
      line_type, item_type,
      total_ht,
      created_at, updated_at
    ) VALUES (
      @id, @invoice_id, @article_id, @article_ref, @description,
      @quantity, @unit_code, @unit_price_ht, @remise_percent,
      @tva_percent, @vat_category, @vat_exempt_reason, @vat_exempt_code,
      @line_type, @item_type,
      @total_ht,
      @created_at, @updated_at
    )
  `
  );

  const t = nowIso();

  const sanitized = (Array.isArray(lines) ? lines : []).map((l) => {
    const qty = n(l.quantity, 1);
    const unit_price_ht = n(l.unit_price_ht, 0);
    const remise_percent = n(l.remise_percent, 0);
    const tva_percent = n(l.tva_percent, 0);

    const totals = computeLineTotals({
      quantity: qty,
      unit_price_ht,
      remise_percent,
      tva_percent,
    });

    return {
      id: s(l.id) || randomUUID(),
      invoice_id: invoiceId,

      article_id: s(l.article_id) || null,
      article_ref: s(l.article_ref),

      description: s(l.description),
      quantity: qty,
      unit_code: s(l.unit_code) || "C62",

      unit_price_ht,
      remise_percent,

      tva_percent,
      vat_category: s(l.vat_category || (tva_percent === 0 ? "Z" : "S")) || "S",
      vat_exempt_reason: s(l.vat_exempt_reason),
      vat_exempt_code: s(l.vat_exempt_code),

      line_type: s(l.line_type) || "standard",
      item_type: s(l.item_type || "SERVICE").toUpperCase() === "GOODS" ? "GOODS" : "SERVICE",

      total_ht: totals.ht,

      created_at: t,
      updated_at: t,
    };
  });

  for (const l of sanitized) ins.run(l);
  return sanitized;
}

function loadInvoiceLines(db, id) {
  ensureInvoicesSchema(db);
  return db
    .prepare(
      `
      SELECT
        id, invoice_id, article_id, article_ref, description,
        quantity, unit_code, unit_price_ht, remise_percent,
        tva_percent, vat_category, vat_exempt_reason, vat_exempt_code,
        line_type, item_type, total_ht,
        created_at, updated_at
      FROM invoice_lines
      WHERE invoice_id = ?
      ORDER BY rowid
    `
    )
    .all(id);
}

// -------------------- load full --------------------
function getFull(db, id) {
  ensureInvoicesSchema(db);

  const inv = db
    .prepare(
      `
      SELECT
        id, quote_id, client_id, type, status, invoice_number,
        date, due_date, currency, notes,
        buyer_reference, purchase_order_ref, contract_ref,
        vat_mode, vat_exempt_reason, vat_exempt_code,
        source_invoice_id,
        prepaid_amount,
        amount_due,
        use_case_code, use_case_meta_json, meta_json,
        total_ht, total_tva, total_ttc,
        totals_json, tax_breakdown_json,
        created_at, updated_at
      FROM invoices
      WHERE id = ?
    `
    )
    .get(id);

  if (!inv) return null;

  const lines = loadInvoiceLines(db, id);

  const prepaid = round2(n(inv.prepaid_amount, 0));
  const totalTtc = round2(n(inv.total_ttc, 0));

  // stored amount_due is the truth; fallback if missing/zero-inconsistent
  const storedDue = round2(n(inv.amount_due, 0));
  const computedDue = computeAmountDueByType(inv.type, totalTtc, prepaid);
  const due =
    Number.isFinite(storedDue) && !(storedDue === 0 && computedDue !== 0) ? storedDue : computedDue;

  return {
    invoice: {
      ...inv,
      prepaid_amount: prepaid,
      amount_due: due,
      payable_amount: due, // alias for UI (BT-115)
      use_case_meta: safeJsonParse(inv.use_case_meta_json, {}),
      meta: safeJsonParse(inv.meta_json, {}),
      totals: safeJsonParse(inv.totals_json, null),
      tax_breakdown: safeJsonParse(inv.tax_breakdown_json, null),
    },
    lines,
  };
}

// -------------------- EN16931 pragmatic validations --------------------
function ensureCompanyForIssue(company) {
  if (!s(company?.legal_name))
    throw new Error("Société: raison sociale obligatoire (EN16931 BG-4/BT-27).");
  if (!s(company?.country))
    throw new Error("Société: pays obligatoire (ISO) (EN16931 BG-4/BT-40).");
  if (!s(company?.street) || !s(company?.postal_code) || !s(company?.city))
    throw new Error("Société: adresse complète obligatoire (EN16931 BG-5).");
}

function ensureClientForIssue(client, invoice) {
  if (!s(client?.name)) throw new Error("Client: nom obligatoire (EN16931 BG-7/BT-44).");
  if (!s(client?.country)) throw new Error("Client: pays obligatoire (EN16931 BG-8/BT-55).");
  if (!s(client?.street) || !s(client?.postal_code) || !s(client?.city))
    throw new Error("Client: adresse complète obligatoire (EN16931 BG-8).");

  if (s(client?.customer_type).toUpperCase() === "B2G") {
    const br = s(invoice?.buyer_reference) || s(client?.buyer_reference);
    if (!br) throw new Error("B2G: BuyerReference requis (EN16931 BT-10).");
  }
}

function ensureLinesForIssue(lines) {
  if (!Array.isArray(lines) || lines.length === 0)
    throw new Error("Facture: au moins une ligne est requise (EN16931 BG-25).");
  for (const l of lines) {
    if (!s(l.description)) throw new Error("Ligne: description obligatoire (EN16931 BT-153).");
    if (!(n(l.quantity) > 0 || n(l.quantity) < 0)) throw new Error("Ligne: quantité invalide.");
    if (!(n(l.unit_price_ht) >= 0)) throw new Error("Ligne: prix unitaire HT invalide.");
    if (!(n(l.remise_percent) >= 0)) throw new Error("Ligne: remise invalide.");
    if (!(n(l.tva_percent) >= 0)) throw new Error("Ligne: TVA invalide.");
  }
}

// -------------------- Profiles / Customization --------------------
function resolveCustomizationId(profile) {
  const p = s(profile || "peppol-bis3");

  switch (p) {
    // ✅ International default: PEPPOL BIS Billing 3.0
    case "peppol-bis3":
      return "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";

    // 🇫🇷 France (si tu gardes ces profils)
    case "ctc-fr-extended":
      return "urn:cen.eu:en16931:2017#conformant#urn.cpro.gouv.fr:1p0:extended-ctc-fr";

    case "ctc-fr-en16931":
      return "urn:cen.eu:en16931:2017";

    default:
      throw new Error(`Unknown e-invoicing profile: ${p}`);
  }
}

function resolveProfileId(profile, businessProcessId) {
  const p = s(profile || "peppol-bis3");

  switch (p) {
    // ✅ International default: PEPPOL BIS Billing 3.0
    case "peppol-bis3":
      return "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

    // 🇫🇷 France: ne pas laisser vide (tolérance validateurs)
    case "ctc-fr-extended":
    case "ctc-fr-en16931":
      return s(businessProcessId) || "urn:cen.eu:en16931:2017";

    default:
      throw new Error(`Unknown e-invoicing profile: ${p}`);
  }
}

function resolveCustomizationId(profile) {
  const p = s(profile);

  switch (p) {

    case "peppol-bis3":
      return "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";

    case "fr-ctc-extended":
      return "urn:cen.eu:en16931:2017#conformant#urn.cpro.gouv.fr:1p0:extended-ctc-fr";

    case "fr-en16931":
      return "urn:cen.eu:en16931:2017";

    default:
      throw new Error("Unknown profile: " + p);
  }
}

function resolveProfileId(profile) {
  const p = s(profile);

  switch (p) {

    case "peppol-bis3":
      return "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

    case "fr-ctc-extended":
    case "fr-en16931":
      return "urn:cen.eu:en16931:2017";

    default:
      throw new Error("Unknown profile: " + p);
  }
}

// -------------------- UBL 2.1 (EN16931 / CTC-FR / Peppol BIS) --------------------
function buildPeppolUbl21Document({
  company,
  client,
  invoice,
  lines,
  refs = {
    prepayments: [], // [{ id, invoice_number, date }]
    original: null, // { id, invoice_number, date }
  },
  profile = "peppol-bis3",
}) {
  const currency = s(invoice.currency || company.currency || "EUR").toUpperCase();
  const issueDate = isoDate(invoice.date);
  const dueDate = invoice.due_date ? isoDate(invoice.due_date) : "";

  const type = s(invoice.type || "final");
  const isCredit = type === "credit_note";
  const isDeposit = type === "deposit";

  // ✅ IDs calculés (plus de valeurs "en dur")
  const customizationId = resolveCustomizationId(profile);
  const profileId = resolveProfileId(
    profile,
    invoice?.business_process_id || invoice?.meta?.business_process_id
  );

  // Document identifiers
  const docId = s(invoice.invoice_number || invoice.id);
  const buyerReference = s(invoice.buyer_reference) || s(client.buyer_reference);

  // Totals snapshot (prefer stored snapshots for consistency)
  const totalsSnapshot = safeJsonParse(invoice.totals_json, null);
  const taxSnapshot = safeJsonParse(invoice.tax_breakdown_json, null);

  const totals = totalsSnapshot || {
    total_ht: round2(invoice.total_ht),
    total_tva: round2(invoice.total_tva),
    total_ttc: round2(invoice.total_ttc),
  };

  const taxBreakdown = taxSnapshot || computeTaxBreakdown(lines);

  // BT-113 / BT-115
  const prepaid = round2(n(invoice.prepaid_amount, 0));
  const computedPayable = computeAmountDueByType(type, totals.total_ttc, prepaid);
  const payable = round2(n(invoice.amount_due, computedPayable));

  // --- endpoints (already resolved in issue/export prereqs)
  const sellerEndpointId = s(company.endpoint_id);
  const sellerEndpointScheme = s(company.endpoint_scheme);
  const buyerEndpointId = s(client.endpoint_id);
  const buyerEndpointScheme = s(client.endpoint_scheme);

  const endpointXml = (id, scheme) => {
    if (!id || !scheme) return "";
    return `<cbc:EndpointID schemeID="${eXml(scheme)}">${eXml(id)}</cbc:EndpointID>`;
  };

  // --- Party helpers
  const partyAddress = (p) => `
    <cac:PostalAddress>
      <cbc:StreetName>${eXml(s(p.street))}</cbc:StreetName>
      ${s(p.street2) ? `<cbc:AdditionalStreetName>${eXml(s(p.street2))}</cbc:AdditionalStreetName>` : ""}
      <cbc:CityName>${eXml(s(p.city))}</cbc:CityName>
      ${s(p.state) ? `<cbc:CountrySubentity>${eXml(s(p.state))}</cbc:CountrySubentity>` : ""}
      <cbc:PostalZone>${eXml(s(p.postal_code))}</cbc:PostalZone>
      <cac:Country><cbc:IdentificationCode>${eXml(s(p.country).toUpperCase())}</cbc:IdentificationCode></cac:Country>
    </cac:PostalAddress>`;

  const partyContact = (p) => {
    const phone = s(p.phone);
    const email = s(p.email);
    if (!phone && !email) return "";
    return `
      <cac:Contact>
        ${phone ? `<cbc:Telephone>${eXml(phone)}</cbc:Telephone>` : ""}
        ${email ? `<cbc:ElectronicMail>${eXml(email)}</cbc:ElectronicMail>` : ""}
      </cac:Contact>`;
  };

  const partyTaxScheme = (vatId) => {
    if (!vatId) return "";
    return `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${eXml(vatId)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>`;
  };

  const partyIdentification = (id, scheme) => {
    if (!s(id)) return "";
    const schemeAttr = s(scheme) ? ` schemeID="${eXml(scheme)}"` : "";
    return `
      <cac:PartyIdentification>
        <cbc:ID${schemeAttr}>${eXml(s(id))}</cbc:ID>
      </cac:PartyIdentification>`;
  };

  function taxExemptionXml({ vat_category, vat_exempt_reason, vat_exempt_code }) {
  const cat = s(vat_category || "").toUpperCase();

  // reason/code provenant des données
  let reason = s(vat_exempt_reason);
  let code = s(vat_exempt_code);

  // ✅ PEPPOL: Reverse charge (AE) => VATEX-EU-AE si pas fourni
  if (cat === "AE" && !code) {
    code = "VATEX-EU-AE";
  }

  // ✅ Valeurs par défaut utiles si catégorie "exempt-like" mais rien n’est fourni
  if (["AE", "E", "Z", "O", "G", "K"].includes(cat) && !reason) {
    if (cat === "AE") reason = "Reverse charge";
    else if (cat === "Z") reason = "VAT rate = 0";
    else if (cat === "E") reason = "Exempt from VAT";
  }

  // Si toujours rien à dire, ne rien générer
  if (!reason && !code) return "";

  return `
          ${code ? `<cbc:TaxExemptionReasonCode>${eXml(code)}</cbc:TaxExemptionReasonCode>` : ""}
          ${reason ? `<cbc:TaxExemptionReason>${eXml(reason)}</cbc:TaxExemptionReason>` : ""}`;
}

  const orderRef = s(invoice.purchase_order_ref)
    ? `<cac:OrderReference><cbc:ID>${eXml(s(invoice.purchase_order_ref))}</cbc:ID></cac:OrderReference>`
    : "";

  const contractRef = s(invoice.contract_ref)
    ? `<cac:ContractDocumentReference><cbc:ID>${eXml(s(invoice.contract_ref))}</cbc:ID></cac:ContractDocumentReference>`
    : "";

  const billingRefs = [];

  for (const p of Array.isArray(refs.prepayments) ? refs.prepayments : []) {
    const id = s(p.invoice_number || p.id);
    if (!id) continue;
    billingRefs.push(`
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${eXml(id)}</cbc:ID>
      ${p.date ? `<cbc:IssueDate>${eXml(isoDate(p.date))}</cbc:IssueDate>` : ""}
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>`);
  }

  if (isCredit && refs.original && s(refs.original.invoice_number || refs.original.id)) {
    const oid = s(refs.original.invoice_number || refs.original.id);
    billingRefs.push(`
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${eXml(oid)}</cbc:ID>
      ${refs.original.date ? `<cbc:IssueDate>${eXml(isoDate(refs.original.date))}</cbc:IssueDate>` : ""}
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>`);
  }

  const billingReferencesXml = billingRefs.join("\n");

  const paymentMeansCode = "30";
  const paymentTerms = s(company.payment_terms);

  const paymentBlock = isCredit
    ? ""
    : `
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode listID="UNCL4461">${eXml(paymentMeansCode)}</cbc:PaymentMeansCode>
    ${
      s(company.iban)
        ? `
    <cac:PayeeFinancialAccount>
      <cbc:ID>${eXml(s(company.iban))}</cbc:ID>
      ${
        s(company.bic)
          ? `<cac:FinancialInstitutionBranch><cbc:ID>${eXml(s(company.bic))}</cbc:ID></cac:FinancialInstitutionBranch>`
          : ""
      }
    </cac:PayeeFinancialAccount>`
        : ""
    }
  </cac:PaymentMeans>
  ${paymentTerms ? `<cac:PaymentTerms><cbc:Note>${eXml(paymentTerms)}</cbc:Note></cac:PaymentTerms>` : ""}`;

  const taxTotal = `
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${eXml(currency)}">${round2(totals.total_tva).toFixed(2)}</cbc:TaxAmount>
    ${taxBreakdown
      .map((tb) => {
        const cat = s(tb.vat_category || "S").toUpperCase();
        const rate = round2(tb.tva_percent);
        const taxable = round2(tb.taxable_ht);
        const vat = round2(tb.vat_amount);

        return `
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${eXml(currency)}">${taxable.toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${eXml(currency)}">${vat.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${eXml(cat)}</cbc:ID>
        <cbc:Percent>${rate.toFixed(2)}</cbc:Percent>${taxExemptionXml({
          vat_category: cat,
          vat_exempt_reason: tb.vat_exempt_reason || invoice.vat_exempt_reason,
          vat_exempt_code: tb.vat_exempt_code || invoice.vat_exempt_code,
        })}
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`;
      })
      .join("")}
  </cac:TaxTotal>`;

  const monetary = `
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${eXml(currency)}">${round2(totals.total_ht).toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${eXml(currency)}">${round2(totals.total_ht).toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${eXml(currency)}">${round2(totals.total_ttc).toFixed(2)}</cbc:TaxInclusiveAmount>
    ${!isCredit && prepaid !== 0 ? `<cbc:PrepaidAmount currencyID="${eXml(currency)}">${prepaid.toFixed(2)}</cbc:PrepaidAmount>` : ""}
    <cbc:PayableAmount currencyID="${eXml(currency)}">${round2(payable).toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>`;

  function lineAllowanceChargeXml({ qty, unitPrice, discountPercent }) {
    const discount = round2(discountPercent);
    if (!(discount > 0)) return "";

    const baseAmount = round2(qty * unitPrice);
    const amount = round2(baseAmount * (discount / 100));

    return `
    <cac:AllowanceCharge>
      <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
      <cbc:MultiplierFactorNumeric>${(discount / 100).toFixed(4)}</cbc:MultiplierFactorNumeric>
      <cbc:Amount currencyID="${eXml(currency)}">${amount.toFixed(2)}</cbc:Amount>
      <cbc:BaseAmount currencyID="${eXml(currency)}">${baseAmount.toFixed(2)}</cbc:BaseAmount>
    </cac:AllowanceCharge>`;
  }

  const lineTag = isCredit ? "cac:CreditNoteLine" : "cac:InvoiceLine";
  const qtyTag = isCredit ? "cbc:CreditedQuantity" : "cbc:InvoicedQuantity";

  const linesXml = (Array.isArray(lines) ? lines : [])
    .map((l, idx) => {
      const qty = n(l.quantity, 1);
      const unitCode = s(l.unit_code || "C62");
      const unitPrice = round2(l.unit_price_ht);
      const discount = round2(l.remise_percent);

      const lineNet = round2(computeLineTotals(l).ht);

      const cat = s(l.vat_category || (n(l.tva_percent) === 0 ? "Z" : "S")).toUpperCase() || "S";
      const rate = round2(l.tva_percent);

      return `
  <${lineTag}>
    <cbc:ID>${idx + 1}</cbc:ID>
    <${qtyTag} unitCode="${eXml(unitCode)}">${round2(qty).toFixed(2)}</${qtyTag}>
    <cbc:LineExtensionAmount currencyID="${eXml(currency)}">${lineNet.toFixed(2)}</cbc:LineExtensionAmount>
    ${lineAllowanceChargeXml({ qty, unitPrice, discountPercent: discount })}
    <cac:Item>
      <cbc:Name>${eXml(s(l.description))}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${eXml(cat)}</cbc:ID>
        <cbc:Percent>${rate.toFixed(2)}</cbc:Percent>${taxExemptionXml({
          vat_category: cat,
          vat_exempt_reason: s(l.vat_exempt_reason) || s(invoice.vat_exempt_reason),
          vat_exempt_code: s(l.vat_exempt_code) || s(invoice.vat_exempt_code),
        })}
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${eXml(currency)}">${unitPrice.toFixed(2)}</cbc:PriceAmount>
    </cac:Price>
  </${lineTag}>`;
    })
    .join("\n");

  const supplierParty = `
  <cac:AccountingSupplierParty>
    <cac:Party>
      ${endpointXml(sellerEndpointId, sellerEndpointScheme)}
      ${partyIdentification(company.legal_id, company.legal_id_scheme)}
      <cac:PartyName><cbc:Name>${eXml(s(company.legal_name))}</cbc:Name></cac:PartyName>
      ${partyAddress(company)}
      ${partyTaxScheme(s(company.vat_id))}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${eXml(s(company.legal_name))}</cbc:RegistrationName>
        ${s(company.legal_id) ? `<cbc:CompanyID>${eXml(s(company.legal_id))}</cbc:CompanyID>` : ""}
      </cac:PartyLegalEntity>
      ${partyContact(company)}
    </cac:Party>
  </cac:AccountingSupplierParty>`;

  const customerParty = `
  <cac:AccountingCustomerParty>
    <cac:Party>
      ${endpointXml(buyerEndpointId, buyerEndpointScheme)}
      ${partyIdentification(client.legal_id, client.legal_id_scheme)}
      <cac:PartyName><cbc:Name>${eXml(s(client.name))}</cbc:Name></cac:PartyName>
      ${partyAddress(client)}
      ${partyTaxScheme(s(client.vat_id))}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${eXml(s(client.name))}</cbc:RegistrationName>
        ${s(client.legal_id) ? `<cbc:CompanyID>${eXml(s(client.legal_id))}</cbc:CompanyID>` : ""}
      </cac:PartyLegalEntity>
      ${partyContact(client)}
    </cac:Party>
  </cac:AccountingCustomerParty>`;

  if (isCredit) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">

  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>${eXml(customizationId)}</cbc:CustomizationID>
  <cbc:ProfileID>${eXml(profileId)}</cbc:ProfileID>

  <cbc:ID>${eXml(docId)}</cbc:ID>
  <cbc:IssueDate>${eXml(issueDate)}</cbc:IssueDate>
  <cbc:CreditNoteTypeCode listID="UNCL1001">381</cbc:CreditNoteTypeCode>
  <cbc:DocumentCurrencyCode>${eXml(currency)}</cbc:DocumentCurrencyCode>

  ${buyerReference ? `<cbc:BuyerReference>${eXml(buyerReference)}</cbc:BuyerReference>` : ""}
  ${s(invoice.notes) ? `<cbc:Note>${eXml(s(invoice.notes))}</cbc:Note>` : ""}

  ${orderRef}
  ${contractRef}
  ${billingReferencesXml}

  ${supplierParty}
  ${customerParty}

  ${taxTotal}
  ${monetary}

  ${linesXml}

</CreditNote>`;
  }

  const invoiceTypeCode = isDeposit ? "386" : "380";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">

  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>${eXml(customizationId)}</cbc:CustomizationID>
  <cbc:ProfileID>${eXml(profileId)}</cbc:ProfileID>

  <cbc:ID>${eXml(docId)}</cbc:ID>
  <cbc:IssueDate>${eXml(issueDate)}</cbc:IssueDate>
  ${dueDate ? `<cbc:DueDate>${eXml(dueDate)}</cbc:DueDate>` : ""}
  <cbc:InvoiceTypeCode listID="UNCL1001">${eXml(invoiceTypeCode)}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${eXml(currency)}</cbc:DocumentCurrencyCode>

  ${buyerReference ? `<cbc:BuyerReference>${eXml(buyerReference)}</cbc:BuyerReference>` : ""}
  ${s(invoice.notes) ? `<cbc:Note>${eXml(s(invoice.notes))}</cbc:Note>` : ""}

  ${orderRef}
  ${contractRef}
  ${billingReferencesXml}

  ${supplierParty}
  ${customerParty}

  ${paymentBlock}

  ${taxTotal}
  ${monetary}

  ${linesXml}

</Invoice>`;
}

// -------------------- AUDIT helpers --------------------
function sha256Hex(data) {
  return crypto.createHash("sha256").update(String(data)).digest("hex");
}

function stableStringify(obj) {
  if (obj == null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",")}}`;
}

function invoiceAuditFingerprint(invoice, lines) {
  const core = {
    id: invoice?.id,
    quote_id: invoice?.quote_id || null,
    client_id: invoice?.client_id || null,
    type: invoice?.type,
    status: invoice?.status,
    invoice_number: invoice?.invoice_number || null,
    date: invoice?.date || null,
    due_date: invoice?.due_date || null,
    currency: invoice?.currency || "EUR",
    vat_mode: invoice?.vat_mode || "AUTO",
    prepaid_amount: round2(n(invoice?.prepaid_amount, 0)),
    amount_due: round2(n(invoice?.amount_due, 0)),
    totals: {
      total_ht: round2(n(invoice?.total_ht, 0)),
      total_tva: round2(n(invoice?.total_tva, 0)),
      total_ttc: round2(n(invoice?.total_ttc, 0)),
    },
    lines: (Array.isArray(lines) ? lines : []).map((l) => ({
      description: s(l.description),
      quantity: round2(n(l.quantity, 0)),
      unit_price_ht: round2(n(l.unit_price_ht, 0)),
      remise_percent: round2(n(l.remise_percent, 0)),
      tva_percent: round2(n(l.tva_percent, 0)),
      vat_category: s(l.vat_category || ""),
      unit_code: s(l.unit_code || "C62"),
      line_type: s(l.line_type || "standard"),
      item_type: s(l.item_type || "SERVICE"),
    })),
  };

  const canonical = stableStringify(core);
  return {
    fingerprint_sha256: sha256Hex(canonical),
    lines_count: core.lines.length,
    totals: core.totals,
  };
}

function getAuditConfig() {
  return {
    logPath: getAuditLogPath(app),
    hmacSecret: process.env.AUDIT_HMAC_SECRET || null,
    tsaUrl: process.env.AUDIT_TSA_URL || null,
    appMeta: {
      app: "myapp",
      version: app?.getVersion ? app.getVersion() : "",
      env: process.env.NODE_ENV || "",
    },
    auditReads: String(process.env.AUDIT_READS || "").toLowerCase() === "1",
  };
}

function auditSafe(e, { action, entityType, entityId, payload, refs }) {
  try {
    const cfg = getAuditConfig();
    const actor =
      (payload && payload.actor) ||
      (e?.senderFrame?.url ? `renderer:${e.senderFrame.url}` : "system");

    return appendAuditEvent({
      logPath: cfg.logPath,
      hmacSecret: cfg.hmacSecret,
      tsaUrl: cfg.tsaUrl,
      actor,
      action,
      entityType,
      entityId,
      payload: payload || {},
      refs: refs || {},
      appMeta: cfg.appMeta,
    });
  } catch (err) {
    try {
      console.error("[AUDIT] failed:", err?.message || err);
    } catch {}
    return null;
  }
}

// -------------------- deposits helpers (linking + prepaid) --------------------
function listIssuedDepositsByQuote(db, quoteId) {
  return db
    .prepare(
      `
      SELECT id, invoice_number, date, total_ttc
      FROM invoices
      WHERE quote_id = ?
        AND type = 'deposit'
        AND status = 'issued'
      ORDER BY date ASC, invoice_number ASC, id ASC
    `
    )
    .all(quoteId);
}

function sumIssuedDepositsTtcByQuote(db, quoteId) {
  const row = db
    .prepare(
      `
      WITH
      dep AS (
        SELECT COALESCE(SUM(COALESCE(total_ttc,0)),0) AS dep_ttc
        FROM invoices
        WHERE quote_id = ?
          AND type = 'deposit'
          AND status = 'issued'
      ),
      cred AS (
        -- Avoirs émis dont la source est un acompte de CE devis
        SELECT COALESCE(SUM(COALESCE(cn.total_ttc,0)),0) AS cred_ttc
        FROM invoices cn
        JOIN invoices src ON src.id = cn.source_invoice_id
        WHERE cn.type='credit_note'
          AND cn.status='issued'
          AND src.type='deposit'
          AND src.status='issued'
          AND src.quote_id = ?
      )
      SELECT dep.dep_ttc AS dep_ttc, cred.cred_ttc AS cred_ttc
      FROM dep, cred;
      `
    )
    .get(quoteId, quoteId);

  return round2(n(row?.dep_ttc) + n(row?.cred_ttc));
}


function syncPrepaymentLinks(db, { quoteId, finalInvoiceId, now }) {
  if (!tableExists(db, "invoice_links")) return;

  db.prepare(
    `
    DELETE FROM invoice_links
    WHERE to_invoice_id = ?
      AND link_type = 'prepayment_of'
  `
  ).run(finalInvoiceId);

  const deposits = listIssuedDepositsByQuote(db, quoteId);

  const ins = db.prepare(
    `
    INSERT INTO invoice_links (id, from_invoice_id, to_invoice_id, link_type, created_at)
    VALUES (@id, @from_id, @to_id, 'prepayment_of', @created_at)
  `
  );

  for (const d of deposits) {
    ins.run({
      id: randomUUID(),
      from_id: d.id,
      to_id: finalInvoiceId,
      created_at: now,
    });
  }
}

// -------------------- PEPPOL/EN16931 validations (pragmatic, actionable) --------------------
function money(x) {
  return round2(n(x, 0));
}

function isIso4217(code) {
  return /^[A-Z]{3}$/.test(String(code || "").toUpperCase());
}

function isIso3166(code) {
  return /^[A-Z]{2}$/.test(String(code || "").toUpperCase());
}

// Renvoie [{code, path, message, hint}]
function validatePeppolEn16931({ company, client, invoice, lines, totals, taxBreakdown }) {
  const issues = [];
  const add = (code, path, message, hint = "") => issues.push({ code, path, message, hint });

  const currency = String(invoice?.currency || company?.currency || "EUR").toUpperCase();

  if (!s(invoice?.date)) add("EN16931", "invoice.date", "Date de facture manquante (BT-2).");
  if (!isIso4217(currency)) add("EN16931", "invoice.currency", "Devise invalide (BT-5).", "Ex: EUR");

  if (!s(company?.legal_name))
    add("EN16931", "company.legal_name", "Raison sociale vendeur manquante (BT-27).");
  if (!s(company?.street) || !s(company?.postal_code) || !s(company?.city))
    add("EN16931", "company.address", "Adresse vendeur incomplète (BG-5).");
  if (!isIso3166(company?.country))
    add(
      "EN16931",
      "company.country",
      "Pays vendeur invalide (BT-40).",
      "Code ISO-3166-1 alpha-2 (ex: FR)"
    );

  if (!s(client?.name))
    add("EN16931", "client.name", "Nom/raison sociale client manquant (BT-44).");
  if (!s(client?.street) || !s(client?.postal_code) || !s(client?.city))
    add("EN16931", "client.address", "Adresse client incomplète (BG-8).");
  if (!isIso3166(client?.country))
    add(
      "EN16931",
      "client.country",
      "Pays client invalide (BT-55).",
      "Code ISO-3166-1 alpha-2 (ex: FR)"
    );

  if (!Array.isArray(lines) || lines.length === 0)
    add("EN16931", "lines", "Au moins une ligne est requise (BG-25).");
  else {
    lines.forEach((l, i) => {
      const idx = i + 1;
      if (!s(l.description))
        add("EN16931", `lines[${idx}].description`, "Description ligne manquante (BT-153).");
      if (!Number.isFinite(n(l.quantity)) || n(l.quantity) === 0)
        add("EN16931", `lines[${idx}].quantity`, "Quantité ligne invalide (BT-129).");
      if (!Number.isFinite(n(l.unit_price_ht)) || n(l.unit_price_ht) < 0)
        add("EN16931", `lines[${idx}].unit_price_ht`, "Prix unitaire HT invalide (BT-146).");
      if (!Number.isFinite(n(l.tva_percent)) || n(l.tva_percent) < 0)
        add("EN16931", `lines[${idx}].tva_percent`, "TVA % invalide (BT-152).");
      const cat = s(l.vat_category || "").toUpperCase();
      if (!cat)
        add(
          "EN16931",
          `lines[${idx}].vat_category`,
          "Catégorie TVA manquante (BT-151).",
          "Ex: S, Z, AE, E"
        );
    });
  }

  const totalHt = money(totals?.total_ht ?? invoice?.total_ht);
  const totalTva = money(totals?.total_tva ?? invoice?.total_tva);
  const totalTtc = money(totals?.total_ttc ?? invoice?.total_ttc);

  const prepaid = money(invoice?.prepaid_amount);
  const amountDue = money(invoice?.amount_due);

  const recomputed = computeInvoiceTotals(lines || []);
  const recHt = money(recomputed.total_ht);
  const recTva = money(recomputed.total_tva);
  const recTtc = money(recomputed.total_ttc);

  if (Math.abs(totalHt - recHt) > 0.01)
    add(
      "EN16931",
      "totals.total_ht",
      `Total HT incohérent. DB=${totalHt.toFixed(2)} vs calcul=${recHt.toFixed(2)}.`
    );

  if (Math.abs(totalTva - recTva) > 0.01)
    add(
      "EN16931",
      "totals.total_tva",
      `Total TVA incohérent. DB=${totalTva.toFixed(2)} vs calcul=${recTva.toFixed(2)}.`
    );

  if (Math.abs(totalTtc - (totalHt + totalTva)) > 0.01)
    add(
      "EN16931",
      "totals.total_ttc",
      `Total TTC doit être HT+TVA. TTC=${totalTtc.toFixed(2)} vs HT+TVA=${(totalHt + totalTva).toFixed(2)}.`
    );

  const expectedDue = computeAmountDueByType(invoice?.type, totalTtc, prepaid);
  if (Math.abs(amountDue - expectedDue) > 0.01) {
    add(
      "EN16931",
      "invoice.amount_due",
      `Reste à payer incohérent (BT-115). DB=${amountDue.toFixed(2)} vs attendu=${expectedDue.toFixed(2)}.`,
      "Vérifie les acomptes (BT-113) et le TTC."
    );
  }

  const breakdown = Array.isArray(taxBreakdown) ? taxBreakdown : computeTaxBreakdown(lines || []);
  const sumTaxable = money(breakdown.reduce((a, x) => a + money(x.taxable_ht), 0));
  const sumVat = money(breakdown.reduce((a, x) => a + money(x.vat_amount), 0));

  if (Math.abs(sumTaxable - totalHt) > 0.02) {
    add(
      "EN16931",
      "tax_breakdown.taxable_sum",
      `Somme des bases TVA incohérente. ΣTaxable=${sumTaxable.toFixed(2)} vs TotalHT=${totalHt.toFixed(2)}.`,
      "Vérifie les catégories TVA des lignes."
    );
  }
  if (Math.abs(sumVat - totalTva) > 0.02) {
    add(
      "EN16931",
      "tax_breakdown.vat_sum",
      `Somme des montants TVA incohérente. ΣTVA=${sumVat.toFixed(2)} vs TotalTVA=${totalTva.toFixed(2)}.`,
      "Vérifie les taux TVA et l’arrondi."
    );
  }

  if (!s(company?.endpoint_id) || !s(company?.endpoint_scheme))
    add(
      "PEPPOL",
      "company.endpoint",
      "Endpoint vendeur manquant.",
      "Renseigne endpoint_id + endpoint_scheme (ex: 0088 + GLN)."
    );

  if (!s(client?.endpoint_id) || !s(client?.endpoint_scheme))
    add(
      "PEPPOL",
      "client.endpoint",
      "Endpoint client manquant.",
      "Renseigne endpoint_id + endpoint_scheme (ex: 0002 + SIREN)."
    );

  if (String(client?.customer_type || "").toUpperCase() === "B2G") {
    const br = s(invoice?.buyer_reference) || s(client?.buyer_reference);
    if (!br) add("PEPPOL", "invoice.buyer_reference", "BuyerReference requis en B2G (BT-10).");
  }

  return issues;
}

// -------------------- IPC handlers --------------------
module.exports = (ipcMain, getDb) => {
  const db = () => getDb();

  // -------- list
  ipcMain.handle("invoices:list", (_e, query = {}) => {
    ensureInvoicesSchema(db());

    const cfg = getAuditConfig();
    if (cfg.auditReads) {
      auditSafe(_e, {
        action: "invoices.list",
        entityType: "invoice",
        entityId: "*",
        refs: {
          query: { status: s(query.status), type: s(query.type), client_id: s(query.client_id) },
        },
      });
    }

    const params = [];
    let where = "1=1";

    if (query.status) {
      where += " AND i.status = ?";
      params.push(s(query.status));
    }
    if (query.type) {
      where += " AND i.type = ?";
      params.push(s(query.type));
    }
    if (query.client_id) {
      where += " AND i.client_id = ?";
      params.push(s(query.client_id));
    }

    return db()
      .prepare(
        `
        SELECT
          i.*,
          c.name AS client_name,
          COALESCE(i.amount_due, ROUND(COALESCE(i.total_ttc,0) - COALESCE(i.prepaid_amount,0), 2)) AS payable_amount
        FROM invoices i
        LEFT JOIN clients c ON c.id = i.client_id
        WHERE ${where}
        ORDER BY COALESCE(i.updated_at, i.created_at) DESC
      `
      )
      .all(...params);
  });

  // -------- getFull
  ipcMain.handle("invoices:getFull", (_e, { id } = {}) => {
    const cfg = getAuditConfig();
    if (cfg.auditReads) {
      auditSafe(_e, { action: "invoices.getFull", entityType: "invoice", entityId: s(id) });
    }
    return getFull(db(), s(id));
  });

  // -------- get (compat)
  ipcMain.handle("invoices:get", (_e, { id } = {}) => {
    const cfg = getAuditConfig();
    if (cfg.auditReads) {
      auditSafe(_e, { action: "invoices.get", entityType: "invoice", entityId: s(id) });
    }
    const full = getFull(db(), s(id));
    if (!full) return null;
    return { ...full.invoice, lines: full.lines };
  });

  // -------- create (draft)
  ipcMain.handle("invoices:create", (_e, payload = {}) => {
    ensureInvoicesSchema(db());

    const id = randomUUID();
    const t = nowIso();

    const linesIn = Array.isArray(payload.lines) ? payload.lines : [];
    const currency = s(payload.currency) || "EUR";
    const wantedType = (() => {
      const tp = s(payload.type) || "final";
      return ["final", "deposit", "credit_note"].includes(tp) ? tp : "final";
    })();

    auditSafe(_e, {
      action: "invoices.create_requested",
      entityType: "invoice",
      entityId: id,
      refs: {
        quote_id: payload.quote_id || null,
        client_id: payload.client_id || null,
        currency,
        type: wantedType,
      },
      payload: {
        status_after: "draft",
        input: { has_lines: Array.isArray(linesIn) && linesIn.length > 0 },
      },
    });

    const tx = db().transaction(() => {
      const prepaid0 = round2(n(payload.prepaid_amount, 0));

      db()
        .prepare(
          `
          INSERT INTO invoices (
            id, quote_id, client_id, type, status,
            date, due_date, currency, notes,
            buyer_reference, purchase_order_ref, contract_ref,
            vat_mode, vat_exempt_reason, vat_exempt_code,
            source_invoice_id,
            prepaid_amount,
            amount_due,
            use_case_code, use_case_meta_json, meta_json,
            totals_json, tax_breakdown_json,
            total_ht, total_tva, total_ttc,
            created_at, updated_at
          ) VALUES (
            @id, @quote_id, @client_id, @type, 'draft',
            @date, @due_date, @currency, @notes,
            @buyer_reference, @purchase_order_ref, @contract_ref,
            @vat_mode, @vat_exempt_reason, @vat_exempt_code,
            @source_invoice_id,
            @prepaid_amount,
            0,
            @use_case_code, @use_case_meta_json, @meta_json,
            '', '',
            0, 0, 0,
            @created_at, @updated_at
          )
        `
        )
        .run({
          id,
          quote_id: payload.quote_id || null,
          client_id: payload.client_id || null,
          type: wantedType,
          date: isoDate(payload.date) || t.slice(0, 10),
          due_date: payload.due_date ? isoDate(payload.due_date) : null,
          currency,
          notes: s(payload.notes),

          buyer_reference: s(payload.buyer_reference),
          purchase_order_ref: s(payload.purchase_order_ref),
          contract_ref: s(payload.contract_ref),

          vat_mode: s(payload.vat_mode || "AUTO").toUpperCase(),
          vat_exempt_reason: s(payload.vat_exempt_reason),
          vat_exempt_code: s(payload.vat_exempt_code),

          source_invoice_id: payload.source_invoice_id || null,
          prepaid_amount: prepaid0,

          use_case_code: s(payload.use_case_code),
          use_case_meta_json: toJson(payload.use_case_meta || {}),
          meta_json: toJson(payload.meta_json || payload.meta || {}),

          created_at: t,
          updated_at: t,
        });

      const persisted = persistInvoiceLines(db(), id, linesIn);
      const totals = computeInvoiceTotals(persisted);
      const taxBreakdown = computeTaxBreakdown(persisted);

      const due = computeAmountDueByType(wantedType, totals.total_ttc, prepaid0);

      const fp = invoiceAuditFingerprint(
        {
          id,
          quote_id: payload.quote_id || null,
          client_id: payload.client_id || null,
          type: wantedType,
          status: "draft",
          date: isoDate(payload.date) || t.slice(0, 10),
          currency,
          vat_mode: s(payload.vat_mode || "AUTO").toUpperCase(),
          prepaid_amount: prepaid0,
          amount_due: due,
          ...totals,
        },
        persisted
      );

      auditSafe(_e, {
        action: "invoices.snapshot",
        entityType: "invoice",
        entityId: id,
        refs: {
          phase: "draft_after_create",
          lines_count: fp.lines_count,
          total_ttc: fp.totals.total_ttc,
          prepaid_amount: prepaid0,
          amount_due: due,
        },
        payload: { fingerprint_sha256: fp.fingerprint_sha256 },
      });

      db()
        .prepare(
          `
          UPDATE invoices SET
            total_ht=@total_ht,
            total_tva=@total_tva,
            total_ttc=@total_ttc,
            amount_due=@amount_due,
            tax_breakdown_json=@tax_breakdown_json,
            totals_json=@totals_json,
            updated_at=@updated_at
          WHERE id=@id
        `
        )
        .run({
          id,
          total_ht: totals.total_ht,
          total_tva: totals.total_tva,
          total_ttc: totals.total_ttc,
          amount_due: due,
          totals_json: toJson(totals),
          tax_breakdown_json: toJson(taxBreakdown),
          updated_at: t,
        });
    });

    tx();

    auditSafe(_e, {
      action: "invoices.create_committed",
      entityType: "invoice",
      entityId: id,
      refs: { status_after: "draft" },
    });

    return { ok: true, id };
  });

  // -------- update/save (draft only)
  function updateDraft(_e, payload = {}) {
    ensureInvoicesSchema(db());

    const id = s(payload.id);
    if (!id) throw new Error("Invoice id required");
    ensureDraft(db(), id);

    const t = nowIso();
    const linesIn = Array.isArray(payload.lines) ? payload.lines : [];

    const wantedType = (() => {
      const tp = s(payload.type) || "final";
      return ["final", "deposit", "credit_note"].includes(tp) ? tp : "final";
    })();

    const tx = db().transaction(() => {
      const persisted = persistInvoiceLines(db(), id, linesIn);
      const totals = computeInvoiceTotals(persisted);
      const taxBreakdown = computeTaxBreakdown(persisted);

      const prepaid = round2(n(payload.prepaid_amount, 0));
      const due = computeAmountDueByType(wantedType, totals.total_ttc, prepaid);

      const fp = invoiceAuditFingerprint(
        {
          id,
          status: "draft",
          client_id: payload.client_id || null,
          type: wantedType,
          date: isoDate(payload.date) || t.slice(0, 10),
          currency: s(payload.currency) || "EUR",
          vat_mode: s(payload.vat_mode || "AUTO").toUpperCase(),
          prepaid_amount: prepaid,
          amount_due: due,
          ...totals,
        },
        persisted
      );

      auditSafe(_e, {
        action: "invoices.update_draft",
        entityType: "invoice",
        entityId: id,
        refs: {
          phase: "draft_after_update",
          lines_count: fp.lines_count,
          total_ttc: fp.totals.total_ttc,
          prepaid_amount: prepaid,
          amount_due: due,
        },
        payload: { fingerprint_sha256: fp.fingerprint_sha256 },
      });

      db()
        .prepare(
          `
          UPDATE invoices SET
            client_id = @client_id,
            type = @type,
            date = @date,
            due_date = @due_date,
            currency = @currency,
            notes = @notes,

            buyer_reference = @buyer_reference,
            purchase_order_ref = @purchase_order_ref,
            contract_ref = @contract_ref,

            vat_mode = @vat_mode,
            vat_exempt_reason = @vat_exempt_reason,
            vat_exempt_code = @vat_exempt_code,

            prepaid_amount = @prepaid_amount,
            amount_due = @amount_due,

            use_case_code = @use_case_code,
            use_case_meta_json = @use_case_meta_json,
            meta_json = @meta_json,

            total_ht = @total_ht,
            total_tva = @total_tva,
            total_ttc = @total_ttc,
            totals_json = @totals_json,
            tax_breakdown_json = @tax_breakdown_json,

            updated_at = @updated_at
          WHERE id = @id
        `
        )
        .run({
          id,
          client_id: payload.client_id || null,
          type: wantedType,
          date: isoDate(payload.date) || t.slice(0, 10),
          due_date: payload.due_date ? isoDate(payload.due_date) : null,
          currency: s(payload.currency) || "EUR",
          notes: s(payload.notes),

          buyer_reference: s(payload.buyer_reference),
          purchase_order_ref: s(payload.purchase_order_ref),
          contract_ref: s(payload.contract_ref),

          vat_mode: s(payload.vat_mode || "AUTO").toUpperCase(),
          vat_exempt_reason: s(payload.vat_exempt_reason),
          vat_exempt_code: s(payload.vat_exempt_code),

          prepaid_amount: prepaid,
          amount_due: due,

          use_case_code: s(payload.use_case_code),
          use_case_meta_json: toJson(payload.use_case_meta || {}),
          meta_json: toJson(payload.meta_json || payload.meta || {}),

          total_ht: totals.total_ht,
          total_tva: totals.total_tva,
          total_ttc: totals.total_ttc,
          totals_json: toJson(totals),
          tax_breakdown_json: toJson(taxBreakdown),

          updated_at: t,
        });
    });

    tx();
    return { ok: true, id };
  }

  ipcMain.handle("invoices:update", (_e, payload = {}) => updateDraft(_e, payload));
  ipcMain.handle("invoices:save", (_e, payload = {}) => updateDraft(_e, payload));

  // -------- remove (draft only)
  function removeDraft(_e, { id } = {}) {
    ensureInvoicesSchema(db());
    const invoiceId = s(id);
    if (!invoiceId) throw new Error("Invoice id required");
    ensureDraft(db(), invoiceId);

    auditSafe(_e, {
      action: "invoices.remove_draft_requested",
      entityType: "invoice",
      entityId: invoiceId,
    });

    const tx = db().transaction(() => {
      db().prepare("DELETE FROM invoice_lines WHERE invoice_id = ?").run(invoiceId);
      db().prepare("DELETE FROM invoices WHERE id = ?").run(invoiceId);
      try {
        db()
          .prepare("DELETE FROM invoice_links WHERE from_invoice_id = ? OR to_invoice_id = ?")
          .run(invoiceId, invoiceId);
      } catch {}
    });

    tx();

    auditSafe(_e, {
      action: "invoices.remove_draft_committed",
      entityType: "invoice",
      entityId: invoiceId,
    });

    return { ok: true };
  }

  ipcMain.handle("invoices:remove", removeDraft);
  ipcMain.handle("invoices:delete", removeDraft);

  // -------- issue
  ipcMain.handle("invoices:issue", async (_e, { id } = {}) => {
  await loadPeppolParticipantIdentifierSchemes();
    ensureInvoicesSchema(db());
    const invoiceId = s(id);
    ensureDraft(db(), invoiceId);

    const t = nowIso();

    const tx = db().transaction(() => {
      const invoice = db().prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId);
      if (!invoice) throw new Error("Facture introuvable");

      const company = db().prepare("SELECT * FROM company WHERE id = 1").get();
      const client = db().prepare("SELECT * FROM clients WHERE id = ?").get(invoice.client_id);

console.log("[DB] company keys =", Object.keys(company || {}));
console.log("[DB] client keys  =", Object.keys(client || {}));
console.log("[DB] company vat candidates =", {
  vat_id: company?.vat_id,
  tax_id: company?.tax_id,
  pib: company?.pib,
});
console.log("[DB] client vat candidates =", {
  vat_id: client?.vat_id,
  tax_id: client?.tax_id,
});

      if (!company) throw new Error("Société introuvable");
      if (!client) throw new Error("Client introuvable");
      
      const linesRaw = loadInvoiceLines(db(), invoiceId);

      ensureCompanyForIssue(company);
      ensureClientForIssue(client, invoice);
      ensureLinesForIssue(linesRaw);
      ensurePeppolExportPrereqsAuto(company, client);

      const { lines: linesVatApplied, effectiveMode } = applyVatModeToLines({
        company,
        client,
        invoice,
        lines: linesRaw,
      });

      persistInvoiceLines(db(), invoiceId, linesVatApplied);

      const lines = loadInvoiceLines(db(), invoiceId);
      const totals = computeInvoiceTotals(lines);
      const taxBreakdown = computeTaxBreakdown(lines);

      let prepaid = round2(n(invoice.prepaid_amount, 0));
      if (s(invoice.type) === "final" && s(invoice.quote_id)) {
        prepaid = sumIssuedDepositsTtcByQuote(db(), s(invoice.quote_id));
        syncPrepaymentLinks(db(), { quoteId: s(invoice.quote_id), finalInvoiceId: invoiceId, now: t });
      }

      const due = computeAmountDueByType(invoice.type, totals.total_ttc, prepaid);
      const number = s(invoice.invoice_number) || nextInvoiceNumber(db(), s(invoice.type) || "final");

      db()
        .prepare(
          `
          UPDATE invoices
          SET status = 'issued',
              invoice_number = @invoice_number,
              total_ht = @total_ht,
              total_tva = @total_tva,
              total_ttc = @total_ttc,
              prepaid_amount = @prepaid_amount,
              amount_due = @amount_due,
              totals_json = @totals_json,
              tax_breakdown_json = @tax_breakdown_json,
              updated_at = @updated_at
          WHERE id = @id
        `
        )
        .run({
          id: invoiceId,
          invoice_number: number,
          total_ht: totals.total_ht,
          total_tva: totals.total_tva,
          total_ttc: totals.total_ttc,
          prepaid_amount: prepaid,
          amount_due: due,
          totals_json: toJson(totals),
          tax_breakdown_json: toJson(taxBreakdown),
          updated_at: t,
        });

      const fp = invoiceAuditFingerprint(
        {
          ...invoice,
          id: invoiceId,
          status: "issued",
          invoice_number: number,
          prepaid_amount: prepaid,
          amount_due: due,
          ...totals,
        },
        lines
      );

      auditSafe(_e, {
        action: "invoices.issued",
        entityType: "invoice",
        entityId: invoiceId,
        refs: {
          invoice_number: number,
          client_id: invoice.client_id,
          quote_id: invoice.quote_id || null,
          type: invoice.type,
          vat_mode_effective: effectiveMode,
          total_ttc: totals.total_ttc,
          prepaid_amount: prepaid,
          amount_due: due,
        },
        payload: { fingerprint_sha256: fp.fingerprint_sha256 },
      });

      return { ok: true, invoice_number: number };
    });

    return tx();
  });

  // -------- exportUbl
ipcMain.handle(
  "invoices:exportUbl",
  async (_e, { id, profile = "peppol-bis3", force = false } = {}) => {
    ensureInvoicesSchema(db());
    const raw = { id, profile, force };
    console.log("[IPC exportUbl] raw args =", raw);

    const invoiceId = s(id);
    console.log("[IPC exportUbl] normalized invoiceId =", invoiceId);

    const exists = db()
      .prepare("SELECT id, status, invoice_number FROM invoices WHERE id = ?")
      .get(invoiceId);
    console.log("[IPC exportUbl] exists =", exists);

    const full = getFull(db(), invoiceId);
    if (!full) throw new Error("Facture introuvable");

    const invoice = full.invoice;
    if (invoice.status !== "issued") throw new Error("Exporter UBL: facture doit être émise.");

    const company = db().prepare("SELECT * FROM company WHERE id = 1").get();
    const client = db().prepare("SELECT * FROM clients WHERE id = ?").get(invoice.client_id);

    if (!company) throw new Error("Société introuvable");
    if (!client) throw new Error("Client introuvable");

    // contrôles existants (hors PEPPOL endpoint)
    ensureCompanyForIssue(company);
    ensureClientForIssue(client, invoice);
    ensureLinesForIssue(full.lines);

    // --- Fallback VAT id (sans gestion pays par pays)
    // Si ta DB n'utilise pas strictement "vat_id", on tente des alias fréquents.
    function pickVatCandidate(entity) {
      const candidates = [
        entity?.vat_id,
        entity?.vatId,
        entity?.vat_number,
        entity?.vatNumber,
        entity?.tax_id,
        entity?.taxId,
        entity?.pib,
        entity?.pib_number,
        entity?.legal_id,
        entity?.registration_number,
        entity?.company_id,
        entity?.companyId,
      ];
      for (const c of candidates) {
        const v = s(c);
        if (v) return v;
      }
      return "";
    }

    if (!s(company.vat_id)) {
      const v = pickVatCandidate(company);
      if (v) company.vat_id = v;
    }
    if (!s(client.vat_id)) {
      const v = pickVatCandidate(client);
      if (v) client.vat_id = v;
    }

    // --- Résolution PEPPOL endpoints AVANT validatePeppolEn16931
    await loadPeppolParticipantIdentifierSchemes();

    await ensurePeppolExportPrereqsAutoUniversal(company, client, {
      smlZone: "sml.peppolcentral.org",
      maxCandidates: 120,
    });

    // (optionnel) persister en DB si colonnes présentes
    try {
      db()
        .prepare("UPDATE company SET endpoint_id = ?, endpoint_scheme = ? WHERE id = 1")
        .run(s(company.endpoint_id), s(company.endpoint_scheme));
    } catch (e) {
      // ignore: colonnes peut-être absentes
    }
    try {
      db()
        .prepare("UPDATE clients SET endpoint_id = ?, endpoint_scheme = ? WHERE id = ?")
        .run(s(client.endpoint_id), s(client.endpoint_scheme), client.id);
    } catch (e) {
      // ignore: colonnes peut-être absentes
    }

    // snapshots totals/breakdown
    const totals =
      safeJsonParse(invoice.totals_json, null) || {
        total_ht: round2(invoice.total_ht),
        total_tva: round2(invoice.total_tva),
        total_ttc: round2(invoice.total_ttc),
      };

    const taxBreakdown =
      safeJsonParse(invoice.tax_breakdown_json, null) || computeTaxBreakdown(full.lines);

    // validate before building XML (MAINTENANT que endpoints sont résolus)
    const issues = validatePeppolEn16931({
      company,
      client,
      invoice,
      lines: full.lines,
      totals,
      taxBreakdown,
    });

    if (issues.length) {
      return {
        ok: false,
        error: `Non conforme PEPPOL/EN16931 (${issues.length} point(s)).`,
        details: issues,
      };
    }

    const refs = { prepayments: [], original: null };

    try {
      if (tableExists(db(), "invoice_links")) {
        const prepayRows = db()
          .prepare(
            `
            SELECT i.id, i.invoice_number, i.date
            FROM invoice_links l
            JOIN invoices i ON i.id = l.from_invoice_id
            WHERE l.to_invoice_id = ?
              AND l.link_type = 'prepayment_of'
              AND i.status = 'issued'
            ORDER BY i.date ASC, i.invoice_number ASC, i.id ASC
          `
          )
          .all(invoiceId);

        refs.prepayments = prepayRows.map((r) => ({
          id: r.id,
          invoice_number: r.invoice_number,
          date: r.date,
        }));
      }

      if (s(invoice.type) === "credit_note" && s(invoice.source_invoice_id)) {
        const orig = db()
          .prepare(`SELECT id, invoice_number, date FROM invoices WHERE id = ?`)
          .get(s(invoice.source_invoice_id));

        if (orig) {
          refs.original = { id: orig.id, invoice_number: orig.invoice_number, date: orig.date };
        }
      }
    } catch {
      // keep refs empty
    }

    const xml = buildPeppolUbl21Document({
      company,
      client,
      invoice,
      lines: full.lines,
      refs,
    });

    const filename = s(invoice.invoice_number) || `invoice-${invoice.id}`;
    const resourcesDir = path.join(__dirname, "..", "resources");

    let validation = { ok: true, errors: [] };
    try {
      validation = validateUblSchematron({ xml, resourcesDir });
    } catch (err) {
      return {
        ok: false,
        error: `Validation Schematron impossible: ${err?.message || err}`,
        details: { where: "validateUblSchematron" },
      };
    }

    auditSafe(_e, {
      action: "invoices.export_ubl",
      entityType: "invoice",
      entityId: invoiceId,
      refs: {
        profile: s(profile),
        filename,
        valid: validation.ok,
        errors_count: validation.errors.length,
      },
    });

    if (!validation.ok) {
      return {
        ok: false,
        error: "XML non conforme PEPPOL / EN16931 (Schematron).",
        details: validation.errors,
        xml,
        filename,
        profile,
      };
    }

    // ✅ ANTI-DOUBLON: seulement pour PEPPOL BIS3
    if (s(profile) === "peppol-bis3") {
      const fp = invoiceAuditFingerprint(invoice, full.lines);
      const exportHash = fp.fingerprint_sha256;

      const prev = db()
        .prepare(
          "SELECT peppol_export_hash, peppol_exported_at, peppol_export_count FROM invoices WHERE id = ?"
        )
        .get(invoiceId);

      if (!force && prev?.peppol_export_hash && prev.peppol_export_hash === exportHash) {
        return {
          ok: false,
          error: "Déjà exportée PEPPOL (même contenu).",
          details: {
            peppol_exported_at: prev.peppol_exported_at,
            peppol_export_count: prev.peppol_export_count,
            hint: "Passe force=true pour régénérer malgré tout.",
          },
        };
      }

      const now = nowIso();
      db()
        .prepare(
          `
          UPDATE invoices
          SET peppol_exported_at = @at,
              peppol_export_hash = @hash,
              peppol_export_profile = @profile,
              peppol_export_filename = @filename,
              peppol_export_count = COALESCE(peppol_export_count, 0) + 1,
              updated_at = @at
          WHERE id = @id
        `
        )
        .run({
          id: invoiceId,
          at: now,
          hash: exportHash,
          profile: s(profile),
          filename,
        });
    }

    // --- write file to disk (XML) ---
    const exportDir = await ensureExportDir();
    const outName = `${filename}.xml`;
    const outPath = path.join(exportDir, outName);

    await fsp.writeFile(outPath, xml, "utf8");
    return { ok: true, xml, filename, profile, outPath };
  }
);

ipcMain.handle("invoices:createDeposit", (_e, payload = {}) => {
  ensureInvoicesSchema(db());

  const extractQuoteKey = (input) => {
    if (!input) return "";

    if (typeof input === "string") {
      return s(input);
    }

    if (typeof input === "object") {
      return extractQuoteKey(
        input.id ??
        input.number ??
        input.quoteId ??
        input.quote ??
        input.payload
      );
    }

    return "";
  };

  const key = extractQuoteKey(payload.quoteId ?? payload);

  if (!key) {
  throw new Error("quoteId required");
}

const rawMode = s(
  payload.mode ??
  payload.deposit_mode ??
  payload.depositMode ??
  payload.type_acompte ??
  payload.deposit_type
).toLowerCase();

const rawValue =
  payload.value ??
  payload.amount ??
  payload.deposit_value ??
  payload.depositValue ??
  payload.montant;

const modeAliases = {
  percent: "percent",
  percentage: "percent",
  pourcentage: "percent",
  pct: "percent",
  amount: "amount",
  montant: "amount",
  fixed: "amount",
  fixe: "amount",
};

const mode = modeAliases[rawMode] || "";
const value = n(rawValue);

if (!["percent", "amount"].includes(mode)) {
  throw new Error(
    `Mode d'acompte invalide: reçu=${JSON.stringify(rawMode)} payload=${JSON.stringify(payload)}`
  );
}

if (!(value > 0)) {
  throw new Error(
    `Valeur d'acompte invalide: reçu=${JSON.stringify(rawValue)} payload=${JSON.stringify(payload)}`
  );
}
  if (!tableExists(db(), "quotes") || !tableExists(db(), "quote_lines")) {
    throw new Error("Schéma devis manquant (quotes/quote_lines).");
  }
  const quote = db()
    .prepare(
      `
      SELECT id, number, client_id
      FROM quotes
      WHERE id = ? OR number = ?
      LIMIT 1
      `
    )
    .get(key, key);

  if (!quote) {
  throw new Error(
    `Devis introuvable: key=${JSON.stringify(key)} payload=${JSON.stringify(payload)}`
  );
}
  const qid = quote.id;
  const quoteLinesRaw = db()
    .prepare(
      `
      SELECT
        quantity, unit_price_ht, remise_percent, tva_percent,
        vat_category
      FROM quote_lines
      WHERE quote_id = ?
      `
    )
    .all(qid);

  const quoteLines = quoteLinesRaw.map((l) => ({
    quantity: n(l.quantity, 1),
    unit_price_ht: n(l.unit_price_ht, 0),
    remise_percent: n(l.remise_percent, 0),
    tva_percent: n(l.tva_percent, 0),
    vat_category: s(l.vat_category || (n(l.tva_percent, 0) === 0 ? "Z" : "S")) || "S",
  }));

  const totalsQuote = computeInvoiceTotals(quoteLines);
  const taxBreakdownQuote = computeTaxBreakdown(quoteLines);

  let amountTtcWanted = 0;
  if (s(mode) === "percent") {
    amountTtcWanted = round2((totalsQuote.total_ttc * n(value)) / 100);
  } else if (s(mode) === "amount") {
    amountTtcWanted = round2(n(value));
  }

  amountTtcWanted = Math.max(0, amountTtcWanted);

  if (!(amountTtcWanted > 0)) {
    throw new Error("Acompte invalide (montant TTC = 0).");
  }

  const ratio = totalsQuote.total_ttc > 0 ? amountTtcWanted / totalsQuote.total_ttc : 0;

  const depositLines = taxBreakdownQuote
    .map((tb) => {
      const groupTtc = round2(round2(tb.taxable_ht) + round2(tb.vat_amount));
      const depTtc = round2(groupTtc * ratio);

      const rate = round2(tb.tva_percent);
      const depHt = rate > 0 ? round2(depTtc / (1 + rate / 100)) : depTtc;

      if (!(depHt > 0)) {
        return null;
      }

      return {
        description: `Acompte sur devis ${quote.number || quote.id} (${rate.toFixed(2)}% TVA)`,
        quantity: 1,
        unit_price_ht: depHt,
        remise_percent: 0,
        tva_percent: rate,
        vat_category: s(tb.vat_category || (rate === 0 ? "Z" : "S")) || "S",
        line_type: "adjustment",
        unit_code: "C62",
        item_type: "SERVICE",
      };
    })
    .filter(Boolean);

  if (!depositLines.length) {
    throw new Error("Impossible de générer les lignes d'acompte.");
  }

  const invId = randomUUID();
  const t = nowIso();

  const tx = db().transaction(() => {
    db()
      .prepare(
        `
        INSERT INTO invoices (
          id, quote_id, client_id, type, status,
          date, currency, notes,
          prepaid_amount, amount_due,
          total_ht, total_tva, total_ttc,
          totals_json, tax_breakdown_json,
          created_at, updated_at
        ) VALUES (
          @id, @quote_id, @client_id, 'deposit', 'draft',
          @date, 'EUR', NULL,
          0, 0,
          0, 0, 0,
          '{}', '[]',
          @created_at, @updated_at
        )
        `
      )
      .run({
        id: invId,
        quote_id: qid,
        client_id: quote.client_id || null,
        date: t.slice(0, 10),
        created_at: t,
        updated_at: t,
      });

    const persisted = persistInvoiceLines(db(), invId, depositLines);
    const totals = computeInvoiceTotals(persisted);
    const taxBreakdown = computeTaxBreakdown(persisted);
    const due = computeAmountDueByType("deposit", totals.total_ttc, 0);

    db()
      .prepare(
        `
        UPDATE invoices
        SET total_ht = @ht,
            total_tva = @tva,
            total_ttc = @ttc,
            prepaid_amount = 0,
            amount_due = @due,
            totals_json = @tj,
            tax_breakdown_json = @xb,
            updated_at = @u
        WHERE id = @id
        `
      )
      .run({
        id: invId,
        ht: totals.total_ht,
        tva: totals.total_tva,
        ttc: totals.total_ttc,
        due,
        tj: toJson(totals),
        xb: toJson(taxBreakdown),
        u: t,
      });
  });

  tx();

  return { ok: true, id: invId };
});
  
  // -------- createFromQuote (draft final invoice from quote lines + prepaid_amount + amount_due + invoice_links)
  ipcMain.handle("invoices:createFromQuote", (_e, { quoteId } = {}) => {
    ensureInvoicesSchema(db());

    const qid = s(quoteId);
    if (!qid) throw new Error("quoteId required");

    if (!tableExists(db(), "quotes") || !tableExists(db(), "quote_lines")) {
      throw new Error("Schéma devis manquant (quotes/quote_lines).");
    }

    const quote = db()
      .prepare("SELECT id, number, client_id, meta_json, use_case_code, use_case_meta_json FROM quotes WHERE id = ?")
      .get(qid);

    if (!quote) throw new Error("Devis introuvable");

    const quoteLines = db()
      .prepare(
        `
        SELECT
          article_id, article_ref, description,
          quantity, unit_code, unit_price_ht, remise_percent,
          tva_percent,
          line_type,
          item_type,
          vat_category, vat_exempt_reason, vat_exempt_code
        FROM quote_lines
        WHERE quote_id = ?
        ORDER BY rowid ASC
      `
      )
      .all(qid);

    const invId = randomUUID();
    const t = nowIso();

    auditSafe(_e, {
      action: "invoices.create_from_quote_requested",
      entityType: "invoice",
      entityId: invId,
      refs: { quote_id: qid, quote_number: quote.number || null, client_id: quote.client_id || null },
    });

    const tx = db().transaction(() => {
      db()
        .prepare(
          `
          INSERT INTO invoices (
            id, quote_id, client_id, type, status,
            date, currency, notes,
            prepaid_amount, amount_due,
            use_case_code, use_case_meta_json, meta_json,
            total_ht, total_tva, total_ttc,
            created_at, updated_at
          ) VALUES (
            @id, @quote_id, @client_id, 'final', 'draft',
            @date, 'EUR', NULL,
            0, 0,
            @use_case_code, @use_case_meta_json, @meta_json,
            0, 0, 0,
            @created_at, @updated_at
          )
        `
        )
        .run({
          id: invId,
          quote_id: qid,
          client_id: quote.client_id || null,
          date: t.slice(0, 10),
          use_case_code: s(quote.use_case_code),
          use_case_meta_json: s(quote.use_case_meta_json) || "{}",
          meta_json: s(quote.meta_json) || "{}",
          created_at: t,
          updated_at: t,
        });

      const persisted = persistInvoiceLines(db(), invId, quoteLines);
      const totals = computeInvoiceTotals(persisted);
      const taxBreakdown = computeTaxBreakdown(persisted);

      const depositsPaid = sumIssuedDepositsTtcByQuote(db(), qid);
      syncPrepaymentLinks(db(), { quoteId: qid, finalInvoiceId: invId, now: t });

      const due = computeAmountDueByType("final", totals.total_ttc, depositsPaid);

      db()
        .prepare(
          `UPDATE invoices
           SET total_ht=@ht, total_tva=@tva, total_ttc=@ttc,
               prepaid_amount=@prepaid,
               amount_due=@due,
               totals_json=@tj, tax_breakdown_json=@xb, updated_at=@u
           WHERE id=@id`
        )
        .run({
          id: invId,
          ht: totals.total_ht,
          tva: totals.total_tva,
          ttc: totals.total_ttc,
          prepaid: depositsPaid,
          due,
          tj: toJson(totals),
          xb: toJson(taxBreakdown),
          u: t,
        });

      const fp = invoiceAuditFingerprint(
        {
          id: invId,
          quote_id: qid,
          client_id: quote.client_id || null,
          type: "final",
          status: "draft",
          date: t.slice(0, 10),
          currency: "EUR",
          prepaid_amount: depositsPaid,
          amount_due: due,
          ...totals,
        },
        persisted
      );

      auditSafe(_e, {
        action: "invoices.create_from_quote_snapshot",
        entityType: "invoice",
        entityId: invId,
        refs: {
          quote_id: qid,
          deposits_sum_ttc: depositsPaid,
          total_ttc: totals.total_ttc,
          amount_due: due,
        },
        payload: { fingerprint_sha256: fp.fingerprint_sha256 },
      });
    });

    tx();

    auditSafe(_e, {
      action: "invoices.create_from_quote_committed",
      entityType: "invoice",
      entityId: invId,
      refs: { status_after: "draft" },
    });

    return { ok: true, id: invId };
  });

  // -------- createCreditNote
  ipcMain.handle("invoices:createCreditNote", (_e, { invoiceId } = {}) => {
    ensureInvoicesSchema(db());

    const srcId = s(invoiceId);
    if (!srcId) throw new Error("invoiceId required");

    const orig = db().prepare("SELECT id, client_id, status FROM invoices WHERE id = ?").get(srcId);
    if (!orig) throw new Error("Facture d'origine introuvable");
    if (orig.status !== "issued") throw new Error("Créer un avoir sur une facture émise");

    const origLines = loadInvoiceLines(db(), srcId);

    const creditLines = origLines.map((l) => ({
      ...l,
      id: randomUUID(),
      quantity: -Math.abs(n(l.quantity, 1)),
      line_type: "adjustment",
    }));

    const newId = randomUUID();
    const t = nowIso();

    auditSafe(_e, {
      action: "invoices.create_credit_note_requested",
      entityType: "invoice",
      entityId: newId,
      refs: { source_invoice_id: srcId, client_id: orig.client_id },
    });

    const tx = db().transaction(() => {
      const creditMeta = {
        kind: "credit_note",
        scope: "EXTERNAL",
        source: { invoice_id: srcId },
      };

      db()
        .prepare(
          `
          INSERT INTO invoices (
            id, source_invoice_id, client_id, type, status,
            date, currency, notes,
            prepaid_amount, amount_due,
            meta_json,
            total_ht, total_tva, total_ttc,
            created_at, updated_at
          ) VALUES (
            @id, @source_invoice_id, @client_id, 'credit_note', 'draft',
            @date, 'EUR', 'Avoir sur facture',
            0, 0,
            @meta_json,
            0, 0, 0,
            @created_at, @updated_at
          )
        `
        )
        .run({
          id: newId,
          source_invoice_id: srcId,
          client_id: orig.client_id,
          date: t.slice(0, 10),
          meta_json: toJson(creditMeta),
          created_at: t,
          updated_at: t,
        });

      const persisted = persistInvoiceLines(db(), newId, creditLines);
      const totals = computeInvoiceTotals(persisted);
      const taxBreakdown = computeTaxBreakdown(persisted);

      const due = computeAmountDueByType("credit_note", totals.total_ttc, 0);

      const fp = invoiceAuditFingerprint(
        {
          id: newId,
          source_invoice_id: srcId,
          client_id: orig.client_id,
          type: "credit_note",
          status: "draft",
          date: t.slice(0, 10),
          currency: "EUR",
          prepaid_amount: 0,
          amount_due: due,
          ...totals,
        },
        persisted
      );

      auditSafe(_e, {
        action: "invoices.create_credit_note_snapshot",
        entityType: "invoice",
        entityId: newId,
        refs: { source_invoice_id: srcId, total_ttc: totals.total_ttc, amount_due: due },
        payload: { fingerprint_sha256: fp.fingerprint_sha256 },
      });

      db()
        .prepare(
          `UPDATE invoices
           SET total_ht=@ht, total_tva=@tva, total_ttc=@ttc,
               amount_due=@due,
               totals_json=@tj, tax_breakdown_json=@xb
           WHERE id=@id`
        )
        .run({
          ht: totals.total_ht,
          tva: totals.total_tva,
          ttc: totals.total_ttc,
          due,
          tj: toJson(totals),
          xb: toJson(taxBreakdown),
          id: newId,
        });
    });

    tx();

    auditSafe(_e, {
      action: "invoices.create_credit_note_committed",
      entityType: "invoice",
      entityId: newId,
      refs: { status_after: "draft" },
    });

    return { ok: true, id: newId };
  });

  // -------- createBlank (compat)
  ipcMain.handle("invoices:createBlank", (_e, payload = {}) => {
    ensureInvoicesSchema(db());

    const id = randomUUID();
    const t = nowIso();

    auditSafe(_e, {
      action: "invoices.create_blank_requested",
      entityType: "invoice",
      entityId: id,
      refs: { client_id: payload.client_id || null, type: s(payload.type) || "final" },
    });

    const type = (() => {
      const tp = s(payload.type) || "final";
      return ["final", "deposit", "credit_note"].includes(tp) ? tp : "final";
    })();

    const prepaid = round2(n(payload.prepaid_amount, 0));
    const due = computeAmountDueByType(type, 0, prepaid);

    db()
      .prepare(
        `
        INSERT INTO invoices (
          id, quote_id, client_id, type, status,
          date, due_date, currency, notes,
          prepaid_amount, amount_due,
          use_case_code, use_case_meta_json, meta_json,
          total_ht, total_tva, total_ttc,
          created_at, updated_at
        ) VALUES (
          @id, NULL, @client_id, @type, 'draft',
          @date, @due_date, @currency, @notes,
          @prepaid_amount, @amount_due,
          @use_case_code, @use_case_meta_json, @meta_json,
          0, 0, 0,
          @created_at, @updated_at
        )
      `
      )
      .run({
        id,
        client_id: payload.client_id || null,
        type,
        date: isoDate(payload.date) || t.slice(0, 10),
        due_date: payload.due_date ? isoDate(payload.due_date) : null,
        currency: s(payload.currency) || "EUR",
        notes: s(payload.notes),

        prepaid_amount: prepaid,
        amount_due: due,

        use_case_code: s(payload.use_case_code),
        use_case_meta_json: toJson(payload.use_case_meta || {}),
        meta_json: toJson(payload.meta_json || {}),
        created_at: t,
        updated_at: t,
      });

    auditSafe(_e, {
      action: "invoices.create_blank_committed",
      entityType: "invoice",
      entityId: id,
      refs: { status_after: "draft" },
    });

    return { ok: true, id };
  });

  // -------- exportPeppolPdf (STUB)
  ipcMain.handle("invoices:exportPeppolPdf", (_e, { id, profile = "peppol-bis3" } = {}) => {
    ensureInvoicesSchema(db());
    const invoiceId = s(id);
    if (!invoiceId) throw new Error("Invoice id required");

    auditSafe(_e, {
      action: "invoices.export_peppol_pdf_requested",
      entityType: "invoice",
      entityId: invoiceId,
      refs: { profile: s(profile) },
    });

    return {
      ok: false,
      error: `PDF PEPPOL: handler stub. Implémenter invoices:exportPeppolPdf côté IPC (profil=${s(profile)}).`,
    };
  });
};
