"use strict";

const express = require("express");
const getRawBody = require("raw-body");
const crypto = require("crypto");

function hmacSha256(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Server webhook (gateway-like)
 * - POST /inbound/invoices  (Content-Type: application/xml)
 * - Header X-Signature: sha256=<hex>  (HMAC of raw body)
 */
function createWebhookServer({ secret, onPayload }) {
  const app = express();

  app.post("/inbound/invoices", async (req, res) => {
    try {
      const raw = await getRawBody(req, { limit: "20mb" }); // Buffer
      const sig = String(req.headers["x-signature"] || "").trim();
      const ct = String(req.headers["content-type"] || "application/xml");
      const filename = String(req.headers["x-filename"] || "inbound.xml");
      const sourceName = String(req.headers["x-source-name"] || "PDP-WEBHOOK");

      if (secret) {
        const expected = `sha256=${hmacSha256(secret, raw)}`;
        if (sig !== expected) {
          return res.status(401).json({ ok: false, error: "bad signature" });
        }
      }

      const meta = {
        http: {
          ip: req.ip,
          ua: req.headers["user-agent"] || "",
          headers: {
            messageId: req.headers["x-message-id"] || "",
            conversationId: req.headers["x-conversation-id"] || "",
          },
        },
      };

      const out = await onPayload({
        filename,
        contentType: ct,
        payload: raw,
        sourceName,
        meta,
      });

      return res.status(200).json({ ok: true, id: out?.id || null, duplicate: !!out?.duplicate });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  return app;
}

module.exports = { createWebhookServer };
