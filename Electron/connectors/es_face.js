"use strict";

const { request, jsonHeaders } = require("./httpClient");
const { ConnectorError } = require("./errors");
const telemetry = require("./telemetry");

/**
 * Espagne (B2G): FACe.
 * FACe est historiquement SOAP/WS + certificats. Ici on met un wrapper "HTTP" générique;
 * si tu es en SOAP, tu remplaceras request() par un client SOAP.
 */

function requireCfg(cfg) {
  if (!cfg?.baseUrl) throw new ConnectorError("ES FACe: baseUrl manquant", { code: "CFG_MISSING" });
  // Souvent mTLS obligatoire -> cfg.tls conseillé
  return cfg;
}

function makeClient(cfgIn) {
  const cfg = requireCfg(cfgIn);

  return {
    name: "ES_FACE",

    async testConnection() {
      telemetry.info("[ES_FACE] testConnection");
      const url = `${cfg.baseUrl.replace(/\/$/, "")}${cfg.healthPath || "/health"}`;

      const res = await request(url, {
        method: "GET",
        headers: { accept: "application/json" },
        timeoutMs: cfg.timeoutMs || 15000,
        retries: 1,
        tls: cfg.tls || null,
      });

      return { ok: true, status: res.status, data: res.data };
    },

    async sendInvoice({ ublXml, metadata }) {
      if (!ublXml) throw new ConnectorError("ES FACe: ublXml manquant", { code: "INVALID_INPUT" });

      const url = `${cfg.baseUrl.replace(/\/$/, "")}${cfg.submitInvoicePath || "/invoices"}`;

      telemetry.info("[ES_FACE] sendInvoice", { hasMeta: !!metadata });

      const res = await request(url, {
        method: "POST",
        headers: { ...jsonHeaders({ "content-type": "application/xml" }) },
        body: String(ublXml),
        timeoutMs: cfg.timeoutMs || 30000,
        retries: 2,
        tls: cfg.tls || null,
      });

      return {
        ok: true,
        connector: "ES_FACE",
        remote_id: res.data?.id || res.data?.remote_id || null,
        status: res.data?.status || "submitted",
        raw: res.data,
      };
    },

    async getStatus({ remote_id }) {
      if (!remote_id) throw new ConnectorError("ES FACe: remote_id manquant", { code: "INVALID_INPUT" });

      const url = `${cfg.baseUrl.replace(/\/$/, "")}${(cfg.statusPath || "/invoices/:id").replace(":id", encodeURIComponent(remote_id))}`;

      const res = await request(url, {
        method: "GET",
        headers: { accept: "application/json" },
        timeoutMs: cfg.timeoutMs || 15000,
        retries: 1,
        tls: cfg.tls || null,
      });

      return { ok: true, status: res.data?.status || "unknown", raw: res.data };
    },
  };
}

module.exports = { makeClient };
