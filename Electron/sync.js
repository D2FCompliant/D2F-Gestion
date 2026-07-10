// sync.js
"use strict";

const { request } = require("undici");
const keytar = require("keytar");
const { getDb, nowIso } = require("./db");

// ✅ Nom cohérent avec l'application
const SERVICE = "D2F gestion";
let running = false;
let timer = null;

function s(v, def = "") {
  return String(v ?? def).trim();
}

function getState(db, key, def = null) {
  try {
    const row = db.prepare("SELECT value FROM sync_state WHERE key=?").get(key);
    return row ? row.value : def;
  } catch {
    return def;
  }
}

function setState(db, key, value) {
  db.prepare(
    `
    INSERT INTO sync_state(key,value) VALUES (?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `
  ).run(key, String(value ?? ""));
}

function setLastStatus(db, state, msg = "") {
  try {
    setState(db, "sync_last_status", JSON.stringify({ state, at: nowIso(), msg: s(msg) }));
  } catch {
    // ignore
  }
}

async function httpJson(url, { method = "GET", token, body, timeoutMs = 15000 } = {}) {
  const res = await request(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
    bodyTimeout: timeoutMs,
    headersTimeout: timeoutMs,
  });

  const text = await res.body.text();
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`HTTP ${res.statusCode}: ${String(text || "").slice(0, 300)}`);
  }
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response: ${String(text).slice(0, 300)}`);
  }
}

async function loadToken(email) {
  const e = s(email);
  if (!e) return null;
  return keytar.getPassword(SERVICE, e);
}

async function saveToken(email, token) {
  const e = s(email);
  const t = s(token);
  if (!e || !t) throw new Error("Token/email missing");
  await keytar.setPassword(SERVICE, e, t);
}

async function deleteToken(email) {
  const e = s(email);
  if (!e) return;
  await keytar.deletePassword(SERVICE, e);
}

function ensureSyncStateTable(db) {
  // Safe even if migrations not present
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function getSyncConfig(db) {
  ensureSyncStateTable(db);

  return {
    enabled: getState(db, "sync_enabled", "false") === "true",
    baseUrl: s(getState(db, "sync_base_url", "")).replace(/\/+$/, ""),
    email: s(getState(db, "sync_email", "")),
    deviceId: s(getState(db, "sync_device_id", "")),
  };
}

async function syncOnce() {
  const db = getDb();
  const cfg = getSyncConfig(db);

  if (!cfg.enabled) return { ok: true, skipped: true };

  if (!cfg.baseUrl || !cfg.email || !cfg.deviceId) {
    setLastStatus(db, "error", "Sync config incomplete");
    return { ok: false };
  }

  const token = await loadToken(cfg.email);
  if (!token) {
    setLastStatus(db, "error", "No token (login required)");
    return { ok: false };
  }

  // no-op placeholder : ping léger (si endpoint existe)
  try {
    await httpJson(`${cfg.baseUrl}/auth/me`, { method: "GET", token, timeoutMs: 15000 });
    setLastStatus(db, "ok", "sync enabled (heartbeat ok)");
  } catch (e) {
    setLastStatus(db, "error", e?.message || String(e));
    return { ok: false };
  }

  return { ok: true };
}

async function runOnceSafe() {
  if (running) return;
  running = true;

  const db = getDb();
  try {
    await syncOnce();
  } catch (e) {
    setLastStatus(db, "error", e?.message || String(e));
  } finally {
    running = false;
  }
}

function startAutoSync() {
  if (timer) return;

  timer = setInterval(runOnceSafe, 5 * 60 * 1000);
  if (typeof timer.unref === "function") timer.unref();

  runOnceSafe();
}

function stopAutoSync() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function enableSync({ baseUrl, email, password, deviceId }) {
  const db = getDb();
  ensureSyncStateTable(db);

  const cleanBase = s(baseUrl).replace(/\/+$/, "");
  const e = s(email);
  const p = s(password);

  if (!cleanBase || !e || !p) {
    throw new Error("Missing baseUrl/email/password");
  }

  const resp = await httpJson(`${cleanBase}/auth/login`, {
    method: "POST",
    body: { email: e, password: p, deviceId: s(deviceId) || undefined },
  });

  if (!resp?.token) throw new Error("Login failed");
  await saveToken(e, resp.token);

  setState(db, "sync_enabled", "true");
  setState(db, "sync_base_url", cleanBase);
  setState(db, "sync_email", e);
  setState(db, "sync_device_id", s(deviceId) || `dev-${Date.now()}`);

  setLastStatus(db, "ok", "sync enabled");
  runOnceSafe();
  return { ok: true };
}

async function disableSync() {
  const db = getDb();
  ensureSyncStateTable(db);

  const email = s(getState(db, "sync_email", ""));
  await deleteToken(email);

  setState(db, "sync_enabled", "false");
  setLastStatus(db, "ok", "sync disabled");
  return { ok: true };
}

function getSyncStatus() {
  const db = getDb();
  ensureSyncStateTable(db);

  const last = s(getState(db, "sync_last_status", ""));
  if (!last) return { state: "off", at: null, msg: "" };

  try {
    return JSON.parse(last);
  } catch {
    return { state: "unknown", at: null, msg: "" };
  }
}

module.exports = {
  startAutoSync,
  stopAutoSync,
  syncOnce,
  enableSync,
  disableSync,
  getSyncStatus,
};
