"use strict";

const crypto = require("crypto");
const { randomUUID } = require("crypto");

function nowIso() {
  return new Date().toISOString();
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function toJson(v) {
  try {
    return typeof v === "string" ? v : JSON.stringify(v ?? {});
  } catch {
    return "{}";
  }
}

function insertEvent(db, documentId, type, payload) {
  db.prepare(
    `INSERT INTO inbound_events (id, document_id, at, type, payload_json)
     VALUES (?, ?, ?, ?, ?)`
  ).run(randomUUID(), documentId, nowIso(), type, toJson(payload));
}

function insertDocument(db, { source_type, source_name, content_type, filename, format, payload, meta }) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload || ""), "utf8");
  const h = sha256(buf);
  const id = randomUUID();
  const received_at = nowIso();

  // idempotence: same source+sha => ignore
  const exists = db
    .prepare(
      `SELECT id FROM inbound_documents
       WHERE source_type=? AND source_name=? AND sha256=? LIMIT 1`
    )
    .get(source_type, source_name, h);

  if (exists?.id) {
    insertEvent(db, exists.id, "DUPLICATE_IGNORED", { filename });
    return { ok: true, id: exists.id, duplicate: true };
  }

  db.prepare(
    `INSERT INTO inbound_documents (
      id, source_type, source_name, received_at, format, content_type,
      filename, sha256, status, payload, meta_json, errors_json, warnings_json
    ) VALUES (
      @id, @source_type, @source_name, @received_at, @format, @content_type,
      @filename, @sha256, 'RECEIVED', @payload, @meta_json, '', ''
    )`
  ).run({
    id,
    source_type,
    source_name,
    received_at,
    format: format || "UNKNOWN",
    content_type: content_type || "",
    filename: filename || "",
    sha256: h,
    payload: buf,
    meta_json: toJson(meta || {}),
  });

  insertEvent(db, id, "RECEIVED", { source_type, source_name, filename, format });

  return { ok: true, id, sha256: h, duplicate: false };
}

function setDocumentStatus(db, id, status, { errors, warnings } = {}) {
  db.prepare(
    `UPDATE inbound_documents
     SET status=?, errors_json=?, warnings_json=?
     WHERE id=?`
  ).run(status, toJson(errors || {}), toJson(warnings || {}), id);

  insertEvent(db, id, status, { errors: errors || null, warnings: warnings || null });
}

function upsertCanonicalInvoice(db, documentId, canonical) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO inbound_invoices (
      id, document_id, invoice_number, issue_date, currency,
      seller_json, buyer_json, totals_json, lines_json, created_at
    ) VALUES (
      @id, @document_id, @invoice_number, @issue_date, @currency,
      @seller_json, @buyer_json, @totals_json, @lines_json, @created_at
    )
    ON CONFLICT(document_id) DO UPDATE SET
      invoice_number=excluded.invoice_number,
      issue_date=excluded.issue_date,
      currency=excluded.currency,
      seller_json=excluded.seller_json,
      buyer_json=excluded.buyer_json,
      totals_json=excluded.totals_json,
      lines_json=excluded.lines_json`
  ).run({
    id,
    document_id: documentId,
    invoice_number: canonical.invoice_number || "",
    issue_date: canonical.issue_date || "",
    currency: canonical.currency || "EUR",
    seller_json: toJson(canonical.seller || {}),
    buyer_json: toJson(canonical.buyer || {}),
    totals_json: toJson(canonical.totals || {}),
    lines_json: toJson(canonical.lines || []),
    created_at: nowIso(),
  });

  insertEvent(db, documentId, "CANONICAL_UPSERTED", {
    invoice_number: canonical.invoice_number,
    issue_date: canonical.issue_date,
  });
}

module.exports = {
  nowIso,
  insertDocument,
  setDocumentStatus,
  upsertCanonicalInvoice,
  insertEvent,
};
