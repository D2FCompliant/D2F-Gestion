"use strict";

const fs = require("fs");
const https = require("https");
const { ConnectorError } = require("./errors");

/**
 * Simple HTTP client for Node/Electron main process.
 * - retries with backoff
 * - timeout
 * - optional mTLS
 * - JSON helpers
 *
 * Uses global fetch (Node 18+). If your Electron/Node is older, swap to undici.
 */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildHttpsAgent(tls = {}) {
  const {
    caPath,
    certPath,
    keyPath,
    passphrase,
    rejectUnauthorized = true,
  } = tls || {};

  // If no TLS options, let fetch use default agent
  if (!caPath && !certPath && !keyPath && typeof rejectUnauthorized === "undefined") return null;

  const agentOpts = {
    rejectUnauthorized: rejectUnauthorized !== false,
  };

  if (caPath) agentOpts.ca = fs.readFileSync(caPath);
  if (certPath) agentOpts.cert = fs.readFileSync(certPath);
  if (keyPath) agentOpts.key = fs.readFileSync(keyPath);
  if (passphrase) agentOpts.passphrase = passphrase;

  return new https.Agent(agentOpts);
}

async function request(url, opts = {}) {
  const {
    method = "GET",
    headers = {},
    body = undefined,
    timeoutMs = 15000,
    retries = 1,
    retryDelayMs = 400,
    retryOn = (status) => status === 429 || (status >= 500 && status <= 599),
    tls = null,
    parseJson = true,
  } = opts;

  const agent = buildHttpsAgent(tls);

  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
        ...(agent ? { agent } : {}),
      });

      const text = await res.text().catch(() => "");
      const contentType = res.headers.get("content-type") || "";
      const isJson = contentType.includes("application/json");

      let data = text;
      if (parseJson && (isJson || text?.startsWith("{") || text?.startsWith("["))) {
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          // keep raw text if JSON parse fails
          data = text;
        }
      }

      if (!res.ok) {
        const err = new ConnectorError(`HTTP ${res.status} ${res.statusText}`, {
          code: "HTTP_ERROR",
          httpStatus: res.status,
          details: { url, method, bodySent: !!body, response: data },
          retryable: retryOn(res.status),
        });

        if (attempt < retries && err.retryable) {
          await sleep(retryDelayMs * Math.pow(2, attempt));
          continue;
        }
        throw err;
      }

      return { status: res.status, headers: res.headers, data, rawText: text };
    } catch (e) {
      lastErr = e;

      const isAbort = e?.name === "AbortError";
      const retryable = isAbort || e?.retryable === true;

      if (attempt < retries && retryable) {
        await sleep(retryDelayMs * Math.pow(2, attempt));
        continue;
      }
      throw e;
    } finally {
      clearTimeout(t);
    }
  }

  throw lastErr || new ConnectorError("HTTP request failed", { code: "HTTP_FAILED" });
}

function jsonHeaders(extra = {}) {
  return { "content-type": "application/json", accept: "application/json", ...extra };
}

module.exports = { request, jsonHeaders };
