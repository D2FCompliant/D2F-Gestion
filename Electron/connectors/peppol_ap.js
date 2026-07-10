"use strict";

const { request, jsonHeaders } = require("./httpClient");
const { ConnectorError } = require("./errors");
const telemetry = require("./telemetry");

/**
 * PEPPOL: envoi via Access Point (AP) — en général via l'API du prestataire AP.
 * Ce connecteur est générique: tu lui donnes baseUrl + auth + chemins API.
 */

function requireCfg(cfg) {
  if (!cfg?.baseUrl) throw new ConnectorError("PEPPOL AP: baseUrl manquant", { code: "CFG_MISSING" });
  if (!cfg?.auth?.type) throw new ConnectorError("PEPPOL AP: auth.type manquant", { code: "CFG_MISSING" });
  return cfg;
}

async function getAuthHeader(cfg) {
  const type = String(cfg.auth.type || "").toLowerCase();
  if (type === "bearer") {
    if (!cfg.auth.token) throw new ConnectorError("PEPPOL AP: auth.token manquant", { code: "CFG_MISSING" });
    return { authorization: `Bearer ${cfg.auth.token}` };
  }
  if (type === "apikey") {
    if (!cfg.auth.apiKey) throw new ConnectorError("PEPPOL AP: auth.apiKey manquant", { code: "CFG_MISSING" });
    const header = cfg.auth.headerName || "x-api-key";
    return { [header]: cfg.auth.apiKey };
  }
  throw new ConnectorError(`PEPPOL AP: auth.type non supporté (${cfg.auth.type})`, { code: "CFG_INVALID" });
}

function makeClient(cfgIn) {
  const cfg = requireCfg(cfgIn);

  return {
    name: "PEPPOL_AP",

    async testConnection() {
      telemetry.info("[PEPPOL_AP] testConnection");
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
      if (!ublXml) throw new ConnectorError("PEPPOL AP: ublXml manquant", { code: "INVALID_INPUT" });

      const auth = await getAuthHeader(cfg);
      const url = `${cfg.baseUrl.replace(/\/$/, "")}${cfg.submitInvoicePath || "/documents"}`;

      // metadata typique: receiver endpoint, scheme, docType, processId, etc.
      telemetry.info("[PEPPOL_AP] sendInvoice", {
        receiver: metadata?.receiverEndpoint || null,
        docType: metadata?.docType || null,
      });

      const payload = {
        format: metadata?.format || "UBL",
        profile: metadata?.profile || "peppol-bis3",
        receiverEndpoint: metadata?.receiverEndpoint || "",
        receiverScheme: metadata?.receiverScheme || "",
        docType: metadata?.docType || "",
        processId: metadata?.processId || "",
        fileName: metadata?.fileName || "invoice.xml",
        // souvent les AP prennent du base64 plutôt que du XML direct
        content: Buffer.from(String(ublXml), "utf-8").toString("base64"),
      };

      const res = await request(url, {
        method: "POST",
        headers: { ...auth, ...jsonHeaders() },
        body: JSON.stringify(payload),
        timeoutMs: cfg.timeoutMs || 30000,
        retries: 2,
        tls: cfg.tls || null,
      });

      return {
        ok: true,
        connector: "PEPPOL_AP",
        remote_id: res.data?.id || res.data?.messageId || res.data?.remote_id || null,
        status: res.data?.status || "submitted",
        raw: res.data,
      };
    },

    async getStatus({ remote_id }) {
      if (!remote_id) throw new ConnectorError("PEPPOL AP: remote_id manquant", { code: "INVALID_INPUT" });

      const auth = await getAuthHeader(cfg);
      const url = `${cfg.baseUrl.replace(/\/$/, "")}${(cfg.statusPath || "/documents/:id").replace(":id", encodeURIComponent(remote_id))}`;

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
