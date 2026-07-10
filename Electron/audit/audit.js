"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const https = require("node:https");
const { spawnSync } = require("node:child_process");

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmacSha256Hex(secret, data) {
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getAuditLogPath(app) {
  const base =
    app && typeof app.getPath === "function"
      ? app.getPath("userData")
      : process.cwd();

  const dir = path.join(base, "audit");
  ensureDir(dir);
  return path.join(dir, "audit.log.jsonl");
}

// lecture efficace de la dernière ligne (sans charger tout le fichier)
function readLastLine(file) {
  if (!fs.existsSync(file)) return null;

  const stat = fs.statSync(file);
  if (!stat.size) return null;

  const fd = fs.openSync(file, "r");
  try {
    // lire les derniers ~64 KB max
    const chunkSize = Math.min(64 * 1024, stat.size);
    const buf = Buffer.alloc(chunkSize);
    fs.readSync(fd, buf, 0, chunkSize, stat.size - chunkSize);

    const s = buf.toString("utf8");
    const lines = s.trimEnd().split("\n");
    return lines.length ? lines[lines.length - 1] : null;
  } finally {
    fs.closeSync(fd);
  }
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/*  RFC3161 TSA                                                       */
/*  On fabrique un TSQ valide via openssl, puis POST au TSA.           */
/* ------------------------------------------------------------------ */

function buildTsaQueryWithOpenSSL(hashHex) {
  // Génère une requête TSA RFC3161 (TimeStampReq) à partir du digest SHA-256
  // On passe le digest via un petit fichier temporaire.
  const tmpBase = path.join(
    os.tmpdir(),
    `audit_tsa_${crypto.randomBytes(8).toString("hex")}`
  );
  const digestFile = `${tmpBase}.digest`;
  const tsqFile = `${tmpBase}.tsq`;

  fs.writeFileSync(digestFile, Buffer.from(hashHex, "hex"));

  const r = spawnSync(
    "openssl",
    ["ts", "-query", "-digest", hashHex, "-sha256", "-no_nonce", "-out", tsqFile],
    { encoding: "utf8" }
  );

  // Certaines versions d'openssl n'acceptent pas -digest <hex> (selon build)
  // fallback: -data <file>
  if (r.status !== 0 || !fs.existsSync(tsqFile)) {
    const r2 = spawnSync(
      "openssl",
      ["ts", "-query", "-data", digestFile, "-sha256", "-no_nonce", "-out", tsqFile],
      { encoding: "utf8" }
    );
    if (r2.status !== 0 || !fs.existsSync(tsqFile)) {
      try {
        fs.unlinkSync(digestFile);
      } catch {}
      throw new Error(
        `OpenSSL ts query failed: ${((r2.stderr || r.stderr || "")).trim() || "unknown"}`
      );
    }
  }

  const tsq = fs.readFileSync(tsqFile);

  try {
    fs.unlinkSync(digestFile);
  } catch {}
  try {
    fs.unlinkSync(tsqFile);
  } catch {}

  return tsq;
}

function postTsa(tsaUrl, tsqBuffer) {
  return new Promise((resolve, reject) => {
    const u = new URL(tsaUrl);
    const req = https.request(
      {
        method: "POST",
        hostname: u.hostname,
        path: u.pathname + (u.search || ""),
        port: u.port || 443,
        headers: {
          "Content-Type": "application/timestamp-query",
          "Content-Length": tsqBuffer.length,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          // TSA renvoie un TimeStampResp (TSR) en DER
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body.toString("base64"));
          } else {
            reject(
              new Error(
                `TSA HTTP ${res.statusCode}: ${body.toString("utf8").slice(0, 200)}`
              )
            );
          }
        });
      }
    );
    req.on("error", reject);
    req.write(tsqBuffer);
    req.end();
  });
}

/* ------------------------------------------------------------------ */
/*  Append audit event (SYNC, best-effort TSA en 2e event)             */
/* ------------------------------------------------------------------ */

function appendAuditEvent({
  logPath,
  hmacSecret,
  tsaUrl, // optionnel
  actor,
  action,
  entityType,
  entityId,
  payload = {},
  refs = {}, // optionnel (PAF: numero, totals, etc.)
  appMeta = {}, // optionnel (version, machine, etc.)
}) {
  if (!logPath) throw new Error("AUDIT: logPath manquant");

  ensureDir(path.dirname(logPath));

  // chaîne: récupérer prev_hash + seq
  let prevHash = null;
  let prevSeq = 0;

  const lastLine = readLastLine(logPath);
  if (lastLine) {
    const last = safeJsonParse(lastLine);
    if (last && last.hash) prevHash = last.hash;
    if (last && typeof last.seq === "number") prevSeq = last.seq;
  }

  const core = {
    ts: nowIso(),
    seq: prevSeq + 1,
    actor: actor || "system",
    action: String(action || ""),
    entityType: entityType || "",
    entityId: entityId == null ? "" : String(entityId),
    refs: refs && typeof refs === "object" ? refs : {},
    payload: payload && typeof payload === "object" ? payload : {},
    prev_hash: prevHash,
    app: appMeta && typeof appMeta === "object" ? appMeta : {},
  };

  const canonical = JSON.stringify(core);
  const hash = sha256Hex(canonical);
  const hmac = hmacSha256Hex(hmacSecret, canonical);

  const evt = { ...core, hash };
  if (hmac) evt.hmac = hmac;

  fs.appendFileSync(logPath, JSON.stringify(evt) + "\n", {
    encoding: "utf8",
    flag: "a",
  });

  // TSA best-effort : on ne modifie jamais evt -> on ajoute un event "audit.tsa"
  if (tsaUrl) {
    void (async () => {
      try {
        const tsq = buildTsaQueryWithOpenSSL(hash);
        const tsrB64 = await postTsa(tsaUrl, tsq);

        // évènement TSA chaîné aussi (append-only)
        appendAuditEvent({
          logPath,
          hmacSecret,
          tsaUrl: null, // évite boucle
          actor: actor || "system",
          action: "audit.tsa",
          entityType: "audit",
          entityId: hash, // on référence l'event hash
          refs: { target_hash: hash, tsa_url: tsaUrl },
          payload: { tsr_base64: tsrB64 },
          appMeta,
        });
      } catch (e) {
        // on trace l'échec TSA aussi (append-only)
        try {
          appendAuditEvent({
            logPath,
            hmacSecret,
            tsaUrl: null,
            actor: actor || "system",
            action: "audit.tsa_error",
            entityType: "audit",
            entityId: hash,
            refs: { target_hash: hash, tsa_url: tsaUrl },
            payload: { error: e?.message || String(e) },
            appMeta,
          });
        } catch {
          // silence total (ne jamais casser)
        }
      }
    })();
  }

  return { ok: true, hash, seq: core.seq };
}

/* ------------------------------------------------------------------ */
/*  Read audit log (simple)                                            */
/*  - sinceSeq: retourne les events avec seq > sinceSeq                */
/*  - limit: max events retournés                                      */
/*  NOTE: version simple (lit le fichier). Suffisant au début.         */
/* ------------------------------------------------------------------ */

function readAuditLog({ logPath, limit = 500, sinceSeq = 0 } = {}) {
  try {
    if (!logPath) throw new Error("AUDIT: logPath manquant");

    if (!fs.existsSync(logPath)) {
      return { ok: true, logPath, entries: [], nextSinceSeq: sinceSeq };
    }

    const raw = fs.readFileSync(logPath, "utf8").trim();
    if (!raw) return { ok: true, logPath, entries: [], nextSinceSeq: sinceSeq };

    const lines = raw.split("\n");

    const out = [];
    let maxSeq = sinceSeq;

    for (let i = 0; i < lines.length; i++) {
      const evt = safeJsonParse(lines[i]);
      if (!evt) continue;

      const seq = typeof evt.seq === "number" ? evt.seq : 0;
      if (seq <= sinceSeq) continue;

      out.push(evt);
      if (seq > maxSeq) maxSeq = seq;

      if (out.length >= limit) break;
    }

    return { ok: true, logPath, entries: out, nextSinceSeq: maxSeq };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), logPath };
  }
}

/* ------------------------------------------------------------------ */
/*  Verify audit log                                                   */
/*  - vérifie hash + HMAC + chain                                      */
/*  - vérifie que audit.tsa/audit.tsa_error référencent un hash existant */
/* ------------------------------------------------------------------ */

function verifyAuditLog({ logPath, hmacSecret }) {
  if (!fs.existsSync(logPath)) {
    return { ok: false, error: "audit log absent" };
  }

  const raw = fs.readFileSync(logPath, "utf8").trim();
  if (!raw) return { ok: true, entries: 0, tsa: { ok: true, receipts: 0, errors: 0 } };

  const lines = raw.split("\n");

  let prevHash = null;
  let prevSeq = 0;

  const seenHashes = new Set();
  let tsaReceipts = 0;
  let tsaErrors = 0;

  for (let i = 0; i < lines.length; i++) {
    const evt = safeJsonParse(lines[i]);
    if (!evt) return { ok: false, index: i, error: "json invalid" };

    const { hash, hmac, ...core } = evt;

    // 1) chain + seq
    if (i === 0) {
      // first event: prev_hash doit être null/undefined/"" (tolérant)
    } else {
      if (core.prev_hash !== prevHash) return { ok: false, index: i, error: "chain broken" };
      if (typeof core.seq === "number" && core.seq !== prevSeq + 1)
        return { ok: false, index: i, error: "seq broken" };
    }

    // 2) hash/hmac sur core ONLY (jamais sur des champs dérivés)
    const canonical = JSON.stringify(core);
    const computedHash = sha256Hex(canonical);
    if (computedHash !== hash) return { ok: false, index: i, error: "hash mismatch" };

    if (hmacSecret && hmac) {
      const computedHmac = hmacSha256Hex(hmacSecret, canonical);
      if (computedHmac !== hmac) return { ok: false, index: i, error: "hmac mismatch" };
    }

    // 3) indexation
    seenHashes.add(hash);

    // 4) TSA receipts référencent un hash existant (pas forcément déjà vu si receipt arrive après)
    if (core.action === "audit.tsa") {
      tsaReceipts++;
      const target = core.refs?.target_hash || core.entityId;
      if (target && !seenHashes.has(String(target))) {
        return { ok: false, index: i, error: "tsa references unknown hash" };
      }
    }
    if (core.action === "audit.tsa_error") {
      tsaErrors++;
      const target = core.refs?.target_hash || core.entityId;
      if (target && !seenHashes.has(String(target))) {
        return { ok: false, index: i, error: "tsa_error references unknown hash" };
      }
    }

    prevHash = hash;
    prevSeq = typeof core.seq === "number" ? core.seq : prevSeq + 1;
  }

  return {
    ok: true,
    entries: lines.length,
    tsa: { ok: true, receipts: tsaReceipts, errors: tsaErrors },
    last_hash: prevHash,
    last_seq: prevSeq,
  };
}

/* ------------------------------------------------------------------ */
/*  Exports                                                           */
/* ------------------------------------------------------------------ */

module.exports = {
  appendAuditEvent,
  verifyAuditLog,
  getAuditLogPath,
  readAuditLog, // ✅ lecteur (compatible audit.ipc.js)
};
