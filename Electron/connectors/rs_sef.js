"use strict";

const { request, jsonHeaders } = require("./httpClient");
const { ConnectorError } = require("./errors");
const telemetry = require("./telemetry");

/**
 * Serbie: SEF direct.
 * NOTE: les chemins & auth réels dépendent de ton mode d'intégration SEF.
 */

function requireCfg(cfg) {
  if (!cfg?.baseUrl) throw new ConnectorError("RS SEF: baseUrl manquant", { code: "CFG_MISSING" });
  if (!cfg?.auth?.type) throw new ConnectorError("RS SEF: auth.type manquant", { code: "CFG_MISSING" });
  return cfg;
}

async function getAuthHeader(cfg) {
  const type = String(cfg.auth.type || "").toLowerCase();
  if (type === "bearer") {
    if (!cfg.auth.token) throw new ConnectorError("RS SEF: auth.token manquant", { code: "CFG_MISSING" });
    return { authorization: `Bearer ${cfg.auth.token}` };
  }
  if (type === "basic") {
    if (!cfg.auth.username || !cfg.auth.password) {
      throw new ConnectorError("RS SEF: basic auth incomplete", { code: "CFG_MISSING" });
    }
    const b64 = Buffer.from(`${cfg.auth.username}:${cfg.auth.password}`, "utf-8").toString("base64");
    return { authorization: `Basic ${b64}` };
  }
  throw new ConnectorError(`RS SEF: auth.type non supporté (${cfg.auth.type})`, { code: "CFG_INVALID" });
}

function makeClient(cfgIn) {
  const cfg = requireCfg(cfgIn);

  return {
    name: "RS_SEF",

    async testConnection() {
      telemetry.info("[RS_SEF] testConnection");
      const auth = await getAuthHeader(cfg);
      const url = `${cfg.baseUrl.replace(/\/$/, "")}${cfg.healthPath || "/health"}`;

      const res = await request(url, {
        method: "GET",
        headers: { ...auth, accept: "application/json" },
        timeoutMs: cfg.timeoutMs || 15000,
        retries: 1,
        tls: cfg.tls || null,
      });

      return { ok: true, status: res.status, data: res.data };
    },

    async sendInvoice({ ublXml, metadata }) {
      if (!ublXml) throw new ConnectorError("RS SEF: ublXml manquant", { code: "INVALID_INPUT" });

      const auth = await getAuthHeader(cfg);
      const url = `${cfg.baseUrl.replace(/\/$/, "")}${cfg.submitInvoicePath || "/invoices"}`;

      telemetry.info("[RS_SEF] sendInvoice", { hasMeta: !!metadata });

      const res = await request(url, {
        method: "POST",
        headers: { ...auth, ...jsonHeaders({ "content-type": "application/xml" }) },
        body: String(ublXml),
        timeoutMs: cfg.timeoutMs || 30000,
        retries: 2,
        tls: cfg.tls || null,
      });

      return {
        ok: true,
        connector: "RS_SEF",
        remote_id: res.data?.id || res.data?.remote_id || null,
        status: res.data?.status || "submitted",
        raw: res.data,
      };
    },

    async getStatus({ remote_id }) {
      if (!remote_id) throw new ConnectorError("RS SEF: remote_id manquant", { code: "INVALID_INPUT" });

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
