"use strict";

const { request, jsonHeaders } = require("./httpClient");
const { ConnectorError } = require("./errors");
const telemetry = require("./telemetry");

/**
 * France: connexion via PDP/PA (jamais direct PPF).
 * Ce connecteur appelle l'API de TA PDP (ou un mock interne).
 */

function requireCfg(cfg) {
  if (!cfg?.baseUrl) throw new ConnectorError("FR PDP: baseUrl manquant", { code: "CFG_MISSING" });
  if (!cfg?.auth?.type) throw new ConnectorError("FR PDP: auth.type manquant", { code: "CFG_MISSING" });
  return cfg;
}

async function getAuthHeader(cfg) {
  const type = String(cfg.auth.type || "").toLowerCase();
  if (type === "bearer") {
    if (!cfg.auth.token) throw new ConnectorError("FR PDP: auth.token manquant", { code: "CFG_MISSING" });
    return { authorization: `Bearer ${cfg.auth.token}` };
  }
  if (type === "apikey") {
    if (!cfg.auth.apiKey) throw new ConnectorError("FR PDP: auth.apiKey manquant", { code: "CFG_MISSING" });
    const header = cfg.auth.headerName || "x-api-key";
    return { [header]: cfg.auth.apiKey };
  }
  throw new ConnectorError(`FR PDP: auth.type non supporté (${cfg.auth.type})`, { code: "CFG_INVALID" });
}

function makeClient(cfgIn) {
  const cfg = requireCfg(cfgIn);

  return {
    name: "FR_PDP",

    async testConnection() {
      telemetry.info("[FR_PDP] testConnection");
      const auth = await getAuthHeader(cfg);

      // Endpoint "health" dépend de la PDP. On met un fallback.
      const url = `${cfg.baseUrl.replace(/\/$/, "")}${cfg.healthPath || "/health"}`;
      const res = await request(url, {
        method: "GET",
        headers: { ...auth, accept: "application/json" },
        timeoutMs: cfg.timeoutMs || 15000,
        retries: 1,
        tls: cfg.tls || null,
      });

      return { ok: true, vendor: cfg.vendor || "pdp", status: res.status, data: res.data };
    },

    async sendInvoice({ ublXml, metadata }) {
      // La PDP peut accepter UBL, Factur-X, etc. Ici on assume UBL XML.
      if (!ublXml) throw new ConnectorError("FR PDP: ublXml manquant", { code: "INVALID_INPUT" });

      const auth = await getAuthHeader(cfg);
      const url = `${cfg.baseUrl.replace(/\/$/, "")}${cfg.submitInvoicePath || "/invoices"}`;

      telemetry.info("[FR_PDP] sendInvoice", { hasMeta: !!metadata });

      const res = await request(url, {
        method: "POST",
        headers: { ...auth, ...jsonHeaders({ "content-type": "application/xml" }) },
        body: String(ublXml),
        timeoutMs: cfg.timeoutMs || 30000,
        retries: 2,
        tls: cfg.tls || null,
      });

      // Normalisation réponse
      return {
        ok: true,
        connector: "FR_PDP",
        remote_id: res.data?.id || res.data?.remote_id || null,
        status: res.data?.status || "submitted",
        raw: res.data,
      };
    },

    async getStatus({ remote_id }) {
      if (!remote_id) throw new ConnectorError("FR PDP: remote_id manquant", { code: "INVALID_INPUT" });

      const auth = await getAuthHeader(cfg);
      const url = `${cfg.baseUrl.replace(/\/$/, "")}${(cfg.statusPath || "/invoices/:id").replace(":id", encodeURIComponent(remote_id))}`;

      const res = await request(url, {
        method: "GET",
        headers: { ...auth, accept: "application/json" },
        timeoutMs: cfg.timeoutMs || 15000,
        retries: 1,
        tls: cfg.tls || null,
      });

      return { ok: true, status: res.data?.status || "unknown", raw: res.data };
    },
  };
}

module.exports = { makeClient };
