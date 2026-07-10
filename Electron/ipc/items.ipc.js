"use strict";

const { randomUUID } = require("crypto");
const { nowIso } = require("../db"); // ✅ FIX chemin (ipc -> ../db)

function s(v, def = "") {
  return String(v ?? def).trim();
}

function n(v, def = 0) {
  const num = Number(v);
  return Number.isFinite(num) ? num : def;
}

function toJson(value) {
  if (value == null) return "{}";
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
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

/**
 * Ensure items table exists + is compatible with renderer needs.
 * Non-destructive, idempotent.
 */
function ensureItemsSchema(db) {
  if (!tableExists(db, "items")) {
    db.exec(`
      CREATE TABLE items (
        id TEXT PRIMARY KEY,
        ref TEXT,
        name TEXT NOT NULL,
        description TEXT,

        unit_code TEXT NOT NULL DEFAULT 'C62',
        unit_price_ht REAL NOT NULL DEFAULT 0,
        tva_percent REAL NOT NULL DEFAULT 20,

        -- extensions EN16931 / CTC FR
        item_type TEXT NOT NULL DEFAULT 'SERVICE',  -- GOODS|SERVICE
        active INTEGER NOT NULL DEFAULT 1,

        -- optional product/accounting
        product_code TEXT,
        classification_code TEXT,

        meta_json TEXT NOT NULL DEFAULT '{}',

        created_at TEXT,
        updated_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_items_ref ON items(ref);
      CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
      CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updated_at);
      CREATE INDEX IF NOT EXISTS idx_items_active ON items(active);
      CREATE INDEX IF NOT EXISTS idx_items_type ON items(item_type);
    `);
    return;
  }

  // Compat legacy (idempotent)
  addColumnIfMissing(db, "items", "ref", "TEXT");
  addColumnIfMissing(db, "items", "name", "TEXT");
  addColumnIfMissing(db, "items", "description", "TEXT");

  addColumnIfMissing(db, "items", "unit_code", "TEXT NOT NULL DEFAULT 'C62'");
  addColumnIfMissing(db, "items", "unit_price_ht", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "items", "tva_percent", "REAL NOT NULL DEFAULT 20");

  addColumnIfMissing(db, "items", "item_type", "TEXT NOT NULL DEFAULT 'SERVICE'");
  addColumnIfMissing(db, "items", "active", "INTEGER NOT NULL DEFAULT 1");

  addColumnIfMissing(db, "items", "product_code", "TEXT");
  addColumnIfMissing(db, "items", "classification_code", "TEXT");

  addColumnIfMissing(db, "items", "meta_json", "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing(db, "items", "created_at", "TEXT");
  addColumnIfMissing(db, "items", "updated_at", "TEXT");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_items_ref ON items(ref);
    CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
    CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updated_at);
    CREATE INDEX IF NOT EXISTS idx_items_active ON items(active);
    CREATE INDEX IF NOT EXISTS idx_items_type ON items(item_type);
  `);
}

/**
 * Mapping UI <-> DB
 * UI (app.js) utilise:
 *   - label (libellé)
 *   - type (simple|composed) (UI-only)
 *   - active (0/1)
 * DB utilise:
 *   - name (libellé EN16931)
 *   - item_type (GOODS|SERVICE) pour CTC FR (par défaut SERVICE)
 *   - meta_json pour stocker ui_type sans casser le schéma
 */
function dbRowToUi(row) {
  if (!row) return null;
  const meta = parseJson(row.meta_json, {});
  return {
    ...row,
    label: row.name ?? "",
    type: meta.ui_type || "simple", // UI-only
    active: Number(row.active ?? 1),
  };
}

function sanitizeItem(payload) {
  const id = s(payload.id) || randomUUID();

  // UI -> DB mapping
  const label = s(payload.label || payload.name);
  const uiType = s(payload.type || "simple"); // simple|composed (UI only)
  const active = payload.active === false || payload.active === 0 || payload.active === "0" ? 0 : 1;

  const out = {
    id,
    ref: s(payload.ref),
    name: label,
    description: s(payload.description),

    unit_code: s(payload.unit_code || "C62") || "C62",
    unit_price_ht: Math.round(n(payload.unit_price_ht, 0) * 100) / 100,
    tva_percent: Math.round(n(payload.tva_percent, 20) * 100) / 100,

    // CTC FR / EN: GOODS|SERVICE (si pas fourni, on garde SERVICE)
    item_type: s(payload.item_type || "SERVICE").toUpperCase() === "GOODS" ? "GOODS" : "SERVICE",
    active,

    product_code: s(payload.product_code),
    classification_code: s(payload.classification_code),

    // conserve meta existant mais injecte ui_type
    meta_json: (() => {
      const base = parseJson(payload.meta_json, {});
      base.ui_type = uiType || base.ui_type || "simple";
      return toJson(base);
    })(),
  };

  if (!out.name) throw new Error("Article: libellé obligatoire (BT-126).");

  if (out.unit_price_ht < 0) out.unit_price_ht = 0;
  if (out.tva_percent < 0) out.tva_percent = 0;

  return out;
}

module.exports = (ipcMain, getDb) => {
  const db = () => getDb();

  ipcMain.handle("items:list", (_e, query = {}) => {
    ensureItemsSchema(db());

    const q = s(query.q || query.term); // compat: app.js envoie term
    const params = [];
    const where = [];

    if (q) {
      where.push("(name LIKE ? OR ref LIKE ? OR description LIKE ?)");
      const like = `%${q}%`;
      params.push(like, like, like);
    }

    const sql = `
      SELECT *
      FROM items
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY COALESCE(updated_at, created_at) DESC, name ASC
      LIMIT 500
    `;

    const rows = db().prepare(sql).all(...params);
    return rows.map(dbRowToUi);
  });

  ipcMain.handle("items:get", (_e, { id }) => {
    ensureItemsSchema(db());
    const row = db().prepare("SELECT * FROM items WHERE id = ?").get(s(id)) || null;
    return dbRowToUi(row);
  });

  // create: génère id + insère
  ipcMain.handle("items:create", (_e, payload = {}) => {
    ensureItemsSchema(db());

    const t = nowIso();
    const it = sanitizeItem(payload);
    const row = { ...it, created_at: t, updated_at: t };

    db()
      .prepare(
        `
        INSERT INTO items (
          id, ref, name, description,
          unit_code, unit_price_ht, tva_percent,
          item_type, active,
          product_code, classification_code,
          meta_json,
          created_at, updated_at
        ) VALUES (
          @id, @ref, @name, @description,
          @unit_code, @unit_price_ht, @tva_percent,
          @item_type, @active,
          @product_code, @classification_code,
          @meta_json,
          @created_at, @updated_at
        )
      `
      )
      .run(row);

    const saved = db().prepare("SELECT * FROM items WHERE id = ?").get(it.id);
    return dbRowToUi(saved);
  });

  // save: upsert par id
  ipcMain.handle("items:save", (_e, payload = {}) => {
    ensureItemsSchema(db());

    const t = nowIso();
    const it = sanitizeItem(payload);

    const existing = db().prepare("SELECT id, created_at FROM items WHERE id = ?").get(it.id);

    const row = {
      ...it,
      created_at: existing?.created_at || t,
      updated_at: t,
    };

    db()
      .prepare(
        `
        INSERT INTO items (
          id, ref, name, description,
          unit_code, unit_price_ht, tva_percent,
          item_type, active,
          product_code, classification_code,
          meta_json,
          created_at, updated_at
        ) VALUES (
          @id, @ref, @name, @description,
          @unit_code, @unit_price_ht, @tva_percent,
          @item_type, @active,
          @product_code, @classification_code,
          @meta_json,
          @created_at, @updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
          ref=excluded.ref,
          name=excluded.name,
          description=excluded.description,
          unit_code=excluded.unit_code,
          unit_price_ht=excluded.unit_price_ht,
          tva_percent=excluded.tva_percent,
          item_type=excluded.item_type,
          active=excluded.active,
          product_code=excluded.product_code,
          classification_code=excluded.classification_code,
          meta_json=excluded.meta_json,
          updated_at=excluded.updated_at
      `
      )
      .run(row);

    const saved = db().prepare("SELECT * FROM items WHERE id = ?").get(it.id);
    return dbRowToUi(saved);
  });

  // alias compat (si preload tente items:upsert)
  ipcMain.handle("items:upsert", (_e, payload = {}) => {
  // alias compat -> même comportement que items:save
  // (on ne "call" pas ipcMain.handle ici)
  ensureItemsSchema(db());

  const t = nowIso();
  const it = sanitizeItem(payload);

  const existing = db().prepare("SELECT id, created_at FROM items WHERE id = ?").get(it.id);

  const row = {
    ...it,
    created_at: existing?.created_at || t,
    updated_at: t,
  };

  db()
    .prepare(
      `
      INSERT INTO items (
        id, ref, name, description,
        unit_code, unit_price_ht, tva_percent,
        item_type, active,
        product_code, classification_code,
        meta_json,
        created_at, updated_at
      ) VALUES (
        @id, @ref, @name, @description,
        @unit_code, @unit_price_ht, @tva_percent,
        @item_type, @active,
        @product_code, @classification_code,
        @meta_json,
        @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        ref=excluded.ref,
        name=excluded.name,
        description=excluded.description,
        unit_code=excluded.unit_code,
        unit_price_ht=excluded.unit_price_ht,
        tva_percent=excluded.tva_percent,
        item_type=excluded.item_type,
        active=excluded.active,
        product_code=excluded.product_code,
        classification_code=excluded.classification_code,
        meta_json=excluded.meta_json,
        updated_at=excluded.updated_at
    `
    )
    .run(row);

  const saved = db().prepare("SELECT * FROM items WHERE id = ?").get(it.id);
  return dbRowToUi(saved);
});


  ipcMain.handle("items:delete", (_e, { id }) => {
    ensureItemsSchema(db());
    db().prepare("DELETE FROM items WHERE id = ?").run(s(id));
    return { ok: true };
  });

  ipcMain.handle("items:remove", (_e, { id }) => {
    ensureItemsSchema(db());
    db().prepare("DELETE FROM items WHERE id = ?").run(s(id));
    return { ok: true };
  });
};
