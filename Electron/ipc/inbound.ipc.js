"use strict";

/**
 * inbound.ipc.js
 * --------------
 * IPC layer for inbound e-invoicing ingestion & UI.
 *
 * Features:
 * - Import local file (XML UBL/CII, PDF Factur-X with embedded XML)
 * - List inbound documents with search (q) + schema-tolerant mapping
 * - Get detail (flat for UI + canonical)
 * - Accept / Reject / Dispute (stores reason/code in inbound_documents.meta_json)
 * - Export XML (UBL/CII or embedded XML from Factur-X if present)
 * - Export PDF:
 *    - If original payload is PDF => save it
 *    - If payload is XML => render a simple HTML and printToPDF via hidden BrowserWindow
 * - Optional SFTP polling & embedded Webhook server
 *
 * Notes about DB schema (based on your store.js):
 * inbound_documents columns (important):
 *  - id, source_type, source_name, received_at, format, content_type, filename,
 *    sha256, status, payload (BLOB), meta_json (TEXT), errors_json, warnings_json
 *
 * inbound_invoices columns (important):
 *  - id, document_id, invoice_number, issue_date, currency,
 *    seller_json, buyer_json, totals_json, lines_json, created_at
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { dialog, BrowserWindow } = require("electron");

const { detectFormat } = require("../inbound/detectFormat");
const { normalizeXmlToCanonical } = require("../inbound/normalize");
const { insertDocument, setDocumentStatus, upsertCanonicalInvoice } = require("../inbound/store");
const { pollSftpOnce } = require("../inbound/sftp/poller");
const { createWebhookServer } = require("../inbound/webhook/server");

// Factur-X PDF attachments (embedded XML) - supports pdfjs-dist v3 (CJS) and v4+ (ESM)
let _pdfjsLibPromise = null;

async function getPdfjsLib() {
  if (_pdfjsLibPromise) return _pdfjsLibPromise;

  _pdfjsLibPromise = (async () => {
    // 1) Try CommonJS (pdfjs-dist v3)
    try {
      // eslint-disable-next-line global-require
      return require("pdfjs-dist/legacy/build/pdf.js");
    } catch (e1) {
      // 2) Try ESM (pdfjs-dist v4+ / v5)
      try {
        const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
        return mod?.default || mod;
      } catch (e2) {
        throw new Error(
          `pdfjs-dist introuvable/ininitialisable. CJS=${e1?.message || e1} | ESM=${e2?.message || e2}`
        );
      }
    }
  })();

  return _pdfjsLibPromise;
}

let sftpTimer = null;
let webhookServer = null;

/* -------------------------------------------------------
 * Small utilities
 * ----------------------------------------------------- */

function safeJsonParse(x) {
  if (!x) return null;
  if (typeof x === "object") return x;
  try {
    return JSON.parse(String(x));
  } catch {
    return null;
  }
}

function toUiStatus(st) {
  const s = String(st || "").trim().toUpperCase();
  if (!s) return "received";
  if (s === "RECEIVED") return "received";
  if (s === "VALIDATED") return "received"; // validated but not decided
  if (s === "ACCEPTED") return "accepted";
  if (s === "REJECTED") return "rejected";
  if (s === "DISPUTED") return "disputed";
  if (s === "ERROR") return "error";
  return s.toLowerCase();
}

function toDbStatus(ui) {
  const s = String(ui || "").trim().toLowerCase();
  if (s === "received") return "RECEIVED";
  if (s === "accepted") return "ACCEPTED";
  if (s === "rejected") return "REJECTED";
  if (s === "disputed") return "DISPUTED";
  if (s === "error") return "ERROR";
  return String(ui || "").trim().toUpperCase() || "RECEIVED";
}

function money(x) {
  if (x === null || x === undefined) return 0;
  if (typeof x === "number") return Number.isFinite(x) ? x : 0;

  const s = String(x)
    .trim()
    .replace(/\s+/g, "")
    .replace(/(EUR|€)$/i, "")
    .replace(",", ".");

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function ensureLineTotals(canonical) {
  if (!canonical || typeof canonical !== "object") return canonical;

  const lines = Array.isArray(canonical.lines) ? canonical.lines : [];
  canonical.lines = lines.map((l) => {
    const line = { ...(l || {}) };

    const base =
      money(
        line.line_total_ht ??
        line.line_total ??
        line.net_amount ??
        line.net_line_amount ??
        line.line_extension_amount ??
        line.ht ??
        line.amount
      ) ||
      (money(line.quantity ?? line.qty ?? line.invoiced_quantity ?? 0) *
       money(line.unit_price_ht ?? line.unit_price ?? line.price_ht ?? line.price ?? 0));

    line.line_total_ht = base;

    const rate = money(line.tva_percent ?? line.vat_percent ?? line.tax_percent);
    const tax =
      money(line.line_tax_amount ?? line.tax_amount ?? line.vat_amount) ||
      (rate ? base * (rate / 100) : 0);

    line.line_tax_amount = tax;

    return line;
  });

  return canonical;
}

// Make user-facing totals always a number
function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function sqlHasColumn(dbh, table, col) {
  try {
    const rows = dbh.prepare(`PRAGMA table_info(${table})`).all();
    return (rows || []).some((r) => String(r.name) === String(col));
  } catch {
    return false;
  }
}

function sqlTableExists(dbh, table) {
  try {
    const row = dbh
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(table);
    return !!row;
  } catch {
    return false;
  }
}

/**
 * ✅ IMPORTANT FIX (pdfjs-dist):
 * Some versions require binary data as Uint8Array (not Buffer).
 * Buffer is a Uint8Array, but strict checks may reject Buffer instances.
 */
function toUint8(x) {
  if (!x) return new Uint8Array();

  // ✅ IMPORTANT: check Buffer FIRST, because Buffer is a Uint8Array subclass
  if (Buffer.isBuffer(x)) {
    return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  }

  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);

  try {
    const b = Buffer.from(x);
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  } catch {
    return new Uint8Array();
  }
}

/**
 * ✅ Robust XML decode for embedded attachments (UTF-8 / UTF-16 BOM)
 */
function decodeXmlBytes(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(toUint8(bytes));

  // UTF-8 BOM
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    return b.slice(3).toString("utf8");
  }

  // UTF-16 LE BOM
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    return b.slice(2).toString("utf16le");
  }

  // UTF-16 BE BOM
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    // swap BE -> LE
    const swapped = Buffer.allocUnsafe(b.length - 2);
    for (let i = 2; i < b.length; i += 2) {
      swapped[i - 2] = b[i + 1];
      swapped[i - 1] = b[i];
    }
    return swapped.toString("utf16le");
  }

  return b.toString("utf8");
}

/**
 * Some projects had `meta` column; yours is `meta_json`.
 * We detect and build safe SQL fragments accordingly.
 */
function buildDocMetaFragments(dbh) {
  const hasMetaJson = sqlHasColumn(dbh, "inbound_documents", "meta_json");
  const hasMeta = sqlHasColumn(dbh, "inbound_documents", "meta");

  // Prefer meta_json, fallback to meta, else literal NULL
  const metaExpr = hasMetaJson ? "d.meta_json" : hasMeta ? "d.meta" : "NULL";

  // We only use json_extract if meta field exists and is JSON text
  const canJsonExtract = hasMetaJson || hasMeta;

  return {
    metaExpr,
    canJsonExtract,
    rejectReasonExpr: canJsonExtract ? `json_extract(${metaExpr}, '$.response_reason')` : "NULL",
    rejectCodeExpr: canJsonExtract ? `json_extract(${metaExpr}, '$.response_code')` : "NULL",
  };
}

/**
 * inbound_invoices mapping.
 * Canonical is stored in JSON columns:
 * - seller_json: {"name": "...", ...}
 * - totals_json: { "grand_total": ..., ... } (or payable_amount / amount_due depending normalize)
 *
 * We COALESCE multiple possible keys to avoid 0.
 */
function buildInvoiceFragments(dbh) {
  const exists = sqlTableExists(dbh, "inbound_invoices");
  if (!exists) {
    return {
      joinOk: false,
      supplierExpr: "NULL",
      numberExpr: "NULL",
      dateExpr: "NULL",
      totalExpr: "0",
      currencyExpr: "'EUR'",
      searchExprs: [],
    };
  }

  const cols = new Set(
    (dbh.prepare(`PRAGMA table_info(inbound_invoices)`).all() || []).map((r) => String(r.name))
  );

  const has = (c) => cols.has(c);

  const numberExpr = has("invoice_number") ? "i.invoice_number" : "NULL";
  const dateExpr = has("issue_date") ? "i.issue_date" : "NULL";
  const currencyExpr = has("currency") ? "COALESCE(i.currency,'EUR')" : "'EUR'";

  // supplier: try multiple common seller_json fields
  let supplierExpr = "NULL";
  if (has("seller_json")) {
    supplierExpr = `COALESCE(
      json_extract(i.seller_json, '$.name'),
      json_extract(i.seller_json, '$.legal_name'),
      json_extract(i.seller_json, '$.party_name'),
      json_extract(i.seller_json, '$.registration_name'),
      NULL
    )`;
  }

  // totals: try multiple keys (grand_total, payable_amount, amount_due, total_ttc)
  let totalExpr = "0";
  if (has("totals_json")) {
    totalExpr = `COALESCE(
      json_extract(i.totals_json, '$.grand_total'),
      json_extract(i.totals_json, '$.payable_amount'),
      json_extract(i.totals_json, '$.amount_due'),
      json_extract(i.totals_json, '$.total_ttc'),
      json_extract(i.totals_json, '$.tax_inclusive_amount'),
      0
    )`;
  }

  const searchExprs = [];
  if (has("invoice_number")) searchExprs.push("i.invoice_number");
  if (has("seller_json")) searchExprs.push(`json_extract(i.seller_json,'$.name')`);

  return {
    joinOk: true,
    supplierExpr,
    numberExpr,
    dateExpr,
    totalExpr,
    currencyExpr,
    searchExprs,
  };
}

/* -------------------------------------------------------
 * FACTUR-X extraction: embedded XML from PDF attachments
 * ----------------------------------------------------- */

async function extractFacturxXmlFromPdf(pdfBuffer) {
  let pdfjsLib;
  try {
    pdfjsLib = await getPdfjsLib();
  } catch (e) {
    return {
      ok: false,
      error: e?.message || String(e),
      xml: null,
      filename: null,
    };
  }

  // ✅ Always use Uint8Array for pdfjs-dist
  const data = toUint8(pdfBuffer);

  const task = pdfjsLib.getDocument({ data });
  const pdf = await task.promise;

  const attachments = (await pdf.getAttachments()) || {};
  const names = Object.keys(attachments);

  if (!names.length) {
    return { ok: true, xml: null, filename: null };
  }

  const pick =
    names.find((n) => n.toLowerCase().endsWith(".xml")) ||
    names.find((n) => n.toLowerCase().includes("factur")) ||
    names.find((n) => n.toLowerCase().includes("zugferd")) ||
    names[0];

  const att = attachments[pick];
  if (!att?.content) return { ok: true, xml: null, filename: null };

  // ✅ Force attachment bytes to Uint8Array then decode robustly
  const xml = decodeXmlBytes(att.content);
  return { ok: true, xml, filename: att.filename || pick };
}

function detectXmlFlavorFromContent(xml) {
  const head = String(xml || "").slice(0, 20000).toUpperCase();

  // CII: CrossIndustryInvoice
  if (head.includes("CROSSINDUSTRYINVOICE") || head.includes(":CROSSINDUSTRYINVOICE")) return "CII";

  // UBL Invoice root often <Invoice ...>
  if (head.includes("<INVOICE") || head.includes(":INVOICE")) return "UBL";

  return "UNKNOWN";
}

/* -------------------------------------------------------
 * Export helpers
 * ----------------------------------------------------- */

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(x) {
  const v = Number(x || 0);
  return (Math.round(v * 100) / 100).toFixed(2);
}

function canonicalToHtml({ doc, canonical, locale = "fr" }) {
  const inv = canonical || {};
  const seller = safeJsonParse(inv.seller_json) || inv.seller || {};
  const buyer = safeJsonParse(inv.buyer_json) || inv.buyer || {};
  const totals = safeJsonParse(inv.totals_json) || inv.totals || {};
  const lines = safeJsonParse(inv.lines_json) || inv.lines || [];

  const title = locale === "en" ? "Inbound invoice" : "Facture reçue";
  const subtitle = `${escapeHtml(doc?.filename || "")} • ${escapeHtml(String(doc?.format || ""))}`;

  const rows = (Array.isArray(lines) ? lines : []).map((l) => {
    const desc = escapeHtml(l.description || l.name || l.label || "");
    const qty = escapeHtml(l.quantity ?? "");
    const pu = escapeHtml(formatMoney(l.unit_price_ht ?? l.unit_price ?? l.price ?? 0));
    const vat = escapeHtml(l.tva_percent ?? l.vat_percent ?? "");
    const ht = escapeHtml(formatMoney(l.line_total_ht ?? l.line_total ?? l.ht ?? 0));
    return `<tr>
      <td>${desc}</td>
      <td style="text-align:right">${qty}</td>
      <td style="text-align:right">${pu}</td>
      <td style="text-align:right">${vat}</td>
      <td style="text-align:right">${ht}</td>
    </tr>`;
  });

  const totalHt =
    toNumber(totals.total_ht) ||
    toNumber(totals.tax_exclusive_amount) ||
    0;

  const totalTva =
    toNumber(totals.total_tva) ||
    toNumber(totals.tax_amount) ||
    0;

  const totalTtc =
    toNumber(totals.grand_total) ||
    toNumber(totals.payable_amount) ||
    toNumber(totals.amount_due) ||
    toNumber(totals.total_ttc) ||
    toNumber(totals.tax_inclusive_amount) ||
    0;

  const currency = inv.currency || "EUR";

  return `<!doctype html>
<html lang="${locale === "en" ? "en" : "fr"}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,Arial,sans-serif; margin:24px; color:#0f172a}
  .h{display:flex; justify-content:space-between; gap:12px; align-items:flex-start}
  .t{font-size:20px; font-weight:800}
  .s{opacity:.7; margin-top:4px}
  .box{border:1px solid #e2e8f0; border-radius:12px; padding:12px; margin-top:14px}
  .grid{display:grid; grid-template-columns:1fr 1fr; gap:12px}
  .k{font-size:12px; opacity:.7; margin-bottom:6px}
  .v{font-weight:700}
  table{width:100%; border-collapse:collapse; margin-top:10px}
  th,td{border-bottom:1px solid #e2e8f0; padding:8px; font-size:12px; vertical-align:top}
  th{text-align:left; background:#f8fafc}
  .tot{display:flex; justify-content:flex-end; margin-top:12px}
  .totbox{min-width:280px}
  .totrow{display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #e2e8f0; font-size:12px}
  .totrow strong{font-size:13px}
</style>
</head>
<body>
  <div class="h">
    <div>
      <div class="t">${escapeHtml(title)}</div>
      <div class="s">${subtitle}</div>
    </div>
    <div style="text-align:right">
      <div class="k">${locale === "en" ? "Invoice number" : "Numéro"}</div>
      <div class="v">${escapeHtml(inv.invoice_number || inv.number || doc?.id || "—")}</div>
      <div class="k" style="margin-top:8px">${locale === "en" ? "Issue date" : "Date"}</div>
      <div class="v">${escapeHtml(inv.issue_date || inv.date || "—")}</div>
    </div>
  </div>

  <div class="grid">
    <div class="box">
      <div class="k">${locale === "en" ? "Seller" : "Fournisseur"}</div>
      <div class="v">${escapeHtml(seller.name || seller.legal_name || seller.registration_name || "—")}</div>
      <div style="font-size:12px; margin-top:6px; opacity:.85">${escapeHtml(seller.vat_id || seller.vat || "")}</div>
      <div style="font-size:12px; margin-top:6px; opacity:.85">${escapeHtml((seller.address && (seller.address.street || seller.address.city)) ? `${seller.address.street || ""} ${seller.address.postal_code || ""} ${seller.address.city || ""}` : "")}</div>
    </div>

    <div class="box">
      <div class="k">${locale === "en" ? "Buyer" : "Acheteur"}</div>
      <div class="v">${escapeHtml(buyer.name || buyer.legal_name || buyer.registration_name || "—")}</div>
      <div style="font-size:12px; margin-top:6px; opacity:.85">${escapeHtml(buyer.vat_id || buyer.vat || "")}</div>
      <div style="font-size:12px; margin-top:6px; opacity:.85">${escapeHtml((buyer.address && (buyer.address.street || buyer.address.city)) ? `${buyer.address.street || ""} ${buyer.address.postal_code || ""} ${buyer.address.city || ""}` : "")}</div>
    </div>
  </div>

  <div class="box">
    <div class="k">${locale === "en" ? "Lines" : "Lignes"}</div>
    <table>
      <thead>
        <tr>
          <th>${locale === "en" ? "Description" : "Désignation"}</th>
          <th style="text-align:right">${locale === "en" ? "Qty" : "Qté"}</th>
          <th style="text-align:right">${locale === "en" ? "Unit" : "PU"}</th>
          <th style="text-align:right">TVA%</th>
          <th style="text-align:right">${locale === "en" ? "Line total" : "Total HT"}</th>
        </tr>
      </thead>
      <tbody>
        ${rows.join("\n")}
      </tbody>
    </table>

    <div class="tot">
      <div class="totbox">
        <div class="totrow"><span>${locale === "en" ? "Total excl. VAT" : "Total HT"}</span><strong>${formatMoney(totalHt)} ${escapeHtml(currency)}</strong></div>
        <div class="totrow"><span>${locale === "en" ? "VAT total" : "Total TVA"}</span><strong>${formatMoney(totalTva)} ${escapeHtml(currency)}</strong></div>
        <div class="totrow" style="border-bottom:none"><span>${locale === "en" ? "Total incl. VAT" : "Total TTC"}</span><strong>${formatMoney(totalTtc)} ${escapeHtml(currency)}</strong></div>
      </div>
    </div>
  </div>

  <div style="font-size:11px; opacity:.65; margin-top:14px">
    ${locale === "en" ? "Generated by D2F (inbound view)" : "Généré par D2F (vue inbound)"}
  </div>
</body>
</html>`;
}

async function printHtmlToPdfFile({ html, outPath }) {
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 768,
    webPreferences: {
      // No node integration
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  try {
    const url = "data:text/html;charset=utf-8," + encodeURIComponent(html);
    await win.loadURL(url);

    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      marginsType: 1,
    });

    fs.writeFileSync(outPath, pdf);
    return { ok: true, path: outPath };
  } finally {
    try {
      win.close();
    } catch {}
  }
}

/* -------------------------------------------------------
 * Module export (IPC registration)
 * ----------------------------------------------------- */

module.exports = (ipcMain, getDb) => {
  const db = () => getDb();

  // Cache fragments (schema won’t change during runtime)
  let _metaFrag = null;
  let _invFrag = null;

  function metaFrag() {
    if (!_metaFrag) _metaFrag = buildDocMetaFragments(db());
    return _metaFrag;
  }
  function invFrag() {
    if (!_invFrag) _invFrag = buildInvoiceFragments(db());
    return _invFrag;
  }

  /* -------------------------------------------------------
   * Delete inbound doc (pending only)
   * - Allows re-import when sha256 idempotence blocks duplicates
   * ----------------------------------------------------- */

  ipcMain.handle("inbound:delete", (_e, { id } = {}) => {
    if (!id) throw new Error("id requis");

    const row = db().prepare("SELECT status FROM inbound_documents WHERE id=?").get(id);
    if (!row) return { ok: true, deleted: false };

    const st = String(row.status || "").toUpperCase();

    // ✅ Statuts supprimables (inclut les "non valides")
    const DELETABLE = new Set([
      "RECEIVED",
      "VALIDATED",
      "RECEIVED_NOT_VALID",
      "NON_VALID",
      "INVALID",
      "ERROR",
    ]);

    if (!DELETABLE.has(st)) {
      throw new Error(
    `   Suppression autorisée uniquement pour les documents RECEIVED / RECEIVED_NOT_VALID / NON_VALID / INVALID / ERROR (status=${st})`
      );
    }

    const tx = db().transaction(() => {
      if (sqlTableExists(db(), "inbound_invoices")) {
        db().prepare("DELETE FROM inbound_invoices WHERE document_id=?").run(id);
      }
      db().prepare("DELETE FROM inbound_documents WHERE id=?").run(id);
    });

    tx();
    return { ok: true, deleted: true };
  });

  /* -------------------------------------------------------
   * Ingestion pipeline (shared)
   * ----------------------------------------------------- */

  async function ingestRaw({ source_type, source_name, filename, contentType, payload, meta }) {
    // normalize a bit for fallbacks
    const ext = path.extname(String(filename || "")).toLowerCase();
    const isPdf = ext === ".pdf" || String(contentType || "").toLowerCase().includes("pdf");
    const isXml = ext === ".xml" || String(contentType || "").toLowerCase().includes("xml");

    // 1) primary detection (your detector)
    let format = detectFormat({ filename, contentType, payload });

    // Normalized format (needed for FACTUR-X vs FACTURX variants)
    const normalizedFormat = String(format || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, ""); // FACTUR-X / facturx -> FACTURX

    console.log("[ingest] format détecté:", format, "normalized:", normalizedFormat);

    // 2) fallback: if XML but detector is UNKNOWN, sniff UBL/CII from content
    if ((format !== "UBL" && format !== "CII") && isXml) {
      const xml = Buffer.isBuffer(payload) ? payload.toString("utf8") : String(payload || "");
      const sniff = detectXmlFlavorFromContent(xml);
      if (sniff === "UBL" || sniff === "CII") format = sniff;
    }

    const docRes = insertDocument(db(), {
      source_type,
      source_name,
      content_type: contentType,
      filename,
      format,
      payload,
      meta,
    });

    // duplicate => do not parse again
    if (docRes.duplicate) return docRes;

    try {
      // UBL / CII
      if (format === "UBL" || format === "CII") {
        const xml = Buffer.isBuffer(payload) ? payload.toString("utf8") : String(payload || "");
        const canonical = normalizeXmlToCanonical({ format, xml });

        upsertCanonicalInvoice(db(), docRes.id, canonical);
        setDocumentStatus(db(), docRes.id, "VALIDATED");
        return docRes;
      }

      // FACTUR-X PDF (or any PDF where we can extract embedded XML)
      if (normalizedFormat === "FACTURX" || isPdf) {
        const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);

        const extracted = await extractFacturxXmlFromPdf(buf);

        console.log("[facturx] extracted:", {
          ok: extracted.ok,
          hasXml: !!extracted.xml,
          filename: extracted.filename || null,
          error: extracted.error || null,
        });

        if (!extracted.ok) {
          setDocumentStatus(db(), docRes.id, "RECEIVED", {
            warnings: { message: extracted.error },
          });
          return docRes;
        }

        if (!extracted.xml) {
          setDocumentStatus(db(), docRes.id, "RECEIVED", {
            warnings: { message: "PDF importé, mais aucun XML embarqué trouvé (Factur-X/ZUGFeRD absent ?)." },
          });
          return docRes;
        }

        const xmlFormat = detectXmlFlavorFromContent(extracted.xml);
        if (xmlFormat === "UNKNOWN") {
          setDocumentStatus(db(), docRes.id, "RECEIVED", {
            warnings: { message: "XML embarqué non reconnu (ni UBL ni CII)." },
          });
          return docRes;
        }

        let canonical = normalizeXmlToCanonical({ format: xmlFormat, xml: extracted.xml });
        canonical = ensureLineTotals(canonical);
        upsertCanonicalInvoice(db(), docRes.id, canonical);

        setDocumentStatus(db(), docRes.id, "VALIDATED", {
          warnings: {
            facturx_xml_filename: extracted.filename || null,
            xml_format: xmlFormat,
          },
        });

        return docRes;
      }

      // unknown/other: keep raw only
      setDocumentStatus(db(), docRes.id, "RECEIVED");
      return docRes;
    } catch (e) {
      setDocumentStatus(db(), docRes.id, "ERROR", {
        errors: { message: e?.message || String(e) },
      });
      return docRes;
    }
  }

  /* -------------------------------------------------------
   * Import local file (manual)
   * ----------------------------------------------------- */

  ipcMain.handle("inbound:importFile", async () => {
    const win = BrowserWindow.getFocusedWindow();

    const res = await dialog.showOpenDialog(win, {
      title: "Importer une facture (UBL/CII XML ou Factur-X PDF)",
      properties: ["openFile"],
      filters: [
        { name: "Factures (XML/PDF)", extensions: ["xml", "pdf"] },
        { name: "XML", extensions: ["xml"] },
        { name: "PDF", extensions: ["pdf"] },
      ],
    });

    if (res.canceled || !res.filePaths?.[0]) return { ok: false, canceled: true };

    const filePath = res.filePaths[0];
    const filename = path.basename(filePath);
    const ext = path.extname(filename).toLowerCase();
    const contentType = ext === ".pdf" ? "application/pdf" : "application/xml";
    const payload = fs.readFileSync(filePath);

    const docRes = await ingestRaw({
      source_type: "LOCAL",
      source_name: "Import",
      filename,
      contentType,
      payload,
      meta: { imported_from: filePath },
    });

    return {
      ok: true,
      id: docRes?.id,
      duplicate: !!docRes?.duplicate,
      filename,
      format: docRes?.format || null,
    };
  });

  /* -------------------------------------------------------
   * List for UI: inbound:list
   * ----------------------------------------------------- */

  ipcMain.handle("inbound:list", (_e, { limit = 200, q = "" } = {}) => {
    const query = String(q || "").trim();
    const like = `%${query}%`;

    const mf = metaFrag();
    const inf = invFrag();

    const joinClause = inf.joinOk ? "LEFT JOIN inbound_invoices i ON i.document_id = d.id" : "";

    const baseSearch = [`d.filename LIKE ?`, `d.status LIKE ?`, `d.source_name LIKE ?`, `d.source_type LIKE ?`];
    const invSearch = (inf.searchExprs || []).map((x) => `${x} LIKE ?`);
    const allSearch = baseSearch.concat(invSearch);

    const whereClause = query === "" ? "1=1" : `(${allSearch.join(" OR ")})`;

    const params = [];
    if (query !== "") {
      params.push(like, like, like, like);
      for (let i = 0; i < invSearch.length; i++) params.push(like);
    }

    const lim = Math.max(1, Math.min(Number(limit || 200), 1000));

    const sql = `
      SELECT
        d.id,
        d.source_type,
        d.source_name,
        d.received_at,
        d.format,
        d.filename,
        d.status,

        ${inf.numberExpr}   AS doc_number,
        ${inf.dateExpr}     AS doc_date,
        ${inf.supplierExpr} AS supplier_name,
        ${inf.totalExpr}    AS total_ttc,
        ${inf.currencyExpr} AS currency,

        ${mf.rejectReasonExpr} AS reject_reason,
        ${mf.rejectCodeExpr}   AS reject_code
      FROM inbound_documents d
      ${joinClause}
      WHERE ${whereClause}
      ORDER BY d.received_at DESC
      LIMIT ${lim}
    `;

    const rows = db().prepare(sql).all(...params);

    return rows.map((r) => ({
      ...r,
      status: toUiStatus(r.status),
      received_at: r.received_at || null,
      supplier_name: r.supplier_name || null,
      doc_number: r.doc_number || null,
      doc_date: r.doc_date || null,
      total_ttc: toNumber(r.total_ttc),
      currency: r.currency || "EUR",
      reject_reason: r.reject_reason || null,
      reject_code: r.reject_code || null,
      direction: "IN",
    }));
  });

  /* -------------------------------------------------------
   * Get detail: inbound:get
   * + ✅ returns errors/warnings for UI diagnostics
   * ----------------------------------------------------- */

  ipcMain.handle("inbound:get", (_e, { id } = {}) => {
    if (!id) return null;

    const d = db().prepare(`SELECT * FROM inbound_documents WHERE id=?`).get(id);
    if (!d) return null;

    let inv = null;
    if (sqlTableExists(db(), "inbound_invoices")) {
      inv = db().prepare(`SELECT * FROM inbound_invoices WHERE document_id=?`).get(id) || null;
    }

    const meta = safeJsonParse(d.meta_json) || safeJsonParse(d.meta) || {};
    const seller = safeJsonParse(inv?.seller_json) || {};
    const buyer = safeJsonParse(inv?.buyer_json) || {};
    const totals = safeJsonParse(inv?.totals_json) || {};
    const lines = safeJsonParse(inv?.lines_json) || [];

    const errors = safeJsonParse(d.errors_json) || {};
    const warnings = safeJsonParse(d.warnings_json) || {};

    const supplierName =
      seller?.name ||
      seller?.legal_name ||
      seller?.party_name ||
      seller?.registration_name ||
      null;

    const docNumber = inv?.invoice_number || null;
    const docDate = inv?.issue_date || null;

    const totalTtc =
      toNumber(totals?.grand_total) ||
      toNumber(totals?.payable_amount) ||
      toNumber(totals?.amount_due) ||
      toNumber(totals?.total_ttc) ||
      toNumber(totals?.tax_inclusive_amount) ||
      0;

    return {
      id: d.id,
      source_type: d.source_type,
      source_name: d.source_name,
      received_at: d.received_at,
      format: d.format,
      filename: d.filename,
      status: toUiStatus(d.status),

      supplier_name: supplierName,
      doc_number: docNumber,
      doc_date: docDate,
      total_ttc: totalTtc,
      currency: inv?.currency || "EUR",

      reject_reason: meta.response_reason || meta.reject_reason || null,
      reject_code: meta.response_code || meta.reject_code || null,
      response_reason: meta.response_reason || null,
      response_code: meta.response_code || null,

      // ✅ diagnostics
      errors,
      warnings,
      errors_json: d.errors_json || "{}",
      warnings_json: d.warnings_json || "{}",

      canonical: inv
        ? {
            ...inv,
            seller: seller,
            buyer: buyer,
            totals: totals,
            lines: lines,
          }
        : null,

      payload: undefined,
      direction: "IN",
    };
  });

  /* -------------------------------------------------------
   * Export XML: inbound:exportXml
   * - For XML docs: saves payload as .xml
   * - For PDF docs: tries extract embedded Factur-X XML and saves it
   * ----------------------------------------------------- */

  ipcMain.handle("inbound:exportXml", async (_e, { id } = {}) => {
    if (!id) throw new Error("id requis");

    const d = db().prepare(`SELECT id, filename, format, content_type, payload FROM inbound_documents WHERE id=?`).get(id);
    if (!d) throw new Error("Document introuvable");

    const filename = String(d.filename || "inbound");
    const ext = path.extname(filename).toLowerCase();
    const isPdf = ext === ".pdf" || String(d.content_type || "").toLowerCase().includes("pdf");
    const isXml = ext === ".xml" || String(d.content_type || "").toLowerCase().includes("xml");

    let xml = null;

    if (isXml) {
      xml = Buffer.isBuffer(d.payload) ? d.payload.toString("utf8") : String(d.payload || "");
    } else if (isPdf) {
      const buf = Buffer.isBuffer(d.payload) ? d.payload : Buffer.from(d.payload);
      const extracted = await extractFacturxXmlFromPdf(buf);
      if (!extracted.ok) throw new Error(extracted.error || "Extraction XML échouée");
      if (!extracted.xml) throw new Error("Aucun XML embarqué trouvé dans le PDF");
      xml = extracted.xml;
    } else {
      throw new Error("Export XML non disponible pour ce type de document");
    }

    const win = BrowserWindow.getFocusedWindow();
    const base = path.basename(filename, path.extname(filename));
    const defaultPath = path.join(os.homedir(), "Downloads", `${base || "inbound"}.xml`);

    const save = await dialog.showSaveDialog(win, {
      title: "Exporter XML (UBL/CII)",
      defaultPath,
      filters: [{ name: "XML", extensions: ["xml"] }],
    });

    if (save.canceled || !save.filePath) return { ok: false, canceled: true };

    fs.writeFileSync(save.filePath, xml, "utf8");
    return { ok: true, path: save.filePath };
  });

  /* -------------------------------------------------------
   * Export PDF: inbound:exportPdf
   * - If original doc is PDF: saves payload as-is
   * - If original doc is XML: renders a minimal readable PDF via printToPDF
   * ----------------------------------------------------- */

  ipcMain.handle("inbound:exportPdf", async (_e, { id, locale = "fr" } = {}) => {
    if (!id) throw new Error("id requis");

    const d = db().prepare(`SELECT * FROM inbound_documents WHERE id=?`).get(id);
    if (!d) throw new Error("Document introuvable");

    let inv = null;
    if (sqlTableExists(db(), "inbound_invoices")) {
      inv = db().prepare(`SELECT * FROM inbound_invoices WHERE document_id=?`).get(id) || null;
    }

    const filename = String(d.filename || "inbound");
    const ext = path.extname(filename).toLowerCase();
    const isPdf = ext === ".pdf" || String(d.content_type || "").toLowerCase().includes("pdf");
    const isXml = ext === ".xml" || String(d.content_type || "").toLowerCase().includes("xml");

    const win = BrowserWindow.getFocusedWindow();
    const base = path.basename(filename, path.extname(filename));
    const defaultPath = path.join(os.homedir(), "Downloads", `${base || "inbound"}.pdf`);

    const save = await dialog.showSaveDialog(win, {
      title: "Exporter PDF",
      defaultPath,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (save.canceled || !save.filePath) return { ok: false, canceled: true };

    // Case 1: already a PDF => save bytes
    if (isPdf) {
      const buf = Buffer.isBuffer(d.payload) ? d.payload : Buffer.from(d.payload);
      fs.writeFileSync(save.filePath, buf);
      return { ok: true, path: save.filePath, mode: "copy" };
    }

    // Case 2: XML => render a readable PDF
    if (!isXml) {
      throw new Error("Export PDF lisible disponible uniquement pour PDF ou XML UBL/CII");
    }

    const html = canonicalToHtml({ doc: d, canonical: inv || null, locale });
    const res = await printHtmlToPdfFile({ html, outPath: save.filePath });
    return { ...res, mode: "render" };
  });

  /* -------------------------------------------------------
   * Buyer decisions
   * ----------------------------------------------------- */

  function mergeMetaJsonAndUpdate(documentId, patch) {
    const hasMetaJson = sqlHasColumn(db(), "inbound_documents", "meta_json");
    const col = hasMetaJson ? "meta_json" : sqlHasColumn(db(), "inbound_documents", "meta") ? "meta" : null;

    if (!col) return;

    const row = db().prepare(`SELECT ${col} AS meta FROM inbound_documents WHERE id=?`).get(documentId);
    const cur = safeJsonParse(row?.meta) || {};
    const next = { ...cur, ...(patch || {}) };

    db().prepare(`UPDATE inbound_documents SET ${col}=? WHERE id=?`).run(JSON.stringify(next), documentId);
  }

  ipcMain.handle("inbound:accept", (_e, { id } = {}) => {
    if (!id) throw new Error("id requis");

    mergeMetaJsonAndUpdate(id, {
      response_reason: "Accepted by buyer",
      response_code: "ACCEPTED",
    });

    setDocumentStatus(db(), id, "ACCEPTED");
    return { ok: true };
  });

  ipcMain.handle("inbound:reject", (_e, { id, reason = "", code = "", actor = "" } = {}) => {
  if (!id) throw new Error("id requis");
  const r = String(reason || "").trim();
  if (!r) throw new Error("reason requis");

  const a = String(actor || "").trim().toUpperCase(); // "CREDITOR" | "PLATFORM"
  const actorSafe = a === "CREDITOR" || a === "PLATFORM" ? a : "PLATFORM";

  mergeMetaJsonAndUpdate(id, {
    response_reason: r,
    response_code: String(code || "").trim() || "REJECTED",
    response_actor: actorSafe, // ✅
  });

  setDocumentStatus(db(), id, "REJECTED");
  return { ok: true };
});

  ipcMain.handle("inbound:dispute", (_e, { id, reason = "" } = {}) => {
    if (!id) throw new Error("id requis");

    mergeMetaJsonAndUpdate(id, {
      response_reason: String(reason || "").trim() || "Disputed by buyer",
      response_code: "DISPUTED",
    });

    setDocumentStatus(db(), id, "DISPUTED");
    return { ok: true };
  });

  /* -------------------------------------------------------
   * SFTP polling (optional)
   * ----------------------------------------------------- */

  ipcMain.handle("inbound:sftpStart", async (_e, cfg = {}) => {
    if (sftpTimer) clearInterval(sftpTimer);

    const intervalMs = Number(cfg.intervalMs || 120000);
    const sourceName = cfg.sourceName || "PDP-SFTP";

    async function tick() {
      try {
        await pollSftpOnce({
          host: cfg.host,
          port: cfg.port || 22,
          username: cfg.username,
          password: cfg.password,
          privateKey: cfg.privateKey,
          remoteInbox: cfg.remoteInbox || "/inbox",
          remoteProcessed: cfg.remoteProcessed || "/processed",
          maxFiles: cfg.maxFiles || 50,
          sourceName,
          onFile: async ({ filename, contentType, payload, meta }) => {
            await ingestRaw({
              source_type: "SFTP",
              source_name: sourceName,
              filename,
              contentType,
              payload,
              meta,
            });
          },
        });
      } catch (e) {
        console.error("[inbound:sftp] tick error:", e);
      }
    }

    await tick();
    sftpTimer = setInterval(tick, intervalMs);

    return { ok: true, intervalMs };
  });

  ipcMain.handle("inbound:sftpStop", async () => {
    if (sftpTimer) clearInterval(sftpTimer);
    sftpTimer = null;
    return { ok: true };
  });

  /* -------------------------------------------------------
   * Webhook embedded (optional)
   * ----------------------------------------------------- */

  ipcMain.handle("inbound:webhookStart", async (_e, cfg = {}) => {
    if (webhookServer) return { ok: true, already: true };

    const secret = cfg.secret || "";
    const port = Number(cfg.port || 8787);

    const app = createWebhookServer({
      secret,
      onPayload: async ({ filename, contentType, payload, sourceName, meta }) => {
        return ingestRaw({
          source_type: "WEBHOOK",
          source_name: sourceName || "PDP-WEBHOOK",
          filename,
          contentType,
          payload,
          meta,
        });
      },
    });

    webhookServer = http.createServer(app);
    await new Promise((resolve) => webhookServer.listen(port, resolve));

    return { ok: true, port };
  });

  ipcMain.handle("inbound:webhookStop", async () => {
    if (!webhookServer) return { ok: true };
    await new Promise((resolve) => webhookServer.close(resolve));
    webhookServer = null;
    return { ok: true };
  });
};
