// Electron/ipc/clients.ipc.js
"use strict";

/**
 * Clients IPC (ERP-ready)
 * - CRUD clients
 * - Non-destructive schema patching (idempotent)
 * - Adds customer_type: B2C/B2B/B2G
 * - Adds PEPPOL fields: endpoint_id / endpoint_scheme
 * - Adds EN16931 hooks: buyer_reference, legal_id, vat_id, etc.
 *
 * Compat:
 * - Accepts legacy payload fields: postal, postal_code, meta, meta_json
 * - Exposes save/upsert/create/update aliases
 * - Exposes remove/delete aliases
 */

const { randomUUID } = require("crypto");

// FIX chemin (ipc -> ../db) + fallback safe
let nowIso;
try {
  ({ nowIso } = require("../db"));
} catch (_e) {
  nowIso = () => new Date().toISOString();
}

// -------------------- helpers --------------------
function s(v, def = "") {
  return String(v ?? def).trim();
}
function n(v, def = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : def;
}
function toJson(v) {
  try {
    return typeof v === "string" ? v : JSON.stringify(v ?? {});
  } catch {
    return "{}";
  }
}
function safeJsonParse(str, def = {}) {
  try {
    if (!str) return def;
    return JSON.parse(str);
  } catch {
    return def;
  }
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
function pickId(arg) {
  if (!arg) return "";
  if (typeof arg === "string") return s(arg);
  if (typeof arg === "object") return s(arg.id);
  return "";
}

function normalizeCustomerType(v) {
  const ct = s(v || "B2C").toUpperCase();
  return ["B2C", "B2B", "B2G"].includes(ct) ? ct : "B2C";
}

function normalizeCountry(v, def = "FR") {
  const c = s(v || def).toUpperCase();
  return c || def;
}

function normalizePostal(payload) {
  // accept postal_code or postal
  return s(payload.postal_code || payload.postal || "");
}

// -------------------- schema --------------------
function ensureClientsSchema(db) {
  if (!tableExists(db, "clients")) {
    db.exec(`
      CREATE TABLE clients (
        id TEXT PRIMARY KEY,

        name TEXT NOT NULL,
        customer_type TEXT NOT NULL DEFAULT 'B2C', -- B2C|B2B|B2G

        email TEXT,
        phone TEXT,

        -- EN16931
        country TEXT NOT NULL DEFAULT 'FR',
        state TEXT,               -- region/subdivision
        vat_subject INTEGER NOT NULL DEFAULT 1,
        vat_id TEXT,              -- BT-48
        legal_id TEXT,            -- national/company ID
        buyer_reference TEXT,     -- BT-10 (often B2G)

        street TEXT,
        street2 TEXT,
        postal_code TEXT,
        city TEXT,

        -- PEPPOL endpoint addressing (optional)
        endpoint_id TEXT,
        endpoint_scheme TEXT,

        -- free-form
        notes TEXT,
  
        -- defaults paiement / devis (client-level)
        payment_term TEXT,           -- DUE_ON_RECEIPT | NET_15 | NET_30 | NEGOTIATED
        payment_days INTEGER,        -- optionnel
        payment_text TEXT,           -- texte libre
        quote_validity_days INTEGER, -- jours par défaut

        meta_json TEXT,
        
        created_at TEXT,
        updated_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
      CREATE INDEX IF NOT EXISTS idx_clients_country ON clients(country);
      CREATE INDEX IF NOT EXISTS idx_clients_vat ON clients(vat_id);
    `);
  } else {
    // Patch legacy schemas safely
    addColumnIfMissing(db, "clients", "name", "TEXT");
    addColumnIfMissing(db, "clients", "customer_type", "TEXT NOT NULL DEFAULT 'B2C'");

    addColumnIfMissing(db, "clients", "email", "TEXT");
    addColumnIfMissing(db, "clients", "phone", "TEXT");

    addColumnIfMissing(db, "clients", "country", "TEXT NOT NULL DEFAULT 'FR'");
    addColumnIfMissing(db, "clients", "state", "TEXT");
    addColumnIfMissing(db, "clients", "vat_subject", "INTEGER NOT NULL DEFAULT 1");
    addColumnIfMissing(db, "clients", "vat_id", "TEXT");
    addColumnIfMissing(db, "clients", "legal_id", "TEXT");
    addColumnIfMissing(db, "clients", "buyer_reference", "TEXT");

    addColumnIfMissing(db, "clients", "street", "TEXT");
    addColumnIfMissing(db, "clients", "street2", "TEXT");
    addColumnIfMissing(db, "clients", "postal_code", "TEXT");
    addColumnIfMissing(db, "clients", "city", "TEXT");

    addColumnIfMissing(db, "clients", "endpoint_id", "TEXT");
    addColumnIfMissing(db, "clients", "endpoint_scheme", "TEXT");

    addColumnIfMissing(db, "clients", "notes", "TEXT");
    addColumnIfMissing(db, "clients", "meta_json", "TEXT");
    addColumnIfMissing(db, "clients", "payment_term", "TEXT");
    addColumnIfMissing(db, "clients", "payment_days", "INTEGER");
    addColumnIfMissing(db, "clients", "payment_text", "TEXT");
    addColumnIfMissing(db, "clients", "quote_validity_days", "INTEGER");

    addColumnIfMissing(db, "clients", "created_at", "TEXT");
    addColumnIfMissing(db, "clients", "updated_at", "TEXT");

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
      CREATE INDEX IF NOT EXISTS idx_clients_country ON clients(country);
      CREATE INDEX IF NOT EXISTS idx_clients_vat ON clients(vat_id);
    `);
  }
}

// -------------------- CRUD --------------------
function upsertClient(db, payload = {}) {
  ensureClientsSchema(db);

  const t = nowIso();
  const id = s(payload.id) || randomUUID();

  const row = db.prepare("SELECT id FROM clients WHERE id = ?").get(id);

  // meta merge (non destructif)
  const prevMeta =
    row &&
    (() => {
      const old = db.prepare("SELECT meta_json FROM clients WHERE id = ?").get(id);
      return safeJsonParse(old?.meta_json, {});
    })();

  const incomingMeta = safeJsonParse(
    typeof payload.meta_json === "string" ? payload.meta_json : toJson(payload.meta_json || payload.meta || {}),
    {}
  );

  const mergedMeta = { ...(prevMeta || {}), ...(incomingMeta || {}) };

    // --- normalize payment_days safely (keep 0, avoid "")
    const rawPayDays = payload.payment_days ?? payload.paymentDays;
    const payDays = rawPayDays === "" || rawPayDays == null ? null : Number(rawPayDays);

    // --- normalize quote_validity_days safely
    const rawQvd = payload.quote_validity_days ?? payload.quoteValidityDays;
    const qvd = rawQvd === "" || rawQvd == null ? null : Number(rawQvd);

    const data = {
      id,
      name: s(payload.name),
      customer_type: normalizeCustomerType(payload.customer_type),

      email: s(payload.email),
      phone: s(payload.phone),

      country: normalizeCountry(payload.country, "FR"),
      state: s(payload.state),

      vat_subject: payload.vat_subject === 0 || payload.vat_subject === "0" ? 0 : 1,
      vat_id: s(payload.vat_id),
      legal_id: s(payload.legal_id),
      buyer_reference: s(payload.buyer_reference),

      street: s(payload.street),
      street2: s(payload.street2),
      postal_code: normalizePostal(payload),
      city: s(payload.city),

      endpoint_id: s(payload.endpoint_id),
      endpoint_scheme: s(payload.endpoint_scheme),

      payment_term: s(payload.payment_term ?? payload.paymentTerm ?? payload.payment_terms ?? payload.paymentTerms ?? ""),
      payment_days: Number.isFinite(payDays) ? payDays : null,
      payment_text: s(payload.payment_text ?? payload.paymentText ?? ""),
      quote_validity_days: Number.isFinite(qvd) ? qvd : null,

      notes: s(payload.notes),
      meta_json: toJson(mergedMeta),

      created_at: t,
      updated_at: t,
    };

  const tx = db.transaction(() => {
    if (!row) {
      db.prepare(
        `
        INSERT INTO clients (
          id, name, customer_type,
          email, phone,
          country, state,
          vat_subject, vat_id, legal_id, buyer_reference,
          street, street2, postal_code, city,
          endpoint_id, endpoint_scheme,
          payment_term, payment_days, payment_text, quote_validity_days,
          notes, meta_json,
          created_at, updated_at
        ) VALUES (
          @id, @name, @customer_type,
          @email, @phone,
          @country, @state,
          @vat_subject, @vat_id, @legal_id, @buyer_reference,
          @street, @street2, @postal_code, @city,
          @endpoint_id, @endpoint_scheme,
          @payment_term, @payment_days, @payment_text, @quote_validity_days,
          @notes, @meta_json,
          @created_at, @updated_at
        )
      `
      ).run(data);
    } else {
      db.prepare(
        `
        UPDATE clients SET
          name=@name,
          customer_type=@customer_type,

          email=@email,
          phone=@phone,

          country=@country,
          state=@state,

          vat_subject=@vat_subject,
          vat_id=@vat_id,
          legal_id=@legal_id,
          buyer_reference=@buyer_reference,

          street=@street,
          street2=@street2,
          postal_code=@postal_code,
          city=@city,

          endpoint_id=@endpoint_id,
          endpoint_scheme=@endpoint_scheme,
          
          payment_term=@payment_term,
          payment_days=@payment_days,
          payment_text=@payment_text,
          quote_validity_days=@quote_validity_days,

          notes=@notes,
          meta_json=@meta_json,

          updated_at=@updated_at
        WHERE id=@id
      `
      ).run(data);
    }
  });

  tx();
  return db.prepare("SELECT * FROM clients WHERE id = ?").get(id);
}

// -------------------- IPC handlers --------------------
module.exports = (ipcMain, getDb) => {
  const db = () => getDb();

  ipcMain.handle("clients:list", (_e, q = {}) => {
    ensureClientsSchema(db());

    const term = s(q?.q || "");
    const params = [];
    let where = "1=1";

    if (term) {
      where += " AND (name LIKE ? OR email LIKE ? OR vat_id LIKE ? OR legal_id LIKE ?)";
      params.push(`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`);
    }

    // optional filters
    if (q?.country) {
      where += " AND country = ?";
      params.push(normalizeCountry(q.country, "FR"));
    }
    if (q?.customer_type) {
      where += " AND customer_type = ?";
      params.push(normalizeCustomerType(q.customer_type));
    }

    return db()
      .prepare(
        `
        SELECT
          id, name, customer_type,
          email, phone,
          country, state,
          vat_subject, vat_id, legal_id, buyer_reference,
          street, street2, postal_code, city,
          endpoint_id, endpoint_scheme,
          payment_term, payment_days, payment_text, quote_validity_days,
          notes, meta_json,
          created_at, updated_at
        FROM clients
        WHERE ${where}
        ORDER BY name COLLATE NOCASE ASC
        LIMIT 1000
      `
      )
      .all(...params);
  });

  ipcMain.handle("clients:get", (_e, arg) => {
    ensureClientsSchema(db());
    const id = pickId(arg);
    if (!id) throw new Error("Client id required");
    return db().prepare("SELECT * FROM clients WHERE id = ?").get(id);
  });

// --- CSV IMPORT (clients) ---
ipcMain.handle("clients:importCsv", async (_e, { rows = [], updateExisting = true } = {}) => {
  const dbi = db();              // ✅ utilise ton helper db() (=> getDb())
  ensureClientsSchema(dbi);      // ✅ garantit la table/colonnes

  const report = {
    ok: true,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [], // [{index, message}]
  };

  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: true, ...report, message: "No rows." };
  }

  // helpers
  const norm = (v) => s(v, ""); // réutilise ton helper s()
  const normUp = (v) => norm(v).toUpperCase();

  const findExisting = (r) => {
    const vat = norm(r.vat_id || r.vatId);
    const lid = norm(r.legal_id || r.legalId);
    const email = norm(r.email);

    if (vat) {
      const x = dbi.prepare("SELECT * FROM clients WHERE vat_id = ? LIMIT 1").get(vat);
      if (x) return x;
    }
    if (lid) {
      const x = dbi.prepare("SELECT * FROM clients WHERE legal_id = ? LIMIT 1").get(lid);
      if (x) return x;
    }
    if (email) {
      const x = dbi.prepare("SELECT * FROM clients WHERE email = ? LIMIT 1").get(email);
      if (x) return x;
    }
    return null;
  };

  // ✅ le plus robuste : réutiliser upsertClient() (normalisations + meta merge + dates)
  const tx = dbi.transaction((items) => {
    for (let i = 0; i < items.length; i++) {
      const r = items[i] || {};
      try {
        const payload = {
          // match ton schéma + aliases supportés par upsertClient
          customer_type: normalizeCustomerType(r.customer_type || "B2C"),
          name: norm(r.name),

          email: norm(r.email),
          phone: norm(r.phone),

          country: normalizeCountry(r.country || "FR", "FR"),
          state: norm(r.state),

          vat_subject: r.vat_subject === 0 || r.vat_subject === "0" ? 0 : 1,
          vat_id: norm(r.vat_id),
          legal_id: norm(r.legal_id),
          buyer_reference: norm(r.buyer_reference),

          street: norm(r.street),
          street2: norm(r.street2),
          postal_code: norm(r.postal_code || r.postal),
          city: norm(r.city),

          endpoint_id: norm(r.endpoint_id),
          endpoint_scheme: norm(r.endpoint_scheme),

          payment_term: normUp(r.payment_term),
          payment_days: r.payment_days === "" || r.payment_days == null ? null : Number(r.payment_days),
          payment_text: norm(r.payment_text),
          quote_validity_days:
            r.quote_validity_days === "" || r.quote_validity_days == null ? null : Number(r.quote_validity_days),

          notes: norm(r.notes),

          // meta (optionnel)
          meta_json: r.meta_json ?? r.meta ?? {},
        };

        if (!payload.name) {
          report.skipped++;
          continue;
        }

        const existing = updateExisting ? findExisting(payload) : null;
        if (existing?.id) payload.id = existing.id; // ✅ upsert fera UPDATE

        const saved = upsertClient(dbi, payload);

        if (existing?.id) report.updated++;
        else report.inserted++;
      } catch (e) {
        report.errors.push({ index: i, message: String(e?.message || e) });
      }
    }
  });

  tx(rows);

  return {
    ok: report.errors.length === 0,
    ...report,
  };
});

  ipcMain.handle("clients:save", (_e, payload = {}) => upsertClient(db(), payload));
  ipcMain.handle("clients:upsert", (_e, payload = {}) => upsertClient(db(), payload));
  ipcMain.handle("clients:create", (_e, payload = {}) => upsertClient(db(), payload));
  ipcMain.handle("clients:update", (_e, payload = {}) => upsertClient(db(), payload));

  ipcMain.handle("clients:remove", (_e, arg) => {
    ensureClientsSchema(db());
    const id = pickId(arg);
    if (!id) throw new Error("Client id required");
    db().prepare("DELETE FROM clients WHERE id = ?").run(id);
    return { ok: true };
  });

  ipcMain.handle("clients:delete", (_e, arg) => {
    ensureClientsSchema(db());
    const id = pickId(arg);
    if (!id) throw new Error("Client id required");
    db().prepare("DELETE FROM clients WHERE id = ?").run(id);
    return { ok: true };
  });
};
