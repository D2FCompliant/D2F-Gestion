// Electron/preload.js
"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const fsp = fs.promises;

async function invokeFirst(channels, payload) {
  const names = Array.isArray(channels) ? channels : [channels];
  let lastErr = null;

  const isMissingHandler = (e) => {
    const msg = String(e?.message || e || "");
    return (
      msg.includes("No handler registered") ||
      msg.includes("No IPC handler") ||
      msg.includes("has no listeners") ||
      msg.includes("Channel") && msg.includes("does not exist")
    );
  };

  for (const ch of names) {
    try {
      return await ipcRenderer.invoke(ch, payload);
    } catch (e) {
      lastErr = e;
      if (!isMissingHandler(e)) throw e; // erreur métier => on remonte telle quelle
    }
  }

  const msg = String(lastErr?.message || lastErr || "");
  throw new Error(`No IPC handler available for ${names.join(" | ")}${msg ? ` — last error: ${msg}` : ""}`);
}

function asObject(x) {
  if (x && typeof x === "object") return x;
  return {};
}

const _listeners = new Map();

function on(channel, cb) {
  const ch = String(channel || "");
  if (!ch || typeof cb !== "function") return () => {};

  const wrapped = (_e, data) => cb(data);

  if (!_listeners.has(ch)) _listeners.set(ch, new Map());
  _listeners.get(ch).set(cb, wrapped);

  ipcRenderer.on(ch, wrapped);

  return () => off(ch, cb);
}

function off(channel, cb) {
  const ch = String(channel || "");
  if (!ch || typeof cb !== "function") return;

  const m = _listeners.get(ch);
  const wrapped = m?.get(cb);
  if (!wrapped) return;

  ipcRenderer.removeListener(ch, wrapped);
  m.delete(cb);
  if (m.size === 0) _listeners.delete(ch);
}

const api = Object.freeze({
  on,
  off,

  i18n: Object.freeze({
    load: (locale) => invokeFirst(["i18n:load"], { locale: String(locale || "fr") }),
  }),

  dashboard: Object.freeze({
    get: (opts = {}) => invokeFirst(["dashboard:get"], asObject(opts)),
    metrics: (opts = {}) => invokeFirst(["dashboard:metrics"], asObject(opts)),
  }),

  company: Object.freeze({
    get: () => ipcRenderer.invoke("company:get"),
    save: (payload) => ipcRenderer.invoke("company:save", asObject(payload)),
    setLogo: (filePath) =>
      invokeFirst(
        ["company:setLogoPath", "company:setLogo", "company:setLogoFromFile"],
        { path: String(filePath || "") }
      ),
    clearLogo: () => invokeFirst(["company:clearLogoBlob", "company:clearLogo"], undefined),
    getLogo: () => invokeFirst(["company:getLogo"], undefined),
    setLogoBlob: (bytesBase64, mime, name) =>
      invokeFirst(["company:setLogoBlob"], {
        bytesBase64: String(bytesBase64 || ""),
        mime: String(mime || ""),
        name: String(name || ""),
      }),
    getInboundConfig: () => invokeFirst(["company:getInboundConfig"], undefined),
    setInboundConfig: (inbound) => invokeFirst(["company:setInboundConfig"], { inbound: asObject(inbound) }),
    getConformityConfig: () => invokeFirst(["company:getConformityConfig"], undefined),
    saveConfig: (payload) =>
      invokeFirst(["conformity:saveConfig"], asObject(payload)).catch(() =>
        invokeFirst(["company:setConformityConfig"], { conformity: asObject(payload) })
      ),
  }),

  inbound: Object.freeze({
    list: (opts = {}) => invokeFirst(["inbound:list"], asObject(opts)),
    get: (id) => invokeFirst(["inbound:get"], { id: String(id || "") }),
    accept: ({ id } = {}) => invokeFirst(["inbound:accept"], { id: String(id || "") }),
    reject: ({ id, reason, code } = {}) =>
      invokeFirst(["inbound:reject"], {
        id: String(id || ""),
        reason: String(reason || ""),
        code: String(code || ""),
      }),
    dispute: ({ id, reason } = {}) =>
      invokeFirst(["inbound:dispute"], { id: String(id || ""), reason: String(reason || "") }),
    importFile: () => invokeFirst(["inbound:importFile"], undefined),
    delete: ({ id } = {}) => invokeFirst(["inbound:delete"], { id: String(id || "") }),
    exportXml: ({ id } = {}) => invokeFirst(["inbound:exportXml"], { id: String(id || "") }),
    exportPdf: ({ id, locale = "fr" } = {}) =>
      invokeFirst(["inbound:exportPdf"], { id: String(id || ""), locale: String(locale || "fr") }),
    sftpStart: (cfg) => invokeFirst(["inbound:sftpStart"], asObject(cfg)),
    sftpStop: () => invokeFirst(["inbound:sftpStop"], undefined),
    webhookStart: (cfg) => invokeFirst(["inbound:webhookStart"], asObject(cfg)),
    webhookStop: () => invokeFirst(["inbound:webhookStop"], undefined),
  }),

  files: Object.freeze({
    pickImage: () => invokeFirst(["files:pickImage"], undefined),
    pickFile: (opts = {}) => invokeFirst(["files:pickFile"], asObject(opts)),
  }),

  clients: Object.freeze({
    list: (q) => invokeFirst(["clients:list"], q ?? {}),
    get: (id) => invokeFirst(["clients:get"], { id: String(id || "") }),
    save: (payload) => invokeFirst(["clients:save", "clients:upsert", "clients:update", "clients:create"], asObject(payload)),
    upsert: (payload) => invokeFirst(["clients:upsert", "clients:save", "clients:update", "clients:create"], asObject(payload)),
    importCsv: (payload) => ipcRenderer.invoke("clients:importCsv", payload),
    remove: (id) => invokeFirst(["clients:remove", "clients:delete"], { id: String(id || "") }),
    delete: (id) => invokeFirst(["clients:delete", "clients:remove"], { id: String(id || "") }),
  }),

  items: Object.freeze({
    list: (q) => invokeFirst(["items:list"], q ?? {}),
    get: (id) => invokeFirst(["items:get"], { id: String(id || "") }),
    save: (payload) => invokeFirst(["items:save", "items:upsert", "items:update", "items:create"], asObject(payload)),
    upsert: (payload) => invokeFirst(["items:upsert", "items:save", "items:update", "items:create"], asObject(payload)),
    duplicate: (id) => invokeFirst(["items:duplicate"], { id: String(id || "") }),
    remove: (id) => invokeFirst(["items:remove", "items:delete"], { id: String(id || "") }),
    delete: (id) => invokeFirst(["items:delete", "items:remove"], { id: String(id || "") }),
  }),

  quotes: Object.freeze({
    list: (q) => invokeFirst(["quotes:list"], q ?? {}),
    getFull: (id) => invokeFirst(["quotes:getFull"], { id: String(id || "") }),
    get: (id) => invokeFirst(["quotes:get", "quotes:getFull"], { id: String(id || "") }),
    create: (payload) => invokeFirst(["quotes:create"], asObject(payload)),
    save: (payload) => invokeFirst(["quotes:update", "quotes:save"], asObject(payload)),
    update: (payload) => invokeFirst(["quotes:update", "quotes:save"], asObject(payload)),
    remove: (id) => invokeFirst(["quotes:remove", "quotes:delete"], { id: String(id || "") }),
    delete: (id) => invokeFirst(["quotes:delete", "quotes:remove"], { id: String(id || "") }),
    setStatus: (id, status) => invokeFirst(["quotes:setStatus"], { id: String(id || ""), status: String(status || "") }),
    exportPdf: (quoteId, locale = "fr", config = {}) =>
      invokeFirst(["quotes:exportPdf"], { quoteId: String(quoteId || ""), locale: String(locale || "fr"), config: asObject(config) }),
  }),

  invoices: Object.freeze({
    list: (q) => invokeFirst(["invoices:list"], q ?? {}),
    get: (id) => invokeFirst(["invoices:get"], { id: String(id || "") }),
    getFull: (id) => invokeFirst(["invoices:getFull"], { id: String(id || "") }),
    create: (payload) => invokeFirst(["invoices:create", "invoices:createBlank"], asObject(payload)),
    save: (payload) => invokeFirst(["invoices:update", "invoices:save"], asObject(payload)),
    update: (payload) => invokeFirst(["invoices:update", "invoices:save"], asObject(payload)),
    remove: (id) => invokeFirst(["invoices:remove", "invoices:delete"], { id: String(id || "") }),
    delete: (id) => invokeFirst(["invoices:delete", "invoices:remove"], { id: String(id || "") }),
    issue: (arg) => { const id = typeof arg === "string" ? arg : arg && typeof arg === "object" ? arg.id : "";
  return invokeFirst(["invoices:issue"], { id: String(id || "") });
},
    exportUbl: (arg, profile = "core") => { const payload = arg && typeof arg === "object" ? {
          id: String(arg.id || ""),
          profile: String(arg.profile || profile || "core"),
          force: !!arg.force,
        }
      : {
          id: String(arg || ""),
          profile: String(profile || "core"),
        };

      return invokeFirst(["invoices:exportUbl"], payload);
    },
    createFromQuote: (quoteId) => invokeFirst(["invoices:createFromQuote"], { quoteId: String(quoteId || "") }),
    createDeposit: (payload = {}) =>
      invokeFirst(["invoices:createDeposit"], payload),
    createCreditNote: (invoiceId) => invokeFirst(["invoices:createCreditNote"], { invoiceId: String(invoiceId || "") }),
    exportPdf: (invoiceId, locale = "fr", config = {}) =>
      invokeFirst(["invoices:exportPdf"], { invoiceId: String(invoiceId || ""), locale: String(locale || "fr"), config: asObject(config) }),
    exportPeppolPdf: (id, profile = "peppol-bis3") =>
      invokeFirst(["invoices:exportPeppolPdf"], { id: String(id || ""), profile: String(profile || "peppol-bis3") }),
  }),

  payments: Object.freeze({
    list: (arg) => {
      const invoiceId =
        typeof arg === "string"
          ? arg
          : arg && typeof arg === "object"
            ? arg.invoiceId || arg.invoice_id || arg.id
            : "";
      return invokeFirst(["payments:list"], { invoiceId: String(invoiceId || "") });
    },
    listAll: (query = {}) => invokeFirst(["payments:listAll"], asObject(query)),
    record: (payload) => invokeFirst(["payments:record"], asObject(payload)),
    delete: (arg) => {
      const id = typeof arg === "string" ? arg : arg && typeof arg === "object" ? arg.id : "";
      return invokeFirst(["payments:delete"], { id: String(id || "") });
    },
    sumByInvoice: (invoiceId) => invokeFirst(["payments:sumByInvoice"], { invoiceId: String(invoiceId || "") }),
  }),

  conformity: Object.freeze({
    getConfig: () => invokeFirst(["conformity:getConfig", "company:getConformityConfig"], undefined),
    saveConfig: (payload) => invokeFirst(["conformity:saveConfig", "company:setConformityConfig"], asObject(payload)),
    validateUbl: (payload) => invokeFirst(["conformity:validateUbl"], asObject(payload)),
    rebuildPeriod: (payload) => invokeFirst(["conformity:rebuildPeriod"], asObject(payload)),
    sendNow: (payload) => invokeFirst(["conformity:sendNow"], asObject(payload)),
    openQueue: () => invokeFirst(["conformity:openQueue"], undefined),
    openSettings: () => invokeFirst(["conformity:openSettings"], undefined),
  }),

  email: Object.freeze({
    send: (payload) =>
      invokeFirst(["email:send"], asObject(payload)),
  }),
  audit: Object.freeze({
    path: () => invokeFirst(["audit:path"], undefined),
    read: (opts = {}) => invokeFirst(["audit:read"], asObject(opts)),
    verify: () => invokeFirst(["audit:verify"], undefined),
  }),

  rejectionReasons: Object.freeze({
    load: () => invokeFirst(["xpReject:load", "rejectionReasons:load"], undefined),
  }),
  xpReject: Object.freeze({
    load: () => invokeFirst(["xpReject:load", "rejectionReasons:load"], undefined),
  }),

  _fs: Object.freeze({
    readText: async (filePath) => {
      const p = String(filePath || "");
      if (!p) throw new Error("readText: filePath manquant");
      return await fsp.readFile(p, "utf-8");
    },
  }),
});

contextBridge.exposeInMainWorld("api", api);
contextBridge.exposeInMainWorld("d2f", api);
