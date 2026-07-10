"use strict";

/**
 * xp-z12-012.js
 * - Charge un JSON de motifs de refus (XP Z12-012)
 * - Remplit le <select id="rejectCodeSelect">
 * - Stratégie: IPC Electron -> fallback fetch
 */

(function () {
  const SELECT_ID = "rejectCodeSelect";
  const DEFAULT_JSON_URL = "./xp-z12-012.json"; // fallback navigateur seulement

  function warn(...args) {
    console.warn("[xp-z12-012]", ...args);
  }
  function log(...args) {
    console.log("[xp-z12-012]", ...args);
  }
  function $(id) {
    return document.getElementById(id);
  }
  function getApi() {
    return window.api || window.d2f || null;
  }

  function normalizeReasons(data) {
    if (data && Array.isArray(data.rejection_reasons)) return data.rejection_reasons;
    if (data && Array.isArray(data.reasons)) return data.reasons;
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    if (data && Array.isArray(data.list)) return data.list;
    return [];
  }

  function toOption(r) {
    const code = String(r?.code || r?.id || r?.rf || r?.reason_code || "").trim().toUpperCase();
    const label = String(r?.label || r?.title || r?.reason || r?.name || r?.text || "").trim();
    if (!code && !label) return null;
    return { value: code || label, text: label ? `${code} — ${label}` : code };
  }

  function fillSelect(selectEl, reasons) {
    selectEl.innerHTML = "";

    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "— choisir un motif —";
    selectEl.appendChild(opt0);

    const opts = [];
    for (const r of reasons) {
      const o = toOption(r);
      if (o) opts.push(o);
    }
    opts.sort((a, b) => a.value.localeCompare(b.value, "fr"));

    for (const o of opts) {
      const op = document.createElement("option");
      op.value = o.value;
      op.textContent = o.text;
      selectEl.appendChild(op);
    }
    return opts.length;
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
    return await res.json();
  }

  async function loadReasonsViaIpc() {
    const api = getApi();
    if (api?.rejectionReasons?.load) return await api.rejectionReasons.load();
    if (api?.xpReject?.load) return await api.xpReject.load();
    return null;
  }

  async function loadAndFill(url = DEFAULT_JSON_URL) {
    const sel = $(SELECT_ID);
    if (!sel) return;

    try {
      const data = (await loadReasonsViaIpc()) ?? (await fetchJson(url));
      const reasons = normalizeReasons(data);
      const n = fillSelect(sel, reasons);
      if (!n) warn("JSON chargé mais aucune raison détectée.");
      else log(`Motifs chargés: ${n}`);
    } catch (e) {
      warn("Impossible de charger le JSON motifs:", e?.message || e);
      sel.innerHTML = `
        <option value="">— choisir un motif —</option>
        <option value="RF99">RF99 — Autre (commentaire obligatoire)</option>
      `;
    }
  }

  window.XP_Z12_012 = { loadAndFill, url: DEFAULT_JSON_URL };

  document.addEventListener("DOMContentLoaded", () => {
    loadAndFill().catch(() => {});
  });
})();
