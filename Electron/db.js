// Electron/db.js
"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { app } = require("electron");

let db;

/* -------------------------------------------------- */
/* Utils                                              */
/* -------------------------------------------------- */

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/* -------------------------------------------------- */
/* Paths (IMPORTANT: jamais écrire dans app.asar)     */
/* -------------------------------------------------- */

function getDataDir() {
  const dir = path.join(app.getPath("userData"), "data");
  ensureDir(dir);
  return dir;
}

function getDbPath() {
  return path.join(getDataDir(), "d2f-gestion.sqlite");
}

/**
 * Dossier des migrations SQL
 * 👉 Lecture seule depuis le bundle (asar OK)
 */
function getMigrationsReadDir() {
  return path.join(__dirname, "migrations");
}

/* -------------------------------------------------- */
/* Database                                           */
/* -------------------------------------------------- */

function getDb() {
  if (!db) {
    const dbPath = getDbPath();
    console.log("🧠 SQLITE DB PATH =", dbPath);
    db = new Database(dbPath);

    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");
  }
  return db;
}

/* -------------------------------------------------- */
/* Migrations                                         */
/* -------------------------------------------------- */

function isIgnorableMigrationError(err) {
  const msg = String(err?.message || err || "");

  return (
    msg.includes("duplicate column name") ||
    msg.includes("already exists") ||
    msg.includes("UNIQUE constraint failed: _migrations.id")
  );
}

function migrate() {
  const migrationsDir = getMigrationsReadDir();

  if (!fs.existsSync(migrationsDir)) {
    console.warn("⚠️ Aucun dossier migrations trouvé:", migrationsDir);
    return;
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();

  if (files.length === 0) {
    console.log("ℹ️ Aucune migration à appliquer");
    return;
  }

  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  for (const file of files) {
    const id = file;

    const already = d
      .prepare("SELECT 1 FROM _migrations WHERE id = ?")
      .get(id);

    if (already) continue;

    const sqlPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(sqlPath, "utf8");

    try {
      const tx = d.transaction(() => {
        d.exec(sql);
        d.prepare(
          "INSERT INTO _migrations (id, applied_at) VALUES (?, ?)"
        ).run(id, nowIso());
      });

      tx();
      console.log("✅ Migration appliquée:", file);
    } catch (e) {
      if (isIgnorableMigrationError(e)) {
        console.warn("⚠️ Migration ignorée (déjà appliquée):", file);
        try {
          d.prepare(
            "INSERT INTO _migrations (id, applied_at) VALUES (?, ?)"
          ).run(id, nowIso());
        } catch {}
        continue;
      }

      console.error("❌ Migration échouée:", file);
      throw new Error(`Migration échouée (${file}): ${e.message}`);
    }
  }
}

/* -------------------------------------------------- */
/* Exports                                            */
/* -------------------------------------------------- */

module.exports = {
  getDb,
  migrate,
  nowIso
};
