"use strict";

(function () {
  const $ = (id) => document.getElementById(id);

  const el = {
    path: $("auditPathPill"),
    status: $("auditStatusPill"),
    since: $("auditSinceSeq"),
    limit: $("auditLimit"),
    btnRead: $("auditBtnRead"),
    btnVerify: $("auditBtnVerify"),
    btnCopy: $("auditBtnCopy"),
    list: $("auditList"),
    detail: $("auditDetail"),

    // Results panel (right card)
    resultsVerify: $("auditVerifyResult"),
    resultsRead: $("auditReadResult"),
    resultsLastSeq: $("auditLastSeq"),
    resultsLastHash: $("auditLastHash"),
    resultsLog: $("auditResultsLog"),
  };

  if (!el.list || !el.detail) return;

  const state = {
    events: [],
    selectedSeq: null,
    showRaw: true, // tu affiches du JSON brut par défaut
    filter: {
      q: "",
      action: "",
      entity: "",
      level: "ALL",
    },
  };

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmtIso(iso) {
    const v = String(iso || "").trim();
    if (!v) return "—";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return v;
    return d.toLocaleString("fr-FR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function inferLevel(e) {
    const ok = e?.ok;
    if (ok === true) return "OK";
    if (ok === false) return "FAIL";
    const a = String(e?.action || "").toLowerCase();
    if (a.includes("fail") || a.includes("error") || a.includes("reject")) return "FAIL";
    if (a.includes("warn")) return "WARN";
    return "OK";
  }

  function summarize(e) {
    const seq = e?.seq ?? "—";
    const ts = fmtIso(e?.ts || e?.timestamp || e?.created_at);
    const action = e?.action || "—";
    const entity = e?.entityType || e?.entity || e?.entity_type || "—";
    const entityId = e?.entityId || e?.entity_id || e?.id || "";
    const actor = e?.actor || e?.user || "—";
    const level = inferLevel(e);

    let msg = "";
    const p = e?.payload;
    if (p && typeof p === "object") {
      if (p.message) msg = String(p.message);
      else if (p.reason) msg = String(p.reason);
      else if (p.error) msg = String(p.error);
      else if (p.fields && Array.isArray(p.fields)) msg = `fields: ${p.fields.join(", ")}`;
    }

    return { seq, ts, action, entity, entityId, actor, level, msg };
  }

  function getActions(events) {
    const set = new Set();
    for (const e of events) {
      const a = String(e?.action || "").trim();
      if (a) set.add(a);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  function getEntities(events) {
    const set = new Set();
    for (const e of events) {
      const t = String(e?.entityType || e?.entity || e?.entity_type || "").trim();
      if (t) set.add(t);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  function matchesFilter(e) {
    const s = summarize(e);
    const q = state.filter.q.trim().toLowerCase();

    if (q) {
      const hay =
        `${s.seq} ${s.ts} ${s.action} ${s.entity} ${s.entityId} ${s.actor} ${s.msg}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    if (state.filter.action && s.action !== state.filter.action) return false;
    if (state.filter.entity && s.entity !== state.filter.entity) return false;
    if (state.filter.level !== "ALL" && s.level !== state.filter.level) return false;

    return true;
  }

  // -----------------------------
  // UI helpers (pills + log)
  // -----------------------------
  function setPill(node, text, level) {
    if (!node) return;
    node.textContent = text;
    node.classList.remove("is-ok", "is-warn", "is-fail");
    if (level === "OK") node.classList.add("is-ok");
    else if (level === "WARN") node.classList.add("is-warn");
    else if (level === "FAIL") node.classList.add("is-fail");
  }

  function appendLog(line) {
    if (!el.resultsLog) return;
    const ts = new Date().toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const cur = el.resultsLog.textContent || "";
    el.resultsLog.textContent = `${cur}\n[${ts}] ${line}`.trim();
    el.resultsLog.scrollTop = el.resultsLog.scrollHeight;
  }

  function updateLastFromEvents() {
    if (!el.resultsLastSeq || !el.resultsLastHash) return;

    if (!Array.isArray(state.events) || state.events.length === 0) {
      el.resultsLastSeq.textContent = "—";
      el.resultsLastHash.textContent = "—";
      return;
    }

    let last = state.events[0];
    for (const e of state.events) {
      if (Number(e?.seq) > Number(last?.seq)) last = e;
    }

    el.resultsLastSeq.textContent = String(last?.seq ?? "—");
    el.resultsLastHash.textContent = String(last?.hash ?? "—");
  }

  function flashStatus(text, level = "OK") {
    if (!el.status) return;

    const prev = el.status.textContent;
    el.status.textContent = text;

    el.status.classList.remove("pill--ok", "pill--warn", "pill--danger");
    el.status.classList.add(level === "FAIL" ? "pill--danger" : level === "WARN" ? "pill--warn" : "pill--ok");

    setTimeout(() => {
      el.status.textContent = prev;
      el.status.classList.remove("pill--ok", "pill--warn", "pill--danger");
    }, 1000);
  }

  // -----------------------------
  // Inject filters + detail buttons
  // -----------------------------
  function ensureUiChrome() {
    const wrap = el.list.parentElement;
    if (!wrap) return;

    // Filters bar above list
    if (!wrap.querySelector("[data-audit-controls]")) {
      const bar = document.createElement("div");
      bar.setAttribute("data-audit-controls", "1");
      bar.className = "searchRow";

      bar.innerHTML = `
        <input id="auditSearch" class="search" type="search"
               placeholder="Rechercher (action, client, facture…)" />
        <select id="auditFilterAction" aria-label="Action"></select>
        <select id="auditFilterEntity" aria-label="Entité"></select>
        <select id="auditFilterLevel" aria-label="Niveau">
          <option value="ALL">Tous</option>
          <option value="OK">OK</option>
          <option value="WARN">Alerte</option>
          <option value="FAIL">Erreur</option>
        </select>
      `;

      wrap.insertBefore(bar, el.list);

      const sInp = wrap.querySelector("#auditSearch");
      const aSel = wrap.querySelector("#auditFilterAction");
      const eSel = wrap.querySelector("#auditFilterEntity");
      const lSel = wrap.querySelector("#auditFilterLevel");

      let t = null;
      sInp.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => {
          state.filter.q = String(sInp.value || "");
          renderList();
        }, 120);
      });

      aSel.addEventListener("change", () => {
        state.filter.action = String(aSel.value || "");
        renderList();
      });

      eSel.addEventListener("change", () => {
        state.filter.entity = String(eSel.value || "");
        renderList();
      });

      lSel.addEventListener("change", () => {
        state.filter.level = String(lSel.value || "ALL");
        renderList();
      });
    }

    // Detail bar (buttons)
    const detailWrap = el.detail.parentElement;
    if (detailWrap && !detailWrap.querySelector("[data-audit-detailbar]")) {
      const bar = document.createElement("div");
      bar.setAttribute("data-audit-detailbar", "1");
      bar.className = "auditToolbar";

      bar.innerHTML = `
        <div class="auditToolbar__left">
          <button class="btn btn--secondary" type="button" id="auditToggleRaw">Afficher JSON brut</button>
          <button class="btn btn--ghost" type="button" id="auditCopyDetail">Copier le détail</button>
        </div>
      `;

      detailWrap.insertBefore(bar, el.detail);

      detailWrap.querySelector("#auditToggleRaw").addEventListener("click", () => {
        state.showRaw = !state.showRaw;
        detailWrap.querySelector("#auditToggleRaw").textContent = state.showRaw
          ? "Afficher résumé"
          : "Afficher JSON brut";
        renderDetail();
      });

      detailWrap.querySelector("#auditCopyDetail").addEventListener("click", async () => {
        const e = state.events.find((x) => Number(x?.seq) === Number(state.selectedSeq));
        if (!e) return;

        const s = summarize(e);

        const text = state.showRaw
          ? JSON.stringify(e, null, 2)
          : [
              `seq: ${s.seq}`,
              `date: ${s.ts}`,
              `niveau: ${s.level}`,
              `action: ${s.action}`,
              `entité: ${s.entity}`,
              `id: ${s.entityId || "—"}`,
              `acteur: ${s.actor}`,
              s.msg ? `info: ${s.msg}` : "",
            ]
              .filter(Boolean)
              .join("\n");

        try {
          await navigator.clipboard.writeText(text);
          flashStatus("Copié", "OK");
          appendLog("copy detail • OK");
        } catch {
          flashStatus("Copie impossible", "WARN");
          appendLog("copy detail • FAIL");
        }
      });
    }
  }

  function renderFilters() {
    const wrap = el.list.parentElement;
    if (!wrap) return;

    const aSel = wrap.querySelector("#auditFilterAction");
    const eSel = wrap.querySelector("#auditFilterEntity");
    if (!aSel || !eSel) return;

    const actions = getActions(state.events);
    const entities = getEntities(state.events);

    const curA = state.filter.action;
    const curE = state.filter.entity;

    aSel.innerHTML =
      `<option value="">Toutes actions</option>` +
      actions.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join("");

    eSel.innerHTML =
      `<option value="">Toutes entités</option>` +
      entities.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join("");

    aSel.value = curA;
    eSel.value = curE;
  }

  function renderList() {
    ensureUiChrome();
    renderFilters();

    const filtered = (state.events || []).filter(matchesFilter);

    if (!filtered.length) {
      el.list.innerHTML = `<div class="hint" style="padding:10px;">Aucun événement.</div>`;
      if (state.selectedSeq == null) el.detail.textContent = "{}";
      return;
    }

    el.list.innerHTML = filtered
      .map((e) => {
        const s = summarize(e);
        const selected = Number(state.selectedSeq) === Number(s.seq);
        const secondary = [s.entity, s.entityId ? `#${s.entityId}` : "", s.actor ? `• ${s.actor}` : ""]
          .filter(Boolean)
          .join(" ");
        const msg = s.msg ? ` — ${esc(s.msg)}` : "";

        return `
          <button type="button" class="auditItem ${selected ? "is-selected" : ""}" data-seq="${esc(s.seq)}">
            <div class="list__title" style="display:flex;align-items:center;gap:10px;min-width:0;">
              <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                ${esc(s.action)}${msg}
              </span>
              <span class="chip" style="margin-left:auto">${esc(s.level)}</span>
            </div>
            <div class="list__sub">${esc(s.ts)} • ${esc(secondary || "—")}</div>
          </button>
        `;
      })
      .join("");

    el.list.querySelectorAll("[data-seq]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.selectedSeq = Number(btn.getAttribute("data-seq"));
        renderList();
        renderDetail();
      });
    });

    if (state.selectedSeq == null) {
      state.selectedSeq = Number(summarize(filtered[0]).seq);
      renderList();
      renderDetail();
    }
  }

  function renderDetail() {
    const e = state.events.find((x) => Number(x?.seq) === Number(state.selectedSeq));
    if (!e) {
      el.detail.textContent = "{}";
      return;
    }

    if (state.showRaw) {
      el.detail.textContent = JSON.stringify(e, null, 2);
      return;
    }

    const s = summarize(e);
    const view = {
      seq: s.seq,
      date: s.ts,
      niveau: s.level,
      action: s.action,
      entite: s.entity,
      id: s.entityId || "",
      acteur: s.actor,
      hash: e?.hash || "",
      prev_hash: e?.prev_hash || "",
      refs: e?.refs || {},
      payload: e?.payload || {},
    };

    el.detail.textContent = JSON.stringify(view, null, 2);
  }

  // -----------------------------
  // API calls
  // -----------------------------
  async function refreshPath() {
    try {
      const r = await window.api.audit.path();
      if (r?.ok && el.path) el.path.textContent = `log: ${r.logPath}`;
      else if (el.path) el.path.textContent = "log: (introuvable)";
    } catch {
      if (el.path) el.path.textContent = "log: (introuvable)";
    }
  }

  async function doRead() {
    const sinceSeq = Number(el.since?.value || 0) || 0;
    const limit = Number(el.limit?.value || 250) || 250;

    try {
      const r = await window.api.audit.read({ sinceSeq, limit });

      // compat backend: { entries, nextSinceSeq } OU { events }
      const events =
        Array.isArray(r?.events) ? r.events : Array.isArray(r?.entries) ? r.entries : Array.isArray(r) ? r : [];

      state.events = events;
      state.selectedSeq = null;

      renderList();
      renderDetail();

      flashStatus(`Lu: ${events.length}`, events.length ? "OK" : "WARN");

      // Results panel
      setPill(el.resultsRead, `${events.length} evt`, events.length ? "OK" : "WARN");
      updateLastFromEvents();
      appendLog(`read • events=${events.length} • sinceSeq=${sinceSeq} • limit=${limit}`);
    } catch (e) {
      flashStatus("Lecture impossible", "FAIL");
      setPill(el.resultsRead, "ERREUR", "FAIL");
      appendLog(`read • FAIL • ${e?.message || String(e)}`);

      el.list.innerHTML = `<div class="hint" style="padding:10px;color:rgba(239,68,68,.95);">${esc(
        e?.message || e
      )}</div>`;
    }
  }

  async function doVerify() {
    try {
      const r = await window.api.audit.verify();

      if (r?.ok) {
        const count = Number(r?.count ?? r?.entries ?? 0) || 0;

        // Header status
        if (el.status) el.status.textContent = `statut: OK (${count} evt)`;
        flashStatus("Vérif OK", "OK");

        // Results panel
        setPill(el.resultsVerify, `OK (${count} evt)`, "OK");
        if (el.resultsLastSeq) el.resultsLastSeq.textContent = String(r?.last_seq ?? "—");
        if (el.resultsLastHash) el.resultsLastHash.textContent = String(r?.last_hash ?? "—");

        appendLog(`verify • OK • entries=${count}`);
      } else {
        if (el.status) el.status.textContent = "statut: ERREUR";
        flashStatus("Vérif KO", "FAIL");

        setPill(el.resultsVerify, "ERREUR", "FAIL");
        appendLog(`verify • FAIL • ${r?.error || "unknown error"}`);
      }
    } catch (e) {
      if (el.status) el.status.textContent = "statut: ERREUR";
      flashStatus("Vérif impossible", "FAIL");

      setPill(el.resultsVerify, "ERREUR", "FAIL");
      appendLog(`verify • FAIL • ${e?.message || String(e)}`);
    }
  }

  async function doCopyAll() {
    try {
      const filtered = (state.events || []).filter(matchesFilter).map((e) => summarize(e));
      await navigator.clipboard.writeText(JSON.stringify(filtered, null, 2));
      flashStatus("Copié", "OK");
      appendLog("copy json • OK");
    } catch {
      flashStatus("Copie impossible", "WARN");
      appendLog("copy json • FAIL");
    }
  }

  function wire() {
    ensureUiChrome();

    el.btnRead?.addEventListener("click", doRead);
    el.btnVerify?.addEventListener("click", doVerify);
    el.btnCopy?.addEventListener("click", doCopyAll);

    // init results panel (if present)
    setPill(el.resultsVerify, "—", null);
    setPill(el.resultsRead, "—", null);
    if (el.resultsLastSeq) el.resultsLastSeq.textContent = "—";
    if (el.resultsLastHash) el.resultsLastHash.textContent = "—";
    if (el.resultsLog) el.resultsLog.textContent = "Ready.";

    refreshPath();
    doVerify().finally(() => doRead());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
