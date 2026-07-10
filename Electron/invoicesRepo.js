// invoicesRepo.js
"use strict";

/**
 * invoicesRepo.js
 * Cohérent avec le schéma SQL réorganisé (001_init.sql + 002_invoice_links.sql)
 * et avec les IPC:
 * - invoices table: (id, quote_id, client_id, type, status, invoice_number, date, due_date, currency, ...)
 * - invoice_lines table: (id, invoice_id, article_id, article_ref, description, quantity, unit_code,
 *                         unit_price_ht, remise_percent, tva_percent, vat_category, vat_exempt_reason,
 *                         vat_exempt_code, item_type, line_type, total_ht, ...)
 * - quote_lines table: (id, quote_id, article_id, article_ref, description, quantity, unit_code,
 *                       unit_price_ht, remise_percent, tva_percent, vat_category, item_type, line_type, total_ht, position, ...)
 *
 * IMPORTANT:
 * - Pas de colonnes legacy (label/qty/discount_pct/tva_pct) -> remplacées par description/quantity/remise_percent/tva_percent.
 * - Numérotation stable: FYYYY-0001 / ACYYYY-0001 / AVYYYY-0001
 */

const { randomUUID } = require("crypto");
const { getDb, nowIso } = require("./db");

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

function computeLineTotals(line) {
  const qty = n(line.quantity, 1);
  const unit = n(line.unit_price_ht, 0);
  const discount = n(line.remise_percent, 0);

  const base = qty * unit;
  const net = base * (1 - discount / 100);
  const ht = round2(net);
  const tva = round2(ht * (n(line.tva_percent, 0) / 100));
  return { ht, tva };
}

function computeInvoiceTotals(db, invoiceId) {
  const lines = db
    .prepare(
      `
      SELECT
        quantity, unit_price_ht, remise_percent, tva_percent
      FROM invoice_lines
      WHERE invoice_id = ?
    `
    )
    .all(invoiceId);

  let totalHt = 0;
  let totalTva = 0;

  for (const l of lines) {
    const t = computeLineTotals(l);
    totalHt += t.ht;
    totalTva += t.tva;
  }

  totalHt = round2(totalHt);
  totalTva = round2(totalTva);
  const totalTtc = round2(totalHt + totalTva);

  db.prepare(
    `
    UPDATE invoices
    SET total_ht = ?, total_tva = ?, total_ttc = ?, updated_at = ?
    WHERE id = ?
  `
  ).run(totalHt, totalTva, totalTtc, nowIso(), invoiceId);

  return { total_ht: totalHt, total_tva: totalTva, total_ttc: totalTtc };
}

function nextInvoiceNumber(db, type) {
  const year = new Date().getFullYear();

  // Aligné avec invoices.ipc.js (F / AC / AV)
  const prefix =
    type === "credit_note"
      ? `AV${year}-`
      : type === "deposit"
      ? `AC${year}-`
      : `F${year}-`;

  const last = db
    .prepare(
      `
      SELECT invoice_number
      FROM invoices
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

function ensureDraft(db, invoiceId) {
  const row = db.prepare("SELECT status FROM invoices WHERE id = ?").get(invoiceId);
  if (!row) throw new Error("Facture introuvable");
  if (row.status !== "draft") throw new Error("Opération autorisée uniquement sur un brouillon");
}

/**
 * Crée une facture brouillon à partir d'un devis (quotes + quote_lines).
 * Copie les lignes du devis vers invoice_lines.
 */
function createInvoiceFromQuote({ quoteId }) {
  const db = getDb();
  const invoiceId = randomUUID();
  const ts = nowIso();
  const docDate = ts.slice(0, 10);

  const quote = db.prepare("SELECT id, client_id, currency FROM quotes WHERE id = ?").get(quoteId);
  if (!quote) throw new Error("Devis introuvable");

  const quoteLines = db
    .prepare(
      `
      SELECT
        article_id, article_ref, description,
        quantity, unit_code, unit_price_ht, remise_percent,
        tva_percent, vat_category, vat_exempt_reason, vat_exempt_code,
        item_type, line_type
      FROM quote_lines
      WHERE quote_id = ?
      ORDER BY rowid ASC
    `
    )
    .all(quoteId);

  const tx = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO invoices (
        id, quote_id, client_id, type, status,
        date, currency, notes,
        use_case_code, use_case_meta_json, meta_json,
        total_ht, total_tva, total_ttc,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, 'final', 'draft',
        ?, ?, NULL,
        NULL, '{}', '{}',
        0, 0, 0,
        ?, ?
      )
    `
    ).run(invoiceId, quoteId, quote.client_id || null, docDate, s(quote.currency, "EUR"), ts, ts);

    const insertLine = db.prepare(
      `
      INSERT INTO invoice_lines (
        id, invoice_id,
        article_id, article_ref, description,
        quantity, unit_code, unit_price_ht, remise_percent,
        tva_percent, vat_category, vat_exempt_reason, vat_exempt_code,
        item_type, line_type,
        total_ht,
        created_at, updated_at
      ) VALUES (
        @id, @invoice_id,
        @article_id, @article_ref, @description,
        @quantity, @unit_code, @unit_price_ht, @remise_percent,
        @tva_percent, @vat_category, @vat_exempt_reason, @vat_exempt_code,
        @item_type, @line_type,
        @total_ht,
        @created_at, @updated_at
      )
    `
    );

    for (const ql of quoteLines) {
      const t = computeLineTotals(ql);

      insertLine.run({
        id: randomUUID(),
        invoice_id: invoiceId,

        article_id: s(ql.article_id) || null,
        article_ref: s(ql.article_ref),
        description: s(ql.description),

        quantity: n(ql.quantity, 1),
        unit_code: s(ql.unit_code, "C62") || "C62",
        unit_price_ht: n(ql.unit_price_ht, 0),
        remise_percent: n(ql.remise_percent, 0),

        tva_percent: n(ql.tva_percent, 0),
        vat_category: s(ql.vat_category || (n(ql.tva_percent, 0) === 0 ? "Z" : "S")).toUpperCase(),
        vat_exempt_reason: s(ql.vat_exempt_reason),
        vat_exempt_code: s(ql.vat_exempt_code),

        item_type: s(ql.item_type || "SERVICE").toUpperCase() === "GOODS" ? "GOODS" : "SERVICE",
        line_type: s(ql.line_type || "standard"),

        total_ht: t.ht,
        created_at: ts,
        updated_at: ts,
      });
    }

    computeInvoiceTotals(db, invoiceId);
  });

  tx();
  return invoiceId;
}

/**
 * Crée une facture d'acompte (draft) liée au devis.
 * Ligne unique (adjustment) avec TVA 0 par défaut (à adapter selon règles métier).
 * IMPORTANT: pour EN16931, l'acompte est une facture (Invoice) avec sa TVA propre.
 */
function createDepositInvoice({ quoteId, mode, value }) {
  const db = getDb();
  const invoiceId = randomUUID();
  const ts = nowIso();
  const docDate = ts.slice(0, 10);

  const quote = db.prepare("SELECT id, client_id, currency, total_ttc, number FROM quotes WHERE id = ?").get(quoteId);
  if (!quote) throw new Error("Devis introuvable");

  let amount = 0;
  if (mode === "percent") amount = (n(quote.total_ttc, 0) * n(value, 0)) / 100;
  if (mode === "amount") amount = n(value, 0);
  amount = round2(Math.max(0, amount));

  const tx = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO invoices (
        id, quote_id, client_id, type, status,
        date, currency, notes,
        use_case_code, use_case_meta_json, meta_json,
        total_ht, total_tva, total_ttc,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, 'deposit', 'draft',
        ?, ?, ?,
        NULL, '{}', '{}',
        0, 0, 0,
        ?, ?
      )
    `
    ).run(
      invoiceId,
      quoteId,
      quote.client_id || null,
      docDate,
      s(quote.currency, "EUR"),
      "Facture d'acompte",
      ts,
      ts
    );

    const desc = quote.number ? `Acompte sur devis ${quote.number}` : `Acompte sur devis ${quoteId}`;

    const line = {
      id: randomUUID(),
      invoice_id: invoiceId,
      article_id: null,
      article_ref: null,
      description: desc,
      quantity: 1,
      unit_code: "C62",
      unit_price_ht: amount,
      remise_percent: 0,
      tva_percent: 0,
      vat_category: "Z",
      vat_exempt_reason: null,
      vat_exempt_code: null,
      item_type: "SERVICE",
      line_type: "adjustment",
      created_at: ts,
      updated_at: ts,
    };

    const t = computeLineTotals(line);
    line.total_ht = t.ht;

    db.prepare(
      `
      INSERT INTO invoice_lines (
        id, invoice_id,
        article_id, article_ref, description,
        quantity, unit_code, unit_price_ht, remise_percent,
        tva_percent, vat_category, vat_exempt_reason, vat_exempt_code,
        item_type, line_type,
        total_ht,
        created_at, updated_at
      ) VALUES (
        @id, @invoice_id,
        @article_id, @article_ref, @description,
        @quantity, @unit_code, @unit_price_ht, @remise_percent,
        @tva_percent, @vat_category, @vat_exempt_reason, @vat_exempt_code,
        @item_type, @line_type,
        @total_ht,
        @created_at, @updated_at
      )
    `
    ).run(line);

    computeInvoiceTotals(db, invoiceId);
  });

  tx();
  return invoiceId;
}

/**
 * Crée un avoir (draft) lié à une facture émise (issued).
 * Par défaut: lignes négatives de toutes les lignes de la facture d'origine.
 * Crée aussi un lien invoice_links (credit_of).
 */
function createCreditNote({ invoiceId: originalId }) {
  const db = getDb();
  const creditId = randomUUID();
  const ts = nowIso();
  const docDate = ts.slice(0, 10);

  const original = db
    .prepare("SELECT id, client_id, status, currency, invoice_number FROM invoices WHERE id = ?")
    .get(originalId);

  if (!original) throw new Error("Facture d'origine introuvable");
  if (original.status !== "issued") throw new Error("Créer un avoir sur une facture émise");

  const origLines = db
    .prepare(
      `
      SELECT
        article_id, article_ref, description,
        quantity, unit_code, unit_price_ht, remise_percent,
        tva_percent, vat_category, vat_exempt_reason, vat_exempt_code,
        item_type
      FROM invoice_lines
      WHERE invoice_id = ?
      ORDER BY rowid
    `
    )
    .all(originalId);

  const tx = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO invoices (
        id, quote_id, client_id, type, status,
        date, currency, notes,
        source_invoice_id,
        use_case_code, use_case_meta_json, meta_json,
        total_ht, total_tva, total_ttc,
        created_at, updated_at
      ) VALUES (
        ?, NULL, ?, 'credit_note', 'draft',
        ?, ?, ?,
        ?,
        NULL, '{}', '{}',
        0, 0, 0,
        ?, ?
      )
    `
    ).run(
      creditId,
      original.client_id || null,
      docDate,
      s(original.currency, "EUR"),
      original.invoice_number ? `Avoir sur facture ${original.invoice_number}` : `Avoir sur facture ${originalId}`,
      originalId,
      ts,
      ts
    );

    const insertLine = db.prepare(
      `
      INSERT INTO invoice_lines (
        id, invoice_id,
        article_id, article_ref, description,
        quantity, unit_code, unit_price_ht, remise_percent,
        tva_percent, vat_category, vat_exempt_reason, vat_exempt_code,
        item_type, line_type,
        total_ht,
        created_at, updated_at
      ) VALUES (
        @id, @invoice_id,
        @article_id, @article_ref, @description,
        @quantity, @unit_code, @unit_price_ht, @remise_percent,
        @tva_percent, @vat_category, @vat_exempt_reason, @vat_exempt_code,
        @item_type, @line_type,
        @total_ht,
        @created_at, @updated_at
      )
    `
    );

    for (const l of origLines) {
      const negQty = -Math.abs(n(l.quantity, 0));

      const line = {
        id: randomUUID(),
        invoice_id: creditId,

        article_id: s(l.article_id) || null,
        article_ref: s(l.article_ref),
        description: `AVOIR - ${s(l.description)}`,

        quantity: negQty,
        unit_code: s(l.unit_code, "C62") || "C62",
        unit_price_ht: n(l.unit_price_ht, 0),
        remise_percent: n(l.remise_percent, 0),

        tva_percent: n(l.tva_percent, 0),
        vat_category: s(l.vat_category || (n(l.tva_percent, 0) === 0 ? "Z" : "S")).toUpperCase(),
        vat_exempt_reason: s(l.vat_exempt_reason),
        vat_exempt_code: s(l.vat_exempt_code),

        item_type: s(l.item_type || "SERVICE").toUpperCase() === "GOODS" ? "GOODS" : "SERVICE",
        line_type: "adjustment",

        created_at: ts,
        updated_at: ts,
      };

      const t = computeLineTotals(line);
      line.total_ht = t.ht;

      insertLine.run(line);
    }

    // lien credit_of (si la table existe)
    try {
      db.prepare(
        `
        INSERT INTO invoice_links (id, from_invoice_id, to_invoice_id, link_type, created_at)
        VALUES (?, ?, ?, 'credit_of', ?)
      `
      ).run(randomUUID(), creditId, originalId, ts);
    } catch {
      // ignore
    }

    computeInvoiceTotals(db, creditId);
  });

  tx();
  return creditId;
}

/**
 * Émission : numérotation + verrouillage (draft -> issued).
 * Retourne le numéro attribué.
 */
function issueInvoice({ id }) {
  const db = getDb();

  const inv = db.prepare("SELECT id, status, type FROM invoices WHERE id = ?").get(id);
  if (!inv) throw new Error("Facture introuvable");
  if (inv.status !== "draft") throw new Error("Seules les factures en brouillon peuvent être émises");

  // Totaux recalculés juste avant émission (sécurité)
  computeInvoiceTotals(db, id);

  const number = nextInvoiceNumber(db, inv.type || "final");
  const ts = nowIso();

  db.prepare(
    `
    UPDATE invoices
    SET invoice_number = ?,
        status = 'issued',
        updated_at = ?
    WHERE id = ?
  `
  ).run(number, ts, id);

  return number;
}

/**
 * Helpers CRUD minimal (si utile côté renderer)
 */
function getInvoice(db, id) {
  const inv = db.prepare("SELECT * FROM invoices WHERE id = ?").get(id);
  if (!inv) return null;
  const lines = db
    .prepare("SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY rowid")
    .all(id);
  return { invoice: inv, lines };
}

function deleteDraftInvoice({ id }) {
  const db = getDb();
  ensureDraft(db, id);

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM invoice_lines WHERE invoice_id = ?").run(id);
    try {
      db.prepare("DELETE FROM invoice_links WHERE from_invoice_id = ? OR to_invoice_id = ?").run(id, id);
    } catch {
      // ignore
    }
    db.prepare("DELETE FROM invoices WHERE id = ?").run(id);
  });

  tx();
  return { ok: true };
}

module.exports = {
  createInvoiceFromQuote,
  createDepositInvoice,
  createCreditNote,
  issueInvoice,
  computeInvoiceTotals,
  getInvoice,
  deleteDraftInvoice,
};
