"use strict";

const fs = require("node:fs/promises");
const fssync = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { dialog, BrowserWindow, app } = require("electron");

const { exportQuotePdf, exportInvoicePdf } = require("../pdf/pdf.js");

// ---- AUDIT (append-only log + hash chain + HMAC + TSA) ----
const { appendAuditEvent } = require("../audit/audit.js");
const TSA_URL = "https://freetsa.org/tsr";

// -------------------- helpers --------------------
function safeFilename(x) {
  return String(x || "document").replace(/[^\w.-]+/g, "_");
}

function ensureDirSync(dir) {
  try {
    fssync.mkdirSync(dir, { recursive: true });
  } catch {}
}

function tmpDir() {
  const base = app?.getPath ? app.getPath("userData") : os.tmpdir();
  const d = path.join(base, "tmp");
  ensureDirSync(d);
  return d;
}

function getAuditLogPathLocal() {
  const base = app?.getPath ? app.getPath("userData") : os.tmpdir();
  const dir = path.join(base, "audit");
  ensureDirSync(dir);
  return path.join(dir, "audit.log.jsonl");
}

async function writeTempLogoFileFromBlob({ blob, mime, name }) {
  const ext =
    (name && path.extname(name)) ||
    (String(mime || "").includes("png") ? ".png" : String(mime || "").includes("jpeg") ? ".jpg" : ".img");

  const file = path.join(tmpDir(), `logo_${crypto.randomBytes(8).toString("hex")}${ext}`);
  await fs.writeFile(file, Buffer.from(blob));
  return file;
}

async function pickSavePath(win, suggestedName) {
  const res = await dialog.showSaveDialog(win, {
    title: "Exporter en PDF",
    defaultPath: path.join(process.cwd(), suggestedName),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  return res.canceled ? null : res.filePath;
}

// Remplace un handler existant (évite "second handler")
function handleReplace(ipcMain, channel, fn) {
  if (typeof ipcMain.removeHandler === "function") {
    try {
      ipcMain.removeHandler(channel);
    } catch {}
  }
  ipcMain.handle(channel, fn);
}

// -------------------- DB access --------------------
function dbGetCompany(db) {
  return db.prepare("SELECT * FROM company WHERE id=1").get() || null;
}

function dbGetCompanyLogoBlob(db) {
  // company.ipc.js stocke logo_blob/logo_mime/logo_name
  return db.prepare("SELECT logo_blob, logo_mime, logo_name FROM company WHERE id=1").get() || null;
}

function dbGetClient(db, id) {
  if (!id) return null;
  return db.prepare("SELECT * FROM clients WHERE id = ?").get(id) || null;
}

function dbGetQuoteFull(db, quoteId) {
  const quote = db.prepare("SELECT * FROM quotes WHERE id = ?").get(quoteId);
  if (!quote) return null;

  const buyer = dbGetClient(db, quote.client_id);

  const lines = db
    .prepare(
      `
      SELECT
        description,
        quantity,
        unit_price_ht,
        tva_percent,
        unit_code,
        remise_percent,
        item_type,
        vat_category,
        vat_exempt_reason,
        vat_exempt_code
      FROM quote_lines
      WHERE quote_id = ?
      ORDER BY rowid ASC
      `
    )
    .all(quoteId);

  return { quote, buyer, lines };
}

function dbGetInvoiceFull(db, invoiceId) {
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId);
  if (!invoice) return null;

  const buyer = dbGetClient(db, invoice.client_id);

  const lines = db
    .prepare(
      `
      SELECT
        description,
        quantity,
        unit_price_ht,
        tva_percent,
        unit_code,
        remise_percent,
        item_type,
        vat_category,
        vat_exempt_reason,
        vat_exempt_code
      FROM invoice_lines
      WHERE invoice_id = ?
      ORDER BY rowid ASC
      `
    )
    .all(invoiceId);

  // ✅ Liste des acomptes (uniquement pour facture finale)
  let deposits = [];
  try {
    if (String(invoice.type) === "final" && invoice.quote_id) {
      deposits = db
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
        .all(invoice.quote_id);
    }
  } catch {
    deposits = [];
  }

  return { invoice, buyer, lines, deposits };
}

// -------------------- logo support (path OR blob) --------------------
async function ensureCompanyLogoPath(db, company) {
  if (!company) return company;

  // 1) legacy path
  if (company.logo_path && String(company.logo_path).trim()) return company;

  // 2) blob in DB
  const row = dbGetCompanyLogoBlob(db);
  if (!row?.logo_blob) return company;

  try {
    const logoPath = await writeTempLogoFileFromBlob({
      blob: row.logo_blob,
      mime: row.logo_mime || "image/png",
      name: row.logo_name || "logo.png",
    });
    return { ...company, logo_path: logoPath };
  } catch {
    return company;
  }
}

// -------------------- IPC registration --------------------
module.exports = function registerPdfIpc(ipcMain, getDbFn) {
  handleReplace(ipcMain, "quotes:exportPdf", async (event, payload = {}) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);

      const quoteId = payload.quoteId || payload.id;
      const locale = payload.locale || "fr";
      const config = payload.config || {};

      if (!quoteId) return { ok: false, error: "quoteId manquant" };

      const db = getDbFn();

      let company = dbGetCompany(db);
      if (!company) return { ok: false, error: "Société introuvable (table company)" };
      company = await ensureCompanyLogoPath(db, company);

      const full = dbGetQuoteFull(db, quoteId);
      if (!full?.quote) return { ok: false, error: "Devis introuvable" };
      if (!full?.buyer) return { ok: false, error: "Client introuvable pour ce devis" };

      const number = full.quote.number || full.quote.id;
      const outPath = await pickSavePath(win, `devis-${safeFilename(number)}.pdf`);
      if (!outPath) return { ok: false, canceled: true };

      const pdfBuffer = await exportQuotePdf({
        seller: company,
        buyer: full.buyer,
        quote: { ...full.quote, number },
        lines: full.lines,
        locale,
        config,
      });

      await fs.writeFile(outPath, pdfBuffer);

      // 🔐 AUDIT — après succès uniquement (write OK)
      try {
        const pdfSha256 = crypto.createHash("sha256").update(pdfBuffer).digest("hex");

        appendAuditEvent({
          logPath: getAuditLogPathLocal(),
          hmacSecret: process.env.AUDIT_HMAC_SECRET,
          tsaUrl: TSA_URL,
          actor: payload?.user || "system",
          action: "quote.pdf_export",
          entityType: "quote",
          entityId: String(quoteId),
          payload: {
            number,
            file: path.basename(outPath),
            bytes: pdfBuffer.length,
            pdf_sha256: pdfSha256,
          },
        });
      } catch (err) {
        console.error("[AUDIT] failed:", err?.message || err);
      }

      return { ok: true, path: outPath };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  handleReplace(ipcMain, "invoices:exportPdf", async (event, payload = {}) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);

      const invoiceId = payload.invoiceId || payload.id;
      const locale = payload.locale || "fr";
      const config = payload.config || {};

      if (!invoiceId) return { ok: false, error: "invoiceId manquant" };

      const db = getDbFn();

      let company = dbGetCompany(db);
      if (!company) return { ok: false, error: "Société introuvable (table company)" };
      company = await ensureCompanyLogoPath(db, company);

      const full = dbGetInvoiceFull(db, invoiceId);
      if (!full?.invoice) return { ok: false, error: "Facture introuvable" };
      if (!full?.buyer) return { ok: false, error: "Client introuvable pour cette facture" };

      const number = full.invoice.invoice_number || full.invoice.number || full.invoice.id;
      const outPath = await pickSavePath(win, `facture-${safeFilename(number)}.pdf`);
      if (!outPath) return { ok: false, canceled: true };

      const pdfBuffer = await exportInvoicePdf({
        seller: company,
        buyer: full.buyer,
        invoice: { ...full.invoice, invoice_number: number },
        lines: full.lines,
        deposits: full.deposits || [], // ✅ important
        locale,
        config,
      });

      await fs.writeFile(outPath, pdfBuffer);

      // 🔐 AUDIT — après succès uniquement (write OK)
      try {
        const pdfSha256 = crypto.createHash("sha256").update(pdfBuffer).digest("hex");

        appendAuditEvent({
          logPath: getAuditLogPathLocal(),
          hmacSecret: process.env.AUDIT_HMAC_SECRET,
          tsaUrl: TSA_URL,
          actor: payload?.user || "system",
          action: "invoice.pdf_export",
          entityType: "invoice",
          entityId: String(invoiceId),
          payload: {
            number,
            file: path.basename(outPath),
            bytes: pdfBuffer.length,
            pdf_sha256: pdfSha256,
          },
        });
      } catch (err) {
        console.error("[AUDIT] failed:", err?.message || err);
      }

      return { ok: true, path: outPath };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });
};
