"use strict";

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow } = require("electron");

const { appendAuditEvent } = require("../audit/audit");

let getAuditLogPathFn = null;
try {
  ({ getAuditLogPath: getAuditLogPathFn } = require("../audit/audit"));
} catch (_e1) {
  try {
    ({ getAuditLogPath: getAuditLogPathFn } = require("../audit/audit-config"));
  } catch (_e2) {
    getAuditLogPathFn = null;
  }
}

function getAuditLogPathSafe() {
  try {
    if (typeof getAuditLogPathFn === "function") return getAuditLogPathFn(app);
  } catch {}
  return null;
}

let nowIso = null;
try {
  ({ nowIso } = require("../db"));
} catch (_e) {
  nowIso = () => new Date().toISOString();
}

function s(v, def = "") {
  return String(v ?? def).trim();
}

function upper2(v, def = "") {
  const x = s(v, def);
  return x ? x.toUpperCase() : x;
}

function n(v, def = NaN) {
  const x = Number(v);
  return Number.isFinite(x) ? x : def;
}

function jsonStringifySafe(x) {
  try {
    return JSON.stringify(x ?? {});
  } catch {
    return "{}";
  }
}

function jsonParseSafe(str, fallback = {}) {
  try {
    if (!str) return fallback;
    return typeof str === "string" ? JSON.parse(str) : str;
  } catch {
    return fallback;
  }
}

function mergeInboundIntoUseCaseMeta(useCaseMetaJson, inboundPatch) {
  const meta = jsonParseSafe(useCaseMetaJson, {});
  meta.inbound = { ...(meta.inbound || {}), ...(inboundPatch || {}) };
  return jsonStringifySafe(meta);
}

function mergeConformityIntoUseCaseMeta(useCaseMetaJson, conformityPatch) {
  const meta = jsonParseSafe(useCaseMetaJson, {});
  meta.conformity = { ...(meta.conformity || {}), ...(conformityPatch || {}) };
  return jsonStringifySafe(meta);
}

function tableHasColumn(db, table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r && r.name === col);
}

function ensureColumn(db, table, col, ddlFragment) {
  if (!tableHasColumn(db, table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddlFragment};`);
}

function ensureCompanyRow(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS company (
      id INTEGER PRIMARY KEY CHECK (id = 1),

      legal_name TEXT,
      country TEXT DEFAULT 'FR',
      currency TEXT DEFAULT 'EUR',
      vat_id TEXT,
      legal_id TEXT,

      street TEXT,
      street2 TEXT,
      postal_code TEXT,
      city TEXT,
      state TEXT,

      email TEXT,
      phone TEXT,
      smtp_host TEXT,
      smtp_port INTEGER,
      smtp_user TEXT,
      smtp_password TEXT,
      smtp_from_name TEXT,

      iban TEXT,
      bic TEXT,

      bank_name TEXT,
      bank_holder TEXT,
      bank_extra TEXT,
      cgv_text TEXT,
      show_logo INTEGER NOT NULL DEFAULT 1,

      endpoint_id TEXT,
      endpoint_scheme TEXT,

      tax_regime TEXT DEFAULT 'STANDARD',
      vat_country_prefix TEXT DEFAULT 'FR',
      vat_regime TEXT DEFAULT 'REAL_NORMAL_MONTHLY',
      payment_terms TEXT,

      seller_registration_name TEXT,
      seller_trade_name TEXT,

      use_case_code TEXT,
      use_case_meta_json TEXT NOT NULL DEFAULT '{}',

      meta_json TEXT NOT NULL DEFAULT '{}',

      logo_path TEXT,

      logo_blob BLOB,
      logo_mime TEXT,
      logo_name TEXT,
      logo_updated_at TEXT,

      created_at TEXT,
      updated_at TEXT
    );
  `);

  ensureColumn(db, "company", "endpoint_id", "endpoint_id TEXT");
  ensureColumn(db, "company", "endpoint_scheme", "endpoint_scheme TEXT");
  ensureColumn(db, "company", "tax_regime", "tax_regime TEXT DEFAULT 'STANDARD'");
  ensureColumn(db, "company", "vat_country_prefix", "vat_country_prefix TEXT DEFAULT 'FR'");
  ensureColumn(db, "company", "vat_regime", "vat_regime TEXT DEFAULT 'REAL_NORMAL_MONTHLY'");
  ensureColumn(db, "company", "payment_terms", "payment_terms TEXT");
  ensureColumn(db, "company", "smtp_host", "smtp_host TEXT");
  ensureColumn(db, "company", "smtp_port", "smtp_port INTEGER");
  ensureColumn(db, "company", "smtp_user", "smtp_user TEXT");
  ensureColumn(db, "company", "smtp_password", "smtp_password TEXT");
  ensureColumn(db, "company", "smtp_from_name", "smtp_from_name TEXT");

  ensureColumn(db, "company", "cgv_text", "cgv_text TEXT");
  ensureColumn(db, "company", "bank_name", "bank_name TEXT");
  ensureColumn(db, "company", "bank_holder", "bank_holder TEXT");
  ensureColumn(db, "company", "bank_extra", "bank_extra TEXT");
  ensureColumn(db, "company", "show_logo", "show_logo INTEGER NOT NULL DEFAULT 1");

  ensureColumn(db, "company", "seller_registration_name", "seller_registration_name TEXT");
  ensureColumn(db, "company", "seller_trade_name", "seller_trade_name TEXT");

  ensureColumn(db, "company", "use_case_code", "use_case_code TEXT");
  ensureColumn(db, "company", "use_case_meta_json", "use_case_meta_json TEXT NOT NULL DEFAULT '{}'");

  ensureColumn(db, "company", "meta_json", "meta_json TEXT NOT NULL DEFAULT '{}'");

  const exists = db.prepare("SELECT 1 FROM company WHERE id=1").get();
  if (!exists) {
    const t = nowIso();
    db.prepare("INSERT INTO company (id, created_at, updated_at) VALUES (1, ?, ?)").run(t, t);
  }
}

function base64ToBuffer(b64) {
  const clean = String(b64 || "").trim();
  if (!clean) return null;
  return Buffer.from(clean, "base64");
}

function bufferToBase64(buf) {
  if (!buf) return null;
  return Buffer.from(buf).toString("base64");
}

function detectMimeFromPath(p) {
  const ext = String(p || "").toLowerCase();
  if (ext.endsWith(".png")) return "image/png";
  if (ext.endsWith(".webp")) return "image/webp";
  if (ext.endsWith(".jpg") || ext.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function validateLogoBuffer(buf, mime) {
  if (!buf || buf.length === 0) throw new Error("Logo vide.");
  if (buf.length > 3 * 1024 * 1024) throw new Error("Logo trop volumineux (max 3MB).");
  const m = s(mime).toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(m)) throw new Error("Format logo non supporté (jpeg/png/webp).");
  return m;
}

function getCurrentMeta(db) {
  try {
    const row = db.prepare("SELECT meta_json FROM company WHERE id=1").get();
    return jsonParseSafe(row?.meta_json, {});
  } catch {
    return {};
  }
}

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
}

function applyAnnualTargetPatch(meta, payload) {
  const out = { ...(meta || {}) };

  if ("annual_target_ht" in payload) {
    const v = n(payload.annual_target_ht);
    if (Number.isFinite(v) && v > 0) out.annual_target_ht = v;
    else delete out.annual_target_ht;
  }

  if ("annual_target_ttc" in payload) {
    const v = n(payload.annual_target_ttc);
    if (Number.isFinite(v) && v > 0) out.annual_target_ttc = v;
    else delete out.annual_target_ttc;
  }

  return out;
}

function buildCompanyRow(db, payload = {}) {
  const t = nowIso();

  const country = upper2(payload.country || "FR", "FR");
  const currency = upper2(payload.currency || "EUR", "EUR");

  const useCaseMetaJson =
    payload.use_case_meta_json != null
      ? s(payload.use_case_meta_json)
      : payload.use_case_meta != null
        ? jsonStringifySafe(payload.use_case_meta)
        : undefined;

  const currentMeta = getCurrentMeta(db);

  let metaProvided = false;
  let mergedMeta = currentMeta;

  if (payload.meta_json != null) {
    const incoming = jsonParseSafe(payload.meta_json, {});
    mergedMeta = { ...mergedMeta, ...(incoming || {}) };
    metaProvided = true;
  }

  if ("annual_target_ht" in payload || "annual_target_ttc" in payload) {
    mergedMeta = applyAnnualTargetPatch(mergedMeta, payload);
    metaProvided = true;
  }

  const showLogoProvided = "show_logo" in payload;
  const row = {
    legal_name: s(payload.legal_name),
    country,
    currency,
    vat_id: s(payload.vat_id),
    legal_id: s(payload.legal_id),
    vat_regime: s(payload.vat_regime || "REAL_NORMAL_MONTHLY"),

    street: s(payload.street),
    street2: s(payload.street2),
    postal_code: s(payload.postal_code),
    city: s(payload.city),
    state: s(payload.state),

    email: s(payload.email),
    phone: s(payload.phone),
    smtp_host: s(payload.smtp_host),
    smtp_port: n(payload.smtp_port, 587),
    smtp_user: s(payload.smtp_user),
    smtp_password: s(payload.smtp_password),
    smtp_from_name: s(payload.smtp_from_name),

    iban: s(payload.iban),
    bic: s(payload.bic),

    bank_name: s(payload.bank_name),
    bank_holder: s(payload.bank_holder),
    bank_extra: s(payload.bank_extra),

    cgv_text: "cgv_text" in payload ? s(payload.cgv_text || "") : undefined,
    show_logo: showLogoProvided ? (payload.show_logo ? 1 : 0) : undefined,

    endpoint_id: s(payload.endpoint_id),
    endpoint_scheme: s(payload.endpoint_scheme),

    tax_regime: s(payload.tax_regime || "STANDARD"),
    vat_country_prefix: upper2(payload.vat_country_prefix || country || "FR", "FR"),
    payment_terms: "payment_terms" in payload ? s(payload.payment_terms || "") : undefined,

    seller_registration_name: s(payload.seller_registration_name),
    seller_trade_name: s(payload.seller_trade_name),

    use_case_code: s(payload.use_case_code),

    use_case_meta_json: useCaseMetaJson,
    meta_json: metaProvided ? jsonStringifySafe(mergedMeta) : undefined,

    updated_at: t,
  };

  if (!row.legal_name) throw new Error("Raison sociale obligatoire.");
  if (!row.country || row.country.length !== 2) throw new Error("Pays vendeur obligatoire (ISO 2 lettres).");

  return row;
}

function setLogoBlobInternal(db, { bytesBase64, mime, name }) {
  ensureCompanyRow(db);
  const t = nowIso();
  const buf = base64ToBuffer(bytesBase64);
  const m = validateLogoBuffer(buf, mime);

  db.prepare(
    `
    UPDATE company
    SET logo_blob=?,
        logo_mime=?,
        logo_name=?,
        logo_updated_at=?,
        updated_at=?
    WHERE id=1
    `
  ).run(buf, m, s(name), t, t);

  return { ok: true };
}

function selectCompany(db) {
  return (
    db
      .prepare(
        `
        SELECT
          id, legal_name, country, currency, vat_id, legal_id,
          street, street2, postal_code, city, state,
          email, phone,
          smtp_host,
          smtp_port,
          smtp_user,
          smtp_password,
          smtp_from_name,

          iban, bic,
          bank_name, bank_holder, bank_extra,
          cgv_text, show_logo,

          endpoint_id, endpoint_scheme,
          tax_regime, vat_country_prefix, vat_regime, payment_terms,
          seller_registration_name, seller_trade_name,
          use_case_code, use_case_meta_json,
          meta_json,

          logo_path,
          logo_mime, logo_name, logo_updated_at,
          created_at, updated_at
        FROM company WHERE id=1
        `
      )
      .get() || null
  );
}

module.exports = (ipcMain, getDb) => {
  const db = () => getDb();

  ipcMain.handle("company:get", () => {
    ensureCompanyRow(db());
    return selectCompany(db());
  });

  ipcMain.handle("company:save", (_e, payload = {}) => {
    ensureCompanyRow(db());

    const row = buildCompanyRow(db(), payload);
console.log("ROW TO SAVE =", {
  smtp_host: row.smtp_host,
  smtp_port: row.smtp_port,
  smtp_user: row.smtp_user,
  smtp_password: row.smtp_password ? "***" : "",
  smtp_from_name: row.smtp_from_name
});
    const fields = [
      "legal_name=@legal_name",
      "country=@country",
      "currency=@currency",
      "vat_id=@vat_id",
      "legal_id=@legal_id",
      "vat_regime=@vat_regime",

      "street=@street",
      "street2=@street2",
      "postal_code=@postal_code",
      "city=@city",
      "state=@state",

      "email=@email",
      "phone=@phone",
      "smtp_host=@smtp_host",
      "smtp_port=@smtp_port",
      "smtp_user=@smtp_user",
      "smtp_password=@smtp_password",
      "smtp_from_name=@smtp_from_name",

      "iban=@iban",
      "bic=@bic",

      "bank_name=@bank_name",
      "bank_holder=@bank_holder",
      "bank_extra=@bank_extra",

      "endpoint_id=@endpoint_id",
      "endpoint_scheme=@endpoint_scheme",

      "tax_regime=@tax_regime",

      "seller_registration_name=@seller_registration_name",
      "seller_trade_name=@seller_trade_name",

      "use_case_code=@use_case_code",
    ];

    if (row.cgv_text !== undefined) fields.push("cgv_text=@cgv_text");
    if (row.show_logo !== undefined) fields.push("show_logo=@show_logo");
    if (row.payment_terms !== undefined) fields.push("payment_terms=@payment_terms");

    if (row.use_case_meta_json !== undefined) fields.push("use_case_meta_json=@use_case_meta_json");
    if (row.meta_json !== undefined) fields.push("meta_json=@meta_json");

    fields.push("vat_country_prefix=@vat_country_prefix");
    fields.push("updated_at=@updated_at");

    db()
      .prepare(
        `
        UPDATE company SET
          ${fields.join(",\n          ")}
        WHERE id=1
        `
      )
      .run(row);

    try {
      const logPath = getAuditLogPathSafe();
      if (logPath) {
        appendAuditEvent({
          logPath,
          hmacSecret: process.env.AUDIT_HMAC_SECRET || null,
          tsaUrl: process.env.AUDIT_TSA_URL || null,
          actor: payload?.user || "system",
          action: "company.save",
          entityType: "company",
          entityId: "1",
          payload: { fields: Object.keys(payload || {}) },
        });
      }
    } catch (err) {
      try {
        console.error("[AUDIT] company.save failed:", err?.message || err);
      } catch {}
    }

    const saved = selectCompany(db());

console.log("ROW AFTER SAVE =", {
  smtp_host: saved.smtp_host,
  smtp_port: saved.smtp_port,
  smtp_user: saved.smtp_user,
  smtp_password: saved.smtp_password ? "***" : "",
  smtp_from_name: saved.smtp_from_name
});

    let targets = { annual_target_ht: null, annual_target_ttc: null };
    try {
      const meta = jsonParseSafe(saved?.meta_json, {});
      const ht = n(meta.annual_target_ht);
      const ttc = n(meta.annual_target_ttc);
      targets = {
        annual_target_ht: Number.isFinite(ht) && ht > 0 ? ht : null,
        annual_target_ttc: Number.isFinite(ttc) && ttc > 0 ? ttc : null,
      };
    } catch {}

    broadcast("company:updated", { ok: true, ...targets });
    broadcast("dashboard:invalidate", { reason: "company:save" });
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send("company:updated", { ok: true });
      w.webContents.send("dashboard:invalidate", { reason: "company:save" });
    }
console.log("AFTER SAVE =", saved);
    return saved;
  });

  ipcMain.handle("company:setLogoBlob", (_e, { bytesBase64, mime, name } = {}) => {
    ensureCompanyRow(db());
    return setLogoBlobInternal(db(), { bytesBase64, mime, name });
  });

  ipcMain.handle("company:getLogo", () => {
    ensureCompanyRow(db());
    const row = db().prepare("SELECT logo_blob, logo_mime, logo_name, logo_updated_at FROM company WHERE id=1").get();
    if (!row || !row.logo_blob) return null;
    return {
      mime: row.logo_mime || "image/jpeg",
      name: row.logo_name || "logo",
      updated_at: row.logo_updated_at || null,
      bytesBase64: bufferToBase64(row.logo_blob),
    };
  });

  ipcMain.handle("company:getInboundConfig", () => {
    ensureCompanyRow(db());
    const row = db().prepare("SELECT use_case_meta_json FROM company WHERE id=1").get();
    const meta = jsonParseSafe(row?.use_case_meta_json, {});
    return meta.inbound || { sftp: {}, webhook: {} };
  });

  ipcMain.handle("company:setInboundConfig", (_e, { inbound } = {}) => {
    ensureCompanyRow(db());
    const row = db().prepare("SELECT use_case_meta_json FROM company WHERE id=1").get();
    const merged = mergeInboundIntoUseCaseMeta(row?.use_case_meta_json, inbound);
    const t = nowIso();
    db().prepare("UPDATE company SET use_case_meta_json=?, updated_at=? WHERE id=1").run(merged, t);
    return { ok: true };
  });

  ipcMain.handle("company:getConformityConfig", () => {
    ensureCompanyRow(db());
    const row = db().prepare("SELECT use_case_meta_json FROM company WHERE id=1").get();
    const meta = jsonParseSafe(row?.use_case_meta_json, {});
    return meta.conformity || { vat_regime: "", txn_frequency: "DECADE", pay_frequency: "MONTH", next_due: "" };
  });

  ipcMain.handle("company:setConformityConfig", (_e, { conformity } = {}) => {
    ensureCompanyRow(db());
    const patch = conformity && typeof conformity === "object" ? conformity : {};
    const row = db().prepare("SELECT use_case_meta_json FROM company WHERE id=1").get();
    const merged = mergeConformityIntoUseCaseMeta(row?.use_case_meta_json, patch);
    const t = nowIso();
    db().prepare("UPDATE company SET use_case_meta_json=?, updated_at=? WHERE id=1").run(merged, t);
    return { ok: true };
  });

  ipcMain.handle("company:clearLogoBlob", () => {
    ensureCompanyRow(db());
    const t = nowIso();
    db()
      .prepare(
        `
        UPDATE company
        SET logo_blob=NULL, logo_mime=NULL, logo_name=NULL, logo_updated_at=NULL, updated_at=?
        WHERE id=1
        `
      )
      .run(t);
    return { ok: true };
  });

  ipcMain.handle("company:setLogoPath", (_e, { path: p } = {}) => {
    ensureCompanyRow(db());
    const t = nowIso();
    db().prepare("UPDATE company SET logo_path=?, updated_at=? WHERE id=1").run(s(p) || null, t);
    return { ok: true };
  });

  ipcMain.handle("company:setLogoFromFile", (_e, { path: filePath } = {}) => {
    ensureCompanyRow(db());
    const p = s(filePath);
    if (!p) throw new Error("Chemin fichier manquant.");
    if (!fs.existsSync(p)) throw new Error("Fichier introuvable.");
    const buf = fs.readFileSync(p);
    const mime = detectMimeFromPath(p);
    const name = path.basename(p);
    return setLogoBlobInternal(db(), { bytesBase64: buf.toString("base64"), mime, name });
  });
};
