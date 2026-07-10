"use strict";

const fs = require("fs");
const path = require("path");
const { app } = require("electron");

let auditLib = null;
try {
  auditLib = require("../audit/audit");
} catch {
  auditLib = null;
}

function getUserDataDirFromDbPath() {
  const dbPath = process.env.DB_PATH ? String(process.env.DB_PATH).trim() : "";
  if (!dbPath) return null;
  const dataDir = path.dirname(dbPath);
  const userDataDir = path.dirname(dataDir);
  return userDataDir;
}

function resolveAuditLogPath() {
  const envPath = String(process.env.AUDIT_LOG_PATH || "").trim();
  if (envPath) return envPath;

  if (auditLib?.getAuditLogPath) {
    return auditLib.getAuditLogPath(app);
  }

  return path.join(process.cwd(), "audit.log.jsonl");
}

function ensureAuditFile(p) {
  const dir = path.dirname(p);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  try {
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, "", "utf-8");
    }
  } catch {}
}

function readFallback({ logPath, limit = 500, sinceSeq = 0 } = {}) {
  ensureAuditFile(logPath);
  let raw = "";
  try {
    raw = fs.readFileSync(logPath, "utf-8");
  } catch {
    return { ok: true, logPath, events: [] };
  }
  const lines = raw.split("\n").filter(Boolean);
  const out = [];
  const s = Math.max(0, Number(sinceSeq || 0) || 0);
  const lim = Math.max(1, Math.min(5000, Number(limit || 500) || 500));
  for (const line of lines) {
    try {
      const evt = JSON.parse(line);
      const seq = Number(evt?.seq || 0) || 0;
      if (seq >= s) out.push(evt);
      if (out.length >= lim) break;
    } catch {}
  }
  return { ok: true, logPath, events: out };
}

function verifyFallback({ logPath } = {}) {
  ensureAuditFile(logPath);
  const r = readFallback({ logPath, limit: 1000000, sinceSeq: 0 });
  const events = Array.isArray(r.events) ? r.events : [];
  let ok = true;
  let lastSeq = -1;
  for (const e of events) {
    const seq = Number(e?.seq);
    if (!Number.isFinite(seq) || seq <= lastSeq) {
      ok = false;
      break;
    }
    lastSeq = seq;
  }
  return { ok, logPath, count: events.length, lastSeq };
}

module.exports = (ipcMain, getDb) => {
  void getDb;

  ipcMain.handle("audit:path", () => {
    const logPath = resolveAuditLogPath();
    ensureAuditFile(logPath);
    return { ok: true, logPath };
  });

  ipcMain.handle("audit:read", (_e, { limit = 500, sinceSeq = 0 } = {}) => {
    const logPath = resolveAuditLogPath();
    ensureAuditFile(logPath);

    if (auditLib?.readAuditLog) {
      try {
        return auditLib.readAuditLog({ logPath, limit, sinceSeq });
      } catch {
        return readFallback({ logPath, limit, sinceSeq });
      }
    }

    return readFallback({ logPath, limit, sinceSeq });
  });

  ipcMain.handle("audit:verify", () => {
    const logPath = resolveAuditLogPath();
    ensureAuditFile(logPath);

    if (auditLib?.verifyAuditLog) {
      try {
        return auditLib.verifyAuditLog({
          logPath,
          hmacSecret: process.env.AUDIT_HMAC_SECRET || null,
        });
      } catch {
        return verifyFallback({ logPath });
      }
    }

    return verifyFallback({ logPath });
  });
};
