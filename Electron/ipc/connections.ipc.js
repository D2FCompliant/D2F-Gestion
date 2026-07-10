"use strict";

/**
 * IPC – CONNECTEURS (FR PDP / RS SEF / ES FACe / PEPPOL AP)
 *
 * Stockage:
 *   company.use_case_meta_json.connections
 *
 * IPC:
 * - connections:getConfig
 * - connections:saveConfig
 * - connections:test
 * - connections:sendInvoice
 */

const { makeRegistry } = require("../connectors");
const { ConnectorError } = require("../connectors/errors");

/* -------------------- helpers JSON -------------------- */
function safeJsonParse(str, def = {}) {
  try {
    if (!str) return def;
    return typeof str === "string" ? JSON.parse(str) : str;
  } catch {
    return def;
  }
}

function safeJsonStringify(obj) {
  try {
    return JSON.stringify(obj ?? {});
  } catch {
    return "{}";
  }
}

/* -------------------- DB helpers -------------------- */
function readCompanyMeta(db) {
  const row = db.prepare("SELECT use_case_meta_json FROM company WHERE id = 1").get();
  return safeJsonParse(row?.use_case_meta_json, {});
}

function writeCompanyMeta(db, meta) {
  db.prepare(
    "UPDATE company SET use_case_meta_json = ?, updated_at = ? WHERE id = 1"
  ).run(
    safeJsonStringify(meta),
    new Date().toISOString()
  );
}

/* -------------------- defaults -------------------- */
function defaultConnectionsConfig() {
  return {
    fr: { pdp: {} },
    rs: { sef: {} },
    es: { face: {} },
    intl: { peppol: {} },
  };
}

function normalizeConfig(input) {
  const base = defaultConnectionsConfig();
  const cfg = input && typeof input === "object" ? input : {};
  return {
    fr: { pdp: { ...(cfg.fr?.pdp || {}) } },
    rs: { sef: { ...(cfg.rs?.sef || {}) } },
    es: { face: { ...(cfg.es?.face || {}) } },
    intl: { peppol: { ...(cfg.intl?.peppol || {}) } },
  };
}

/* -------------------- IPC registration -------------------- */
module.exports = function registerConnectionsIpc(ipcMain, getDbFn) {
  if (typeof getDbFn !== "function") {
    throw new Error("connections.ipc.js: getDbFn manquant");
  }

  const db = () => getDbFn();

  function getStoredConfig() {
    const meta = readCompanyMeta(db());
    return normalizeConfig(meta.connections || {});
  }

  function saveStoredConfig(patch) {
    const meta = readCompanyMeta(db());
    const cur = normalizeConfig(meta.connections || {});
    const merged = normalizeConfig({
      ...cur,
      ...(patch && typeof patch === "object" ? patch : {}),
    });

    meta.connections = merged;
    writeCompanyMeta(db(), meta);
    return merged;
  }

  /* -------- getConfig -------- */
  ipcMain.handle("connections:getConfig", async () => {
    return getStoredConfig();
  });

  /* -------- saveConfig -------- */
  ipcMain.handle("connections:saveConfig", async (_e, payload) => {
    return saveStoredConfig(payload);
  });

  /* -------- test connections -------- */
  ipcMain.handle("connections:test", async () => {
    const cfg = getStoredConfig();
    const registry = makeRegistry(cfg);
    return await registry.testAll();
  });

  /* -------- send invoice -------- */
  ipcMain.handle("connections:sendInvoice", async (_e, payload = {}) => {
    const {
      country,
      mode = "einvoicing", // einvoicing | ereporting | international
      ublXml,
      metadata,
    } = payload;

    if (!ublXml) {
      throw new ConnectorError("UBL XML manquant", { code: "INVALID_INPUT" });
    }

    const cfg = getStoredConfig();
    const registry = makeRegistry(cfg);

    return await registry.sendInvoice({
      country,
      mode,
      ublXml,
      metadata,
    });
  });
};
