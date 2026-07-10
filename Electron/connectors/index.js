"use strict";

const { toConnectorError, ConnectorError } = require("./errors");
const fr = require("./fr_pdp");
const rs = require("./rs_sef");
const es = require("./es_face");
const peppol = require("./peppol_ap");

/**
 * cfg attendu (exemple):
 * {
 *   fr: { pdp: { baseUrl, auth, tls?, ... } },
 *   rs: { sef: { baseUrl, auth, tls?, ... } },
 *   es: { face: { baseUrl, tls?, ... } },
 *   intl: { peppol: { baseUrl, auth, ... } }
 * }
 */

function makeRegistry(config = {}) {
  const clients = {
    FR_PDP: fr.makeClient(config?.fr?.pdp || {}),
    RS_SEF: rs.makeClient(config?.rs?.sef || {}),
    ES_FACE: es.makeClient(config?.es?.face || {}),
    PEPPOL_AP: peppol.makeClient(config?.intl?.peppol || {}),
  };

  function pickConnector({ country, mode }) {
    const c = String(country || "").toUpperCase();

    // mode: "einvoicing" | "ereporting" | "international"
    const m = String(mode || "").toLowerCase();

    if (m === "international") return clients.PEPPOL_AP;

    if (c === "FR") return clients.FR_PDP;
    if (c === "RS") return clients.RS_SEF;
    if (c === "ES") return clients.ES_FACE;

    // fallback international
    return clients.PEPPOL_AP;
  }

  return {
    clients,

    pickConnector,

    async testAll() {
      const out = {};
      for (const [k, cli] of Object.entries(clients)) {
        try {
          out[k] = await cli.testConnection();
        } catch (e) {
          const err = toConnectorError(e, "TEST_FAILED");
          out[k] = { ok: false, code: err.code, message: err.message, details: err.details || null };
        }
      }
      return out;
    },

    async sendInvoice({ country, ublXml, metadata, mode = "einvoicing" }) {
      try {
        const cli = pickConnector({ country, mode });
        if (!cli?.sendInvoice) throw new ConnectorError("Connecteur: sendInvoice indisponible", { code: "NOT_SUPPORTED" });
        return await cli.sendInvoice({ ublXml, metadata });
      } catch (e) {
        throw toConnectorError(e, "SEND_FAILED");
      }
    },

    async getStatus({ country, remote_id, mode = "einvoicing" }) {
      try {
        const cli = pickConnector({ country, mode });
        if (!cli?.getStatus) throw new ConnectorError("Connecteur: getStatus indisponible", { code: "NOT_SUPPORTED" });
        return await cli.getStatus({ remote_id });
      } catch (e) {
        throw toConnectorError(e, "STATUS_FAILED");
      }
    },
  };
}

module.exports = { makeRegistry };
