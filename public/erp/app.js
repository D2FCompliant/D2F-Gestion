// app.js
"use strict";

// ----------------- CONFIG -----------------

const XP_REJECT_JSON_PATH = "./rejection-reasons.xp-z12-012.v1.2.json";

// ----------------- I18N (loaded from JSON) -----------------

const LANGS = [
  { id: "fr", label: "FR" },
  { id: "en", label: "EN" },
  { id: "sr", label: "SRB" }, // Serbe latinique
  { id: "es", label: "ES" },
  { id: "it", label: "IT" },
];

const DEFAULT_LANG = "en";
const LANG_STORAGE_KEY = "appLang";

// Dictionnaires chargés à la demande: { fr: {...}, en: {...} }
let I18N = {}; // sera rempli dynamiquement

// Lang state + helpers
function getLang() {
  try {
    const saved = String(localStorage.getItem(LANG_STORAGE_KEY) || "").toLowerCase();
    if (LANGS.some((l) => l.id === saved)) return saved;
  } catch {}
  return DEFAULT_LANG;
}

function setLang(lang) {
  const v = String(lang || "").toLowerCase();
  const ok = LANGS.some((l) => l.id === v) ? v : DEFAULT_LANG;

  try {
    localStorage.setItem(LANG_STORAGE_KEY, ok);
  } catch {}

  if (typeof state === "object" && state) state.lang = ok;
  return ok;
}

async function loadI18n(lang) {
  const l = (lang || getLang() || DEFAULT_LANG).toLowerCase();

  if (I18N[l]) return I18N[l];

  try {
    if (!window.api?.i18n?.load) throw new Error("window.api.i18n.load manquant");
    const json = await window.api.i18n.load(l);
    I18N[l] = json || {};
    return I18N[l];
  } catch (e) {
    console.warn(`[i18n] load failed for ${l}`, e);
    if (l !== DEFAULT_LANG) return loadI18n(DEFAULT_LANG);
    return {};
  }
}

// Interpolation: "Hello {name}" + {name:"John"} => "Hello John"
function formatMsg(str, vars) {
  if (!vars) return String(str ?? "");
  return String(str ?? "").replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

// ----------------- TEXT NORMALIZATION (HTML entities) -----------------
// Decode HTML entities safely (e.g. &#039; -> ')
function decodeHtmlEntities(s) {
  const str = String(s ?? "");
  if (!str.includes("&")) return str; // fast path
  const ta = document.createElement("textarea");
  ta.innerHTML = str;
  return ta.value;
}

// Normalize labels coming from XML/UBL/exports
function normalizeLabel(s) {
  return decodeHtmlEntities(s).replace(/\s+/g, " ").trim();
}

/**
 * t("status.language_changed", "Langue changée")
 * Supporte:
 *  - JSON "à plat" (clés avec des points): { "a.b.c": "..." }
 *  - JSON "imbriqué": { a:{ b:{ c:"..." } } }
 */
function t(keyPath, fallback = "", vars = null) {
  const lang = (state?.lang || getLang() || DEFAULT_LANG).toLowerCase();
  const key = String(keyPath || "");
  const read = (dict) => {
    if (!dict || typeof dict !== "object") return null;
    if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
    let cur = dict;
    for (const part of key.split(".")) {
      if (!cur || typeof cur !== "object" || !(part in cur)) return null;
      cur = cur[part];
    }
    return cur;
  };

  const raw = read(I18N[lang]) ?? read(I18N[DEFAULT_LANG]) ?? fallback;
  return formatMsg(raw, vars);
}

window.__d2fT = t;
// ----------------- I18N DOM APPLY -----------------

function applyI18nToElement(el) {
  if (!el || el.nodeType !== 1) return;

  // Texte: data-i18n="key.path"
  const key = el.getAttribute("data-i18n");
  if (key) {
    const fb = el.getAttribute("data-i18n-fallback") || el.textContent || "";
    el.textContent = t(key, fb);
  }

  // Attributs: data-i18n-attr="placeholder:common.search_placeholder;title:common.title"
  const spec = el.getAttribute("data-i18n-attr");
  if (spec) {
    const parts = spec
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const p of parts) {
      const [attr, k] = p.split(":").map((s) => (s || "").trim());
      if (!attr || !k) continue;
      const fb = el.getAttribute(attr) || "";
      el.setAttribute(attr, t(k, fb));
    }
  }
}

// Applique aux éléments statiques (sidebar, labels HTML) + éléments dynamiques annotés
function applyStaticI18n(root = document) {
  try {
    // html[lang]
    const lang = (state?.lang || getLang() || DEFAULT_LANG).toLowerCase();
    if (document?.documentElement) document.documentElement.setAttribute("lang", lang);

    // texte
    root.querySelectorAll("[data-i18n]").forEach((el) => applyI18nToElement(el));

    // attributs
    root.querySelectorAll("[data-i18n-attr]").forEach((el) => applyI18nToElement(el));
  } catch (e) {
    console.warn("[i18n] applyStaticI18n failed", e);
  }
}

// ----------------- DEBUG CLICS -----------------

document.addEventListener(
  "click",
  (e) => {
    const el = e.target;
    const action = el?.closest?.("[data-action]")?.dataset?.action;
    const view = el?.closest?.("[data-view]")?.dataset?.view;
    const nav = el?.closest?.(".nav__item")?.dataset?.module;
    if (action) console.log("CLICK data-action =", action);
    if (view) console.log("CLICK data-view =", view);
    if (nav) console.log("CLICK nav module =", nav);
  },
  true
);

console.log("window.api présent ?", !!window.api);

// --- XP Z12-012 (Annexe A) : motifs de refus (chargés depuis JSON) ---
let XP_REJECT = null;

async function loadXpRejectJson() {
  if (XP_REJECT) return XP_REJECT;

  const xp = await window.api.rejectionReasons.load();
  XP_REJECT = xp;
  return XP_REJECT;
}

function logXpRejectLoadError(e) {
  console.warn("[xp-z12-012] Impossible de charger le JSON motifs:", e?.message || e);
}

// ----------------- MODULES -----------------
const MODULES = {
  company: {
    title: "Société",
    desc: "Paramètres de l’entreprise émettrice + branding PDF.",
    actions: [
      { id: "company:save", i18n: "Enregistrer", variant: "primary" },
      { id: "company:chooseLogo", i18n: "Logo…", variant: "secondary" },
      { id: "company:clearLogo", i18n: "Retirer logo", variant: "ghost" },
    ],
  },

  dashboard: {
  title: "Dashboard",
  desc: "Vue synthèse devis / factures / encaissements (répartition par mode).",
  actions: [
    { id: "dashboard:refresh", i18n: "action.refresh", fallback: "Rafraîchir", variant: "secondary" },
  ],
},

  payments: {
    title: "Encaissements",
    desc: "Enregistrer un paiement sur une facture sélectionnée (total ou partiel).",
    actions: [
      { id: "payments:refresh", i18n: "Rafraîchir", variant: "secondary" },
      { id: "payments:record", i18n: "Enregistrer paiement", variant: "primary" },
    ],
  },

  clients: {
    title: "Clients",
    desc: "Liste à gauche, fiche à droite. Actions uniquement clients.",
    actions: [
      { id: "clients:save", i18n: "action.save", fallback: "Enregistrer", variant: "primary" },
      { id: "clients:new", i18n: "action.new", fallback: "Nouveau", variant: "secondary" },
      { id: "clients:importCsv", i18n: "clients.import.open_btn", fallback: "Importer CSV…", variant: "secondary" },
      { id: "clients:delete", i18n: "action.delete", fallback: "Supprimer", variant: "danger" },
    ],
  },

  items: {
    title: "Articles",
    desc: "Catalogue articles (sources des lignes).",
    actions: [
      { id: "items:save", i18n: "Enregistrer", variant: "primary" },
      { id: "items:new", i18n: "Nouveau", variant: "secondary" },
      { id: "items:delete", i18n: "Supprimer", variant: "danger" },
    ],
  },

  quotes: {
    title: "Devis",
    desc: "Éditeur devis + transformation en facture.",
    actions: [
      { id: "quotes:save", i18n: "Enregistrer", variant: "primary" },
      { id: "quotes:new", i18n: "Nouveau", variant: "secondary" },
      { id: "quotes:delete", i18n: "Supprimer", variant: "danger" },
      { id: "quotes:issue", i18n: "Valider/Envoyer", variant: "ghost" },
      { id: "quotes:toDepositInvoice", i18n: "Facture d’acompte", variant: "ghost" },
      { id: "quotes:toFinalInvoice", i18n: "Facture finale (solde)", variant: "ghost" },
      { id: "quotes:toInvoice", i18n: "Transformer en facture", variant: "ghost" },
    ],
  },

  invoices: {
    title: "Factures",
    desc: "Facture directe + depuis devis.",
    actions: [
      { id: "invoices:save", i18n: "Enregistrer", variant: "primary" },
      { id: "invoices:new", i18n: "Nouvelle", variant: "secondary" },
      { id: "invoices:delete", i18n: "Supprimer", variant: "danger" },
      { id: "invoices:issue", i18n: "Valider/Émettre", variant: "ghost" },
      { id: "invoices:toCreditNote", i18n: "Créer un avoir", variant: "ghost" },
      { id: "invoices:recordPayment", i18n: "Enregistrer encaissement", variant: "secondary" },
    ],
  },

  inbound: {
  title: "Réception",
  desc: "Factures reçues (PA/PAE) : statut, lisible, acceptation/refus.",
  actions: [
    { id: "inbound:refresh", i18n: "action.refresh", fallback: "Rafraîchir", variant: "secondary" },
    { id: "inbound:import",  i18n: "action.import",  fallback: "Importer…", variant: "secondary" },
    { id: "inbound:accept",  i18n: "action.accept",  fallback: "Accepter", variant: "primary" },
    { id: "inbound:reject",  i18n: "action.reject",  fallback: "Refuser", variant: "danger" },
    { id: "inbound:dispute", i18n: "action.dispute", fallback: "Dispute", variant: "secondary" },
    { id: "inbound:delete",  i18n: "action.delete",  fallback: "Supprimer", variant: "danger" },
    { id: "inbound:exportXml", i18n: "action.export_xml", fallback: "Exporter XML", variant: "ghost" },
    { id: "inbound:exportPdf", i18n: "action.export_pdf", fallback: "Exporter PDF", variant: "ghost" },
  ],
},

  exports: {
  title: "Exports",
  desc: "PDF + Email + XML",
  actions: []
},

  conformity: {
  title: "Conformité",
  desc: "E-reporting : préparation, envoi, statuts, erreurs.",
  actions: [
    { id: "conformity:refresh", i18n: "Rafraîchir", variant: "secondary" },
    { id: "conformity:sendNow", i18n: "Envoyer maintenant", variant: "primary" },
    { id: "conformity:openQueue", i18n: "File d’envoi", variant: "ghost" },
    { id: "conformity:rebuildPeriod", i18n: "Recalculer la période", variant: "ghost" },
    { id: "conformity:settings", i18n: "Paramètres réforme", variant: "secondary" },
  ],
},

};

function renderNavI18n() {
  document.querySelectorAll(".nav__item[data-module]").forEach((btn) => {
    const key = String(btn.dataset.module || "").trim();
    const icon = btn.querySelector(".nav__icon")?.textContent || "";
    const labelEl = btn.querySelector("span:not(.nav__icon)");

    const fallback = MODULES[key]?.title || key;
    const translated = t(`app.title.${key}`, fallback);

    if (labelEl) {
      labelEl.textContent = translated;
    } else {
      btn.textContent = [icon, translated].filter(Boolean).join(" ");
    }
  });
}

// ---- i18n keys helpers (match tes JSON plats) ----
function moduleTitleKey(moduleKey) {
  return `app.title.${moduleKey}`;
}
function moduleDescKey(moduleKey) {
  return `app.desc.${moduleKey}`;
}

function actionKeyFromId(actionId) {
  const id = String(actionId || "");

  // CRUD simples
  if (id.endsWith(":save")) return "action.save";
  if (id.endsWith(":new")) return "action.new";
  if (id.endsWith(":delete") || id.endsWith(":remove")) return "action.delete";
  if (id.endsWith(":refresh")) return "action.refresh";
  if (id.endsWith(":issue")) return "action.issue";

  // company
  if (id === "company:chooseLogo") return "action.choose_logo";
  if (id === "company:clearLogo") return "action.clear_logo";

  // inbound
  if (id === "inbound:accept") return "action.accept";
  if (id === "inbound:reject") return "action.reject";
  if (id === "inbound:import") return "action.import";
  if (id === "inbound:exportPdf") return "action.export_pdf";
  if (id === "inbound:exportXml") return "action.export_xml";

  // quotes
  if (id === "quotes:issue") return "action.validate_send";
  if (id === "quotes:toDepositInvoice") return "action.create_deposit_invoice";
  if (id === "quotes:toFinalInvoice") return "action.create_final_invoice";
  if (id === "quotes:toInvoice") return "action.transform_to_invoice";

  // invoices
  if (id === "invoices:toCreditNote") return "action.create_credit_note";
  if (id === "invoices:recordPayment") return "action.record_payment";
  if (id === "payments:record") return "action.record_payment";

  // exports
  if (id === "exports:peppolXml") return "action.export_peppol_xml";
  if (id === "exports:peppolPdf") return "action.export_readable_pdf";

  // pdfQuote/pdfInvoice : garde label module en fallback
  // (action.pdf_quote / action.pdf_invoice -> à rajouter)
  
  // conformity
  if (id === "conformity:refresh") return "action.refresh";
  if (id === "conformity:sendNow") return "conformity.action.send_now";
  if (id === "conformity:openQueue") return "conformity.action.open_queue";
  if (id === "conformity:rebuildPeriod") return "conformity.action.rebuild_period";
  if (id === "conformity:settings") return "conformity.action.settings";

  return null;
}

// ----------------- DOM HELPERS -----------------
const $ = (id) => document.getElementById(id);

const dom = {
  nav: () => $("navModules"),
  pages: () => document.querySelectorAll("[data-page]"),
  title: () => $("pageTitle"),
  desc: () => $("pageDesc"),
  toolbar: () => $("toolbar"),
  status: () => $("appStatus"),
};

function setStatus(text) {
  const el = document.getElementById("appStatus");
  if (el) el.textContent = text;
}

function buttonClass(variant) {
  if (variant === "primary") return "btn";
  if (variant === "secondary") return "btn btn--secondary";
  if (variant === "danger") return "btn btn--danger";
  if (variant === "ghost") return "btn btn--ghost";
  return "btn";
}

/* ----------------- Patch helpers (UI / status) ----------------- */
function ipcInvoke(channel, payload) {
  // Pattern A: window.api.invoke
  if (window.api && typeof window.api.invoke === "function") {
    return window.api.invoke(channel, payload);
  }

  if (window.electron?.ipcRenderer && typeof window.electron.ipcRenderer.invoke === "function") {
    return window.electron.ipcRenderer.invoke(channel, payload);
  }

  if (window.api?.ipc && typeof window.api.ipc.invoke === "function") {
    return window.api.ipc.invoke(channel, payload);
  }

  throw new Error("IPC invoke indisponible: expose ipcRenderer.invoke via preload (window.api.invoke ou window.electron.ipcRenderer.invoke)");
}

function isDraftInvoice() {
  return (state.invoiceDraft?.status || "draft") === "draft";
}

function bindQuotesListClick() {
  const listEl = document.getElementById("quotesList");
  if (!listEl) return;

  // évite double-binding si refresh
  if (listEl.dataset.boundClick === "1") return;
  listEl.dataset.boundClick = "1";

  listEl.addEventListener("click", async (e) => {
    const item = e.target.closest("[data-quote-id]");
    if (!item) return;

    const id = item.getAttribute("data-quote-id");
    if (!id) return;

    try {
      const fresh = await window.api.quotes.get(id); // ✅ contient status
      if (!fresh) throw new Error("Devis introuvable");

      state.quoteDraft = fresh;
      renderQuoteDraft();
    } catch (err) {
      console.error("[quotesList click] failed", err);
      setStatus(err?.message || String(err));
    }
  });
}

function typeToTypeCode(type) {
  if (type === "credit_note") return "381";
  if (type === "deposit") return "386";
  return "380"; // final
}

function invoiceFullToDraft(full) {
  const inv = full?.invoice || full || {};
  const lines = full?.lines || inv?.lines || [];

  const prepaid =
    inv.prepaid_amount ??
    inv.prepaidAmount ??
    inv.deposit_amount ??
    inv.depositAmount ??
    inv.total_prepaid ??
    inv.meta_json?.prepaid_amount ??
    0;

  return {
    id: inv.id ?? null,
    client_id: inv.client_id ?? "",
    date: inv.date ?? null,
    lines: lines || [],
    status: inv.status ?? "draft",
    type_code: typeToTypeCode(inv.type),
    prepaid_amount: Number(prepaid || 0),
    amount_due: Number(inv.amount_due ?? inv.payable_amount ?? 0),
    source_quote_id: inv.quote_id ?? inv.source_quote_id ?? null,
    vat_mode: inv.vat_mode ?? "AUTO",
    vat_effective: inv.vat_effective ?? "AUTO",
  };
}

function setButtonDisabled(btn, disabled) {
  btn.disabled = !!disabled;
  btn.style.opacity = disabled ? "0.5" : "1";
  btn.style.cursor = disabled ? "not-allowed" : "pointer";
}

function canDecideInbound(doc) {
  const d = doc ? normalizeInbound(doc) : null;
  if (!d) return false;
  return INBOUND_DECIDABLE_STATUSES.has(d.status);
}

function pickCgvTextForLocale(company, locale) {
  const l = String(locale || "").toLowerCase();
  const cgvI18n =
    company?.cgv_i18n ||
    company?.cgv_text_i18n || // si tu l’avais déjà sous ce nom
    null;

  if (cgvI18n && typeof cgvI18n === "object") {
    const direct = String(cgvI18n[l] || "").trim();
    if (direct) return direct;

    // fallback: default_doc_locale puis fr puis en
    const def = String(company?.default_doc_locale || "").toLowerCase();
    const byDef = String((def && cgvI18n[def]) || "").trim();
    if (byDef) return byDef;

    const fr = String(cgvI18n.fr || "").trim();
    if (fr) return fr;

    const en = String(cgvI18n.en || "").trim();
    if (en) return en;
  }

  // fallback final : ancien champ plat
  return String(company?.cgv_text || "").trim();
}

function safeJsonParse(x, fallback = {}) {
  if (!x) return fallback;
  if (typeof x === "object") return x;
  try { return JSON.parse(String(x)); } catch { return fallback; }
}

function round2(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function setExportLocaleUi(lang) {
  const sel = $("ex-locale");
  if (!sel) return;
  const l = String(lang || state.lang || "fr").toLowerCase();
  sel.value = ["fr", "en", "sr", "es", "it"].includes(l) ? l : "fr";
}

function ensureExportLocaleOptions() {
  const sel = $("ex-locale");
  if (!sel) return;
  if (sel.options?.length) return;

  const opts = [
    ["fr", "Français"],
    ["en", "English"],
    ["sr", "Srpski"],
    ["es", "Español"],
    ["it", "Italiano"],
  ];

  for (const [v, label] of opts) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = label;
    sel.appendChild(o);
  }
}

/* ----------------- I18N helpers (key vs fallback) ----------------- */

function looksLikeI18nKey(s) {
  const v = String(s || "").trim();

  if (!v) return false;
  if (/\s/.test(v)) return false;
  if (v.includes(".") || v.includes("_")) return true;
  if (
    v.startsWith("action.") ||
    v.startsWith("app.") ||
    v.startsWith("toolbar.") ||
    v.startsWith("status.") ||
    v.startsWith("dash.") ||
    v.startsWith("payments.") ||
    v.startsWith("clients.") ||
    v.startsWith("items.") ||
    v.startsWith("quotes.") ||
    v.startsWith("invoices.") ||
    v.startsWith("inbound.") ||
    v.startsWith("conformity.")
  ) {
    return true;
  }

  return false;
}

function resolveActionLabel(a) {
  const raw = String(a?.i18n || "").trim();
  const keyFromId = actionKeyFromId(a?.id);

  // Si raw est une clé => on l'utilise comme clé
  const key = looksLikeI18nKey(raw) ? raw : (keyFromId || `actions.${a.id}`);

  const fb =
    String(a?.fallback || "").trim() ||
    (!looksLikeI18nKey(raw) ? raw : "") ||
    "";

  return t(key, fb);
}

function renderToolbar(moduleKey) {
  const elToolbar = dom.toolbar();
  if (!elToolbar) return;
  elToolbar.innerHTML = "";

  /* ----------------- Language selector ----------------- */
  const langWrap = document.createElement("div");
  langWrap.style.display = "inline-flex";
  langWrap.style.alignItems = "center";
  langWrap.style.gap = "8px";
  langWrap.style.marginRight = "12px";

  const langLabel = document.createElement("span");
  langLabel.className = "toolbar__langLabel";
  langLabel.textContent = t("toolbar.language", t("toolbar.lang", "Langue"));
  langLabel.style.opacity = "0.75";
  langLabel.style.fontSize = "12px";

  const langSel = document.createElement("select");
  langSel.id = "toolbarLangSelect";
  langSel.style.height = "32px";
  langSel.style.borderRadius = "10px";
  langSel.style.padding = "0 10px";
  langSel.style.border = "1px solid rgba(255,255,255,0.15)";
  langSel.style.background = "transparent";
  langSel.style.color = "inherit";

  const curLang = state.lang || getLang();
  for (const l of LANGS) {
    const op = document.createElement("option");
    op.value = l.id;
    op.textContent = l.label;
    if (l.id === curLang) op.selected = true;
    langSel.appendChild(op);
  }

  langSel.addEventListener("change", async () => {
    const newLang = setLang(langSel.value);

    await Promise.all([loadI18n(newLang), loadI18n(DEFAULT_LANG)]);
    applyStaticI18n(document);
    renderNavI18n();

    const cur = state?.currentModule || moduleKey || "dashboard";
    const titleEl = dom.title();
    const descEl = dom.desc();
    if (titleEl) titleEl.textContent = t(`app.title.${cur}`, MODULES[cur]?.title || cur);
    if (descEl) descEl.textContent = t(`app.desc.${cur}`, MODULES[cur]?.desc || "");

    if (cur === "exports") {
      setExportLocaleUi(newLang);
      fillExportsPickers();
    }

    renderToolbar(cur);
    await refreshModule(cur).catch(() => {});
    if (cur === "dashboard" && typeof window.d2fDashboardRefresh === "function") {
      await window.d2fDashboardRefresh();
    }
    setStatus(t("status.language_changed", "Langue changée"));
  });

  langWrap.appendChild(langLabel);
  langWrap.appendChild(langSel);
  elToolbar.appendChild(langWrap);

  /* ----------------- Module actions ----------------- */
  const cfg = MODULES[moduleKey];
  if (!cfg) return;

  if (moduleKey === "quotes") {
    const hasId = !!state.quoteDraft?.id;

    const acceptBtn = document.createElement("button");
    acceptBtn.className = "btn";
    acceptBtn.type = "button";
    acceptBtn.textContent = t("action.accept", "Accepter");
    acceptBtn.dataset.action = "quotes:accept";
    setButtonDisabled(acceptBtn, !hasId);
    elToolbar.appendChild(acceptBtn);

    const rejectBtn = document.createElement("button");
    rejectBtn.className = "btn btn--ghost";
    rejectBtn.type = "button";
    rejectBtn.textContent = t("action.reject", "Refuser");
    rejectBtn.dataset.action = "quotes:reject";
    setButtonDisabled(rejectBtn, !hasId);
    elToolbar.appendChild(rejectBtn);

    for (const a of cfg.actions || []) {
      // évite doublon si tu as déjà ces actions dans MODULES
      if (a.id === "quotes:accept" || a.id === "quotes:reject") continue;

      const b = document.createElement("button");
      b.className = buttonClass(a.variant);
      b.type = "button";
      b.textContent = resolveActionLabel(a);
      b.dataset.action = a.id;

      // règles de disable éventuelles spécifiques à quotes (optionnel)
      if (a.id === "quotes:delete" || a.id === "quotes:remove") {
        setButtonDisabled(b, !hasId);
      }
      if (a.id === "quotes:save" || a.id === "quotes:update") {
        // autorise save même sans id si ton flow crée au save; sinon mets !hasId
        setButtonDisabled(b, false);
      }

      elToolbar.appendChild(b);
    }
    return;
  }

  for (const a of cfg.actions || []) {
    const b = document.createElement("button");
    b.className = buttonClass(a.variant);
    b.type = "button";
    b.textContent = resolveActionLabel(a);
    b.dataset.action = a.id;

    // invoices
    if (a.id === "invoices:delete") {
      const disabled = !(state.invoiceDraft?.id && isDraftInvoice());
      setButtonDisabled(b, disabled);
    }
    if (a.id === "invoices:save") {
      const disabled = state.invoiceDraft?.id && !isDraftInvoice();
      setButtonDisabled(b, disabled);
    }
    if (a.id === "invoices:issue") {
      const disabled = !(state.invoiceDraft?.id && isDraftInvoice());
      setButtonDisabled(b, disabled);
    }
    if (a.id === "invoices:toCreditNote") {
      const has = !!state.invoiceDraft?.id;
      const st = String(state.invoiceDraft?.status || "draft").toLowerCase();
      const disabled = !has || st === "draft";
      setButtonDisabled(b, disabled);
    }
    if (a.id === "invoices:recordPayment") {
      const disabled = !state.invoiceDraft?.id;
      setButtonDisabled(b, disabled);
    }

    // inbound
    if (a.id === "inbound:accept" || a.id === "inbound:reject") {
      const disabled = !state.selectedInboundId || !canDecideInbound(state.inboundDoc);
      setButtonDisabled(b, disabled);
    }
    if (a.id === "inbound:dispute") {
      const disabled = !state.selectedInboundId || !canDecideInbound(state.inboundDoc);
      setButtonDisabled(b, disabled);
    }
    if (a.id === "inbound:delete") {
      const d = state.inboundDoc ? normalizeInbound(state.inboundDoc) : null;
      const canDelete = !!state.selectedInboundId && d && INBOUND_DELETABLE_STATUSES.has(d.status);
      setButtonDisabled(b, !canDelete);
    }
    if (a.id === "inbound:exportXml") {
      const disabled = !state.selectedInboundId || !window.api?.inbound?.exportXml;
      setButtonDisabled(b, disabled);
    }
    if (a.id === "inbound:exportPdf") {
      const disabled = !state.selectedInboundId || !window.api?.inbound?.exportPdf;
      setButtonDisabled(b, disabled);
    }

    elToolbar.appendChild(b);
  }
}

function showPage(key) {
  for (const p of dom.pages()) p.classList.toggle("is-active", p.dataset.page === key);
  document.querySelectorAll(".nav__item").forEach((b) => b.classList.toggle("is-active", b.dataset.module === key));

  const elTitle = dom.title();
  const elDesc = dom.desc();

  if (elTitle) elTitle.textContent = normalizeLabel(t(`app.title.${key}`, MODULES[key]?.title || key));
  if (elDesc) elDesc.textContent = t(`app.desc.${key}`, MODULES[key]?.desc || "");

  renderToolbar(key);
  state.currentModule = key;
  refreshModule(key).catch((e) => setStatus(`Erreur: ${e.message}`));
}

function initNavigation() {
  const elNav = dom.nav(); // = document.getElementById("navModules")
  if (!elNav) {
    console.warn("[nav] navModules introuvable");
    return;
  }

  elNav.addEventListener("click", (e) => {
    const btn = e.target.closest(".nav__item");
    if (!btn) return;

    const key = btn.dataset.module;
    if (!key) return;

    showPage(key);
  });
}

function setView(view) {
  const shell = document.querySelector(".shell");
  if (!shell) return;
  shell.style.gridTemplateColumns = view === "single" ? "0px 1fr" : "";
}

/* ----------------- State ----------------- */
const state = {
  lang: getLang(),
  currentModule: "dashboard",
  company: null,

  // PATCH E-INVOICING / E-REPORTING (STATE)
  conformity: {
    scope: "FR",
    periodicity: "M", // D | M | B (plus Q/A)
    archiving: "ON",
    platform: "",
    next_due: "",
    emits_b2c: 0,
    has_international: 0,
    kpis: { flux8: 0, flux9: 0, flux10: 0 }, 
  },
  
  clients: [],
  selectedClientId: null,

  items: [],
  selectedItemId: null,

  quotes: [],
  selectedQuoteId: null,
  quoteDraft: {
    id: null,
    client_id: "",
    date: null,
    lines: [],
    vat_mode: "AUTO",
    vat_effective: "AUTO",
    validity_days: null,
    valid_until: "",
    payment_text: "",
  },

  invoices: [],
  selectedInvoiceId: null,

  invoiceDraft: {
    id: null,
    client_id: "",
    date: null,
    lines: [],
    status: "draft",
    type_code: "380",
    prepaid_amount: 0,
    source_quote_id: null,
    vat_mode: "AUTO",
    vat_effective: "AUTO",
  },

  inbound: [],
  selectedInboundId: null,
  inboundDoc: null,

  dashboard: {
    quotes: { in_progress: 0, accepted: 0, refused: 0 },
    invoices: { issued: 0, paid: 0, waiting: 0 },
    payments: { total: 0, by_method: {} },
  },

  payments: {
    selectedInvoiceId: null,
    list: [],
  },
};

/* ----------------- Normalisation data ----------------- */
function normalizeClient(c) {
  if (!c) return c;

  // --- VAT subject ---
  const vat_subject = c.vat_subject === 0 || c.vat_subject === 1 ? c.vat_subject : c.is_vat_subject === 0 ? 0 : 1;

  // --- Aliases paiement / devis (snake_case + camelCase) ---
  const payment_term = c.payment_term ?? c.paymentTerm ?? c.payment_terms ?? c.paymentTerms ?? "";
  const payment_days = c.payment_days ?? c.paymentDays ?? null;
  const payment_text = c.payment_text ?? c.paymentText ?? "";
  const quote_validity_days = c.quote_validity_days ?? c.quoteValidityDays ?? null;

  return {
    ...c,
    vat_subject,
    is_vat_subject: vat_subject,
    postal_code: c.postal_code ?? c.postal ?? "",
    customer_type: (c.customer_type || c.customerType || "B2C").toString().toUpperCase(),

    // normalisés
    payment_term,
    payment_days,
    payment_text,
    quote_validity_days,
  };
}

function normalizeItem(a) {
  if (!a) return a;
  const item_type = (a.item_type || "SERVICE").toString().toUpperCase() === "GOODS" ? "GOODS" : "SERVICE";
  const type = (a.type || "simple").toString();
  const name = a.name ?? a.label ?? "";
  return { ...a, name, label: name, type, item_type, active: a.active ?? 1 };
}

function normalizeQuote(q) {
  if (!q) return q;
  return { ...q, number: q.number ?? q.invoice_number ?? q.id, currency: q.currency || "EUR" };
}

function normalizeInvoice(i) {
  if (!i) return i;

  return {
    ...i,
    invoice_number: i.invoice_number || i.number || "—",
    currency: i.currency || "EUR",
    prepaid_amount: Number(i.prepaid_amount || 0) || 0,

    type: i.type || i.kind || "",
    type_code: String(i.type_code || i.invoice_type_code || i.typeCode || ""),
    invoice_type_code: String(i.invoice_type_code || i.type_code || i.typeCode || ""),

    // meta_json peut être string ou objet selon ton backend
    meta_json:
      typeof i.meta_json === "string"
        ? (() => {
            try { return JSON.parse(i.meta_json); } catch { return {}; }
          })()
        : (i.meta_json || {}),
  };
}

function normalizeInbound(x) {
  if (!x) return x;
  const status = String(x.status || "received").toLowerCase();
  return {
    ...x,
    status,
    direction: x.direction || "IN",
    received_at: x.received_at || x.created_at || x.updated_at || "",
    supplier_name: x.supplier_name || x.seller_name || x.from_name || "—",
    doc_number: x.doc_number || x.invoice_number || x.number || x.id,
    doc_date: x.doc_date || x.issue_date || x.date || "",
    total_ttc: Number(x.total_ttc ?? x.payable_amount ?? x.total ?? 0) || 0,
    currency: x.currency || "EUR",
  };
}

/* ----------------- Helpers EN16931 (minimum) ----------------- */
function requireFilled(label, value) {
  if (!String(value || "").trim()) throw new Error(label);
}
function validateCompanyEN16931(c) {
  requireFilled("Société: raison sociale obligatoire (BG-4/BT-27)", c?.legal_name);
  requireFilled("Société: pays obligatoire (BT-31)", c?.country);
}
function validateBuyerEN16931(b) {
  requireFilled("Client: nom obligatoire (BG-7/BT-44)", b?.name);
  requireFilled("Client: pays obligatoire (BT-55)", b?.country);
}
function validateLinesEN16931(lines) {
  if (!Array.isArray(lines) || lines.length === 0) throw new Error("Au moins 1 ligne est obligatoire (BG-25).");
  for (const [i, l] of lines.entries()) {
    requireFilled(`Ligne ${i + 1}: libellé obligatoire (BT-126)`, l.description);
    if (!(Number(l.quantity) > 0)) throw new Error(`Ligne ${i + 1}: quantité > 0 (BT-129)`);
    if (!(Number(l.unit_price_ht) >= 0)) throw new Error(`Ligne ${i + 1}: prix unitaire (BT-130)`);
  }
}

function money(x) {
  const v = Math.round((Number(x) || 0) * 100) / 100;
  return v.toFixed(2);
}

function addDaysISO(isoDate, days) {
  const d = new Date(String(isoDate || "").slice(0, 10));
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
}

function diffDaysISO(fromIso, toIso) {
  const a = String(fromIso || "").slice(0, 10);
  const b = String(toIso || "").slice(0, 10);
  if (!a || !b) return null;

  const da = new Date(a + "T00:00:00Z");
  const db = new Date(b + "T00:00:00Z");
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null;

  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

function normalizePaymentTermCode(code) {
  const c = String(code || "").trim().toUpperCase();
  if (["DUE_ON_RECEIPT", "NET_15", "NET_30", "NEGOTIATED"].includes(c)) return c;
  return "";
}

function defaultPaymentDaysFromTerm(term) {
  const t = normalizePaymentTermCode(term);
  if (t === "NET_15") return 15;
  if (t === "NET_30") return 30;
  if (t === "DUE_ON_RECEIPT") return 0;
  return null;
}

function paymentTermLabel(term) {
  const t = normalizePaymentTermCode(term);
  if (t === "DUE_ON_RECEIPT") return "À réception";
  if (t === "NET_15") return "Net 15 jours";
  if (t === "NET_30") return "Net 30 jours";
  if (t === "NEGOTIATED") return "Négocié / spécifique";
  return "";
}

function quoteStatus(q) {
  return String(q?.status || q?.state || "draft").toLowerCase();
}

function invoiceStatus(i) {
  return String(i?.status || "draft").toLowerCase();
}

/* ----------------- Helpers PEPPOL ----------------- */
function normalizeDigits(x) {
  return String(x ?? "").replace(/\D+/g, "");
}

function computePeppolEndpointFromCompany(company) {
  const country = String(company?.country ?? company?.country_code ?? "").toUpperCase();

  const siret = normalizeDigits(company?.siret || company?.legal_id);
  const siren = normalizeDigits(company?.siren);
  const gln = normalizeDigits(company?.gln);

  if (country === "FR") {
    if (/^\d{14}$/.test(siret)) return { scheme: "0009", id: siret }; // SIRET
    if (/^\d{9}$/.test(siren))  return { scheme: "0002", id: siren }; // SIREN
    if (/^\d{13}$/.test(gln))   return { scheme: "0088", id: gln };   // GLN
  }

  if (/^\d{13}$/.test(gln)) return { scheme: "0088", id: gln };
  return { scheme: "", id: "" };
}

function validatePeppolEndpoint({ scheme, id }) {
  const rules = { "0002": /^\d{9}$/, "0009": /^\d{14}$/, "0088": /^\d{13}$/ };
  if (!scheme || !id) return { ok: false, reason: "missing" };
  const re = rules[scheme];
  if (!re) return { ok: true, reason: "unknown_scheme" };
  return { ok: re.test(id), reason: re.test(id) ? "ok" : "bad_format" };
}

// ----------------- CA reconnu (HT) -----------------
function isIssuedInvoice(i) {
  const st = String(i?.status ?? i?.state ?? "").trim().toLowerCase();
  return st === "issued";
}

function isDepositInvoice(inv) {
  if (!inv) return false;

  const type = String(inv.type || inv.kind || "").toLowerCase();
  const tc = String(inv.type_code || inv.invoice_type_code || inv.typeCode || "").trim();
  const metaKind = String(inv?.meta_json?.kind || inv?.meta?.kind || "").toLowerCase();

  if (type === "deposit" || type === "prepayment") return true;
  if (metaKind === "deposit" || metaKind === "prepayment") return true;
  if (tc === "386") return true;

  return false;
}

function computeRecognizedRevenueHT(invoices) {
  const invs = Array.isArray(invoices) ? invoices : [];
  const byId = new Map(invs.map(i => [String(i.id), i]));

  let ca = 0;

  for (const inv of invs) {
    if (!isIssuedInvoice(inv)) continue;

    const type = String(inv?.type || inv?.kind || "").toLowerCase();
    const ht = Number(inv?.total_ht ?? inv?.totalHT ?? 0) || 0;

    // 1) Finals = CA reconnu
    if (type === "final") {
      ca += ht;
      continue;
    }

    // 2) Deposits = jamais dans le CA reconnu
    if (type === "deposit") continue;

    // 3) Credit note : seulement si elle annule un FINAL
    if (type === "credit_note") {
      const srcId = String(inv?.source_invoice_id || "");
      const src = byId.get(srcId);
      const srcType = String(src?.type || src?.kind || "").toLowerCase();

      if (srcType === "final") {
        // ht est déjà négatif en DB => on additionne tel quel
        ca += ht;
      }
      continue;
    }
  }

  return Math.round((ca + Number.EPSILON) * 100) / 100;
}

function invoiceKind(inv) {
  const tc = String(inv?.type_code || inv?.invoice_type_code || inv?.typeCode || "").trim();

  if (tc === "380") return "final";
  if (tc === "381") return "credit_note";
  if (tc === "386") return "deposit";

  const metaKind = String(inv?.meta_json?.kind || inv?.meta?.kind || "").toLowerCase();
  if (metaKind === "deposit" || metaKind === "prepayment") return "deposit";
  if (metaKind === "credit_note") return "credit_note";
  if (metaKind === "final") return "final";

  const t = String(inv?.type || inv?.kind || "").toLowerCase();
  if (t === "deposit" || t === "prepayment") return "deposit";
  if (t === "credit_note") return "credit_note";
  if (t === "final") return "final";

  return "unknown";
}

// ----------------- Dashboard -----------------
function canonicalQuoteStatus(q) {
  const raw = String(q?.status ?? q?.quote_status ?? q?.state ?? q?.quoteState ?? "draft")
    .trim()
    .toLowerCase();

  if (raw === "accepted" || raw === "accept") return "accepted";
  if (raw === "rejected" || raw === "refused" || raw === "declined") return "rejected";
  if (raw === "cancelled" || raw === "canceled") return "cancelled";
  if (raw === "sent") return "sent";
  return "draft";
}

function initApp() {
  if (window.api && typeof window.api.on === "function") {
    window.api.on("data:changed", (evt) => {
      if (!evt) return;
      if (evt.entity === "payments" || evt.entity === "invoices" || evt.entity === "quotes") {
        if (state.currentModule === "dashboard") computeAndRenderDashboard();
      }
    });
  }

  if (state.currentModule === "dashboard") {
    computeAndRenderDashboard();
  }
}

document.addEventListener("DOMContentLoaded", initApp);

async function computeAndRenderDashboard() {
  const numberLocale = { fr: "fr-FR", en: "en-GB", sr: "sr-Latn-RS", es: "es-ES", it: "it-IT" }[state.lang] || "fr-FR";
  const eur = (x) =>
    Number(x || 0).toLocaleString(numberLocale, { style: "currency", currency: "EUR" });

  const round2 = (x) => Math.round((Number(x || 0) + Number.EPSILON) * 100) / 100;

  const invoiceStatus = (i) => String(i?.status ?? i?.state ?? "draft").trim().toLowerCase();

  const normalizePayMethod = (m) => {
    const v = String(m || "other").trim().toLowerCase();
    if (v === "card" || v === "cb") return "card";
    if (v === "transfer" || v === "bank_transfer" || v === "wire") return "transfer";
    if (v === "cash") return "cash";
    if (v === "check" || v === "cheque") return "check";
    if (v === "sepa" || v === "direct_debit" || v === "debit") return "sepa";
    return "other";
  };

  const quotes = (await window.api.quotes.list({ q: "" })) || [];
  const invoices = (await window.api.invoices.list({ q: "" })) || [];
  const paymentsAll = (await (window.api?.payments?.listAll ? window.api.payments.listAll({}) : Promise.resolve([]))) || [];

  state.quotes = quotes;
  state.invoices = invoices;

  const qInProgress = quotes.filter((q) => ["draft", "sent"].includes(canonicalQuoteStatus(q))).length;
  const qAccepted = quotes.filter((q) => canonicalQuoteStatus(q) === "accepted").length;
  const qRefused = quotes.filter((q) => canonicalQuoteStatus(q) === "rejected").length;

  const issued = invoices.filter((i) => invoiceStatus(i) === "issued").length;
  const ca = computeRecognizedRevenueHT(invoices);

  const paidByInvoice = new Map();
  let totalPay = 0;

  const byMethodAgg = { card: 0, transfer: 0, cash: 0, check: 0, sepa: 0, other: 0 };

  for (const p of paymentsAll || []) {
    const iid = String(p.invoice_id || "");
    const amt = Number(p.amount || 0) || 0;
    if (!iid || !(amt > 0)) continue;

    paidByInvoice.set(iid, (paidByInvoice.get(iid) || 0) + amt);

    const m = normalizePayMethod(p.method);
    byMethodAgg[m] = (byMethodAgg[m] || 0) + amt;
    totalPay += amt;
  }

  let paid = 0;
  let waiting = 0;

  for (const inv of invoices) {
    if (invoiceStatus(inv) !== "issued") continue;

    const prepaid = Number(inv.prepaid_amount || 0) || 0;
    const payable = Math.max(0, (Number(inv.total_ttc || 0) || 0) - prepaid);
    const paidAmt = Number(paidByInvoice.get(String(inv.id)) || 0) || 0;

    if (paidAmt + 0.0001 >= payable) paid++;
    else waiting++;
  }

  const depositsIssued = invoices.filter((i) => invoiceStatus(i) === "issued" && isDepositInvoice(i));

  let depositsIssuedTtc = 0;
  let depositsPaidTtc = 0;

  for (const d of depositsIssued) {
    const ttc = Number(d.total_ttc || 0) || 0;
    depositsIssuedTtc += ttc;

    const paidAmt = Number(paidByInvoice.get(String(d.id)) || 0) || 0;
    depositsPaidTtc += Math.min(ttc, paidAmt);
  }

  depositsIssuedTtc = round2(depositsIssuedTtc);
  depositsPaidTtc = round2(depositsPaidTtc);
  const depositsWaitingTtc = round2(Math.max(0, depositsIssuedTtc - depositsPaidTtc));

  const byMethodRows = Object.entries(byMethodAgg).map(([method, total]) => ({
    method,
    total: round2(total),
  }));
  
  const res = (window.api?.dashboard?.get ? await window.api.dashboard.get({}) : null) || {};
  
  state.dashboard = { ca_recognized_ht: ca, deposits: {
      issued_ttc: depositsIssuedTtc,
      paid_ttc: depositsPaidTtc,
      waiting_ttc: depositsWaitingTtc,
      count_issued: depositsIssued.length,
    },
    quotes: {
      counts: res.quotes?.counts ?? { draft: 0, sent: 0, accepted: 0, rejected: 0, done: 0 },
      amounts: res.quotes?.amounts_ht ?? { draft: 0, sent: 0, accepted: 0, rejected: 0, done: 0 },
    },
    
    invoices: { issued, paid, waiting },
    payments: { total: round2(totalPay), by_method: byMethodRows },
  };

  const caEl = document.getElementById("dash-ca-recognized");
  if (caEl) caEl.textContent = eur(state.dashboard?.ca_recognized_ht ?? 0);

  const deposits = state.dashboard?.deposits ?? {};

// Noms dédiés aux acomptes
const depIssuedTtc = deposits.total_ttc ?? deposits.issued_ttc ?? 0;
const depPaidTtc = deposits.paid_ttc ?? 0;
const depWaitingTtc = Math.max(0, depIssuedTtc - depPaidTtc);
const depRatePct = depIssuedTtc > 0 ? (depPaidTtc / depIssuedTtc) * 100 : 0;

const depTotalEl = document.getElementById("dash-deposits-total");
const depPaidEl = document.getElementById("dash-deposits-paid");
const depWaitingEl = document.getElementById("dash-deposits-waiting");
const depRateEl = document.getElementById("dash-deposits-rate");
const depOverdueEl = document.getElementById("dash-deposits-overdue");
const depAvgDaysEl = document.getElementById("dash-deposits-avgdays");

if (depTotalEl) depTotalEl.textContent = eur(depIssuedTtc);
if (depPaidEl) depPaidEl.textContent = eur(depPaidTtc);
if (depWaitingEl) depWaitingEl.textContent = eur(depWaitingTtc);

if (depRateEl) {
  depRateEl.textContent = depRatePct.toFixed(1) + " %";
  depRateEl.classList.remove("kpi--good", "kpi--warn", "kpi--bad");
  depRateEl.classList.add(
    depRatePct >= 80 ? "kpi--good" : depRatePct >= 50 ? "kpi--warn" : "kpi--bad"
  );
}

// Overdue (si backend le renvoie, sinon 0)
if (depOverdueEl) {
  depOverdueEl.textContent = eur(deposits.overdue_ttc ?? 0);
}

// Avg days (si backend le renvoie, sinon "—")
if (depAvgDaysEl) {
  const d = deposits.avg_days_to_collect;
  depAvgDaysEl.textContent = Number.isFinite(d) ? `${d.toFixed(0)} j` : "—";
}

  console.log("DASHBOARD DATA:", state.dashboard);

  const qBox = document.getElementById("dashQuotesKpis");
  if (qBox) {
    const q = state.dashboard.quotes?.counts || {};
    qBox.innerHTML =
      `<div class="totals__row"><span>${t("dash.quotes.in_progress", "En cours")}</span><strong>${q.draft || 0}</strong></div>` +
      `<div class="totals__row"><span>${t("dash.quotes.accepted", "Acceptés")}</span><strong>${q.accepted || 0}</strong></div>` +
      `<div class="totals__row"><span>${t("dash.quotes.refused", "Refusés")}</span><strong>${q.rejected || 0}</strong></div>`;
  }

  const iBox = document.getElementById("dashInvoicesKpis");
  if (iBox) {
    const inv = state.dashboard.invoices;
    iBox.innerHTML =
      `<div class="totals__row"><span>${t("dash.invoices.issued", "Émises")}</span><strong>${inv.issued || 0}</strong></div>` +
      `<div class="totals__row"><span>${t("dash.invoices.paid", "Payées")}</span><strong>${inv.paid || 0}</strong></div>` +
      `<div class="totals__row"><span>${t("dash.invoices.waiting", "En attente")}</span><strong>${inv.waiting || 0}</strong></div>`;
  }

  const pBox = document.getElementById("dashPaymentsKpis");
  if (pBox) {
    pBox.innerHTML =
      `<div class="totals__row"><span>${t("dash.payments.total", "Total encaissé")}</span><strong>${eur(state.dashboard.payments.total || 0)}</strong></div>`;
  }

  const byMethodBox = document.getElementById("dashPaymentsByMethod");
  if (byMethodBox) {
    const rows = Array.isArray(state.dashboard.payments.by_method)
      ? state.dashboard.payments.by_method
      : [];
    byMethodBox.innerHTML = rows
      .filter((m) => (Number(m.total || 0) || 0) > 0)
      .map(
        (m) =>
          `<div class="totals__row"><span>${t(`pay.method.${String(m.method || "other").toLowerCase()}`, String(m.method || "other"))}</span><strong>${eur(m.total || 0)}</strong></div>`
      )
      .join("");
  }
}

// ----------------- TVA helpers -----------------
function normCountry(x) {
  return String(x || "").trim().toUpperCase();
}
const EU = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "EL",
  "ES",
  "FI",
  "FR",
  "HR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
]);

function getVatModeFromUi(prefix) {
  const el = $(`${prefix}-vat-mode`);
  const v = String(el?.value || "AUTO").trim().toUpperCase();
  if (["AUTO", "VAT", "REVERSE_CHARGE", "NO_VAT", "EXEMPT"].includes(v)) return v;
  return "AUTO";
}

function setVatEffectiveToUi(prefix, effective) {
  const el = $(`${prefix}-vat-effective`);
  if (el) el.value = effective;
}

function computeVatEffective({ selectedMode, seller, buyer }) {
  const mode = String(selectedMode || "AUTO").trim().toUpperCase();
  if (mode !== "AUTO") return mode;

  const sellerCountry = normCountry(seller?.country || "FR");
  const buyerCountry = normCountry(buyer?.country || "FR");

  if (sellerCountry && buyerCountry && sellerCountry === buyerCountry) return "VAT";

  const sellerInEU = EU.has(sellerCountry);
  const buyerInEU = EU.has(buyerCountry);

  if (!sellerInEU || !buyerInEU) return "NO_VAT";

  const buyerType = String(buyer?.customer_type || "B2C").trim().toUpperCase();
  const buyerVatId = String(buyer?.vat_id || "").trim();
  const buyerIsBusiness = buyerType === "B2B" || buyerType === "B2G";

  if (buyerIsBusiness && buyerVatId) return "REVERSE_CHARGE";
  return "VAT";
}

function applyVatModeToLinesUi(lines, effectiveVatMode) {
  if (!Array.isArray(lines)) return lines;
  return lines.map((l) => {
    const out = { ...l };

    if (effectiveVatMode === "VAT") {
      out.vat_category = String(out.vat_category || (Number(out.tva_percent) === 0 ? "Z" : "S")).toUpperCase();
      out.vat_exempt_reason = out.vat_exempt_reason || "";
      out.vat_exempt_code = out.vat_exempt_code || "";
      return out;
    }

    if (effectiveVatMode === "REVERSE_CHARGE") {
      out.tva_percent = 0;
      out.vat_category = "AE";
      out.vat_exempt_reason = "Reverse charge";
      out.vat_exempt_code = out.vat_exempt_code || "";
      return out;
    }

    if (effectiveVatMode === "EXEMPT") {
      out.tva_percent = 0;
      out.vat_category = "E";
      out.vat_exempt_reason = out.vat_exempt_reason || "Exempt";
      out.vat_exempt_code = out.vat_exempt_code || "";
      return out;
    }

    out.tva_percent = 0;
    out.vat_category = "Z";
    out.vat_exempt_reason = out.vat_exempt_reason || "";
    out.vat_exempt_code = out.vat_exempt_code || "";
    return out;
  });
}

/* ----------------- Calculs lignes / totaux ----------------- */
function computeLine(line) {
  const qty = Number(line.quantity) || 0;
  const pu = Number(line.unit_price_ht) || 0;
  const remise = Number(line.remise_percent) || 0;
  const tva = Number(line.tva_percent) || 0;

  const gross = qty * pu;
  const net = gross * (1 - remise / 100);
  const ht = Math.round(net * 100) / 100;

  const tvaAmt = Math.round(ht * (tva / 100) * 100) / 100;
  return { ht, tva: tvaAmt };
}

function computeTotals(lines) {
  let ht = 0;
  let tva = 0;
  for (const l of lines) {
    const t = computeLine(l);
    ht += t.ht;
    tva += t.tva;
  }
  ht = Math.round(ht * 100) / 100;
  tva = Math.round(tva * 100) / 100;
  return { total_ht: ht, total_tva: tva, total_ttc: Math.round((ht + tva) * 100) / 100 };
}

/* ----------------- AUTO TVA (devis/facture) ----------------- */
async function ensureCompanyLoaded() {
  state.company = state.company || (await window.api.company.get());
  return state.company;
}

async function getBuyerForQuote() {
  const clientId = $("q-client")?.value || state.quoteDraft.client_id;
  if (!clientId) return null;
  return normalizeClient(await window.api.clients.get(clientId));
}

async function getBuyerForInvoice() {
  const clientId = $("i-client")?.value || state.invoiceDraft.client_id;
  if (!clientId) return null;
  return normalizeClient(await window.api.clients.get(clientId));
}

async function applyVatForQuote({ silent = false } = {}) {
  const seller = await ensureCompanyLoaded();
  const buyer = await getBuyerForQuote();
  if (!buyer) return;

  const selectedMode = getVatModeFromUi("q");
  const effective = computeVatEffective({ selectedMode, seller, buyer });

  state.quoteDraft.client_id = $("q-client")?.value || state.quoteDraft.client_id;
  state.quoteDraft.vat_mode = selectedMode;
  state.quoteDraft.vat_effective = effective;

  setVatEffectiveToUi("q", effective);
  state.quoteDraft.lines = applyVatModeToLinesUi(state.quoteDraft.lines, effective);

  renderQuoteDraft();
  if (!silent) setStatus(`TVA (devis) : ${selectedMode} → ${effective}`);
}

async function applyVatForInvoice({ silent = false } = {}) {
  const seller = await ensureCompanyLoaded();
  const buyer = await getBuyerForInvoice();
  if (!buyer) return;

  const selectedMode = getVatModeFromUi("i");
  const effective = computeVatEffective({ selectedMode, seller, buyer });

  state.invoiceDraft.client_id = $("i-client")?.value || state.invoiceDraft.client_id;
  state.invoiceDraft.vat_mode = selectedMode;
  state.invoiceDraft.vat_effective = effective;

  setVatEffectiveToUi("i", effective);
  state.invoiceDraft.lines = applyVatModeToLinesUi(state.invoiceDraft.lines, effective);

  renderInvoiceDraft();
  if (!silent) setStatus(`TVA (facture) : ${selectedMode} → ${effective}`);
}

/* ----------------- UI helpers ----------------- */
function applyLinesGridLayout(pageKey) {
  const tpl = "1fr 90px 110px 80px 120px 44px";
  const page = document.querySelector(`[data-page="${pageKey}"]`);
  if (!page) return;

  const head = page.querySelector(".table__head");
  if (head) {
    head.style.display = "grid";
    head.style.gridTemplateColumns = tpl;
  }

  const linesId = pageKey === "quotes" ? "q-lines" : pageKey === "invoices" ? "i-lines" : null;
  if (!linesId) return;

  const container = $(linesId);
  if (!container) return;

  container.querySelectorAll(".table__row").forEach((row) => {
    row.style.display = "grid";
    row.style.gridTemplateColumns = tpl;
    row.style.alignItems = "center";
  });
}

function allowedPeriodicitiesFromVatRegime(vatRegime) {
  const vr = String(vatRegime || "").toUpperCase();

  if (vr === "REAL_NORMAL_MONTHLY") return ["D"]; // décade
  if (vr === "REAL_NORMAL_QUARTERLY") return ["M"]; // mensuel
  if (vr === "SIMPLIFIED") return ["M"]; // mensuel
  if (vr === "FRANCHISE") return ["B"]; // bimestriel

  return ["M"];
}

function periodicityLabel(p) {
  if (p === "D") return "Décade";
  if (p === "M") return "Mensuel";
  if (p === "B") return "Bimestriel";
  return p;
}

function round2(x) {
  return Math.round(((Number(x) || 0) + Number.EPSILON) * 100) / 100;
}

/* ----------------- Modals ----------------- */
function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.add("is-open");
  m.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.remove("is-open");
  m.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}
function bindModalClose(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.addEventListener("click", (e) => {
    if (e.target === m) closeModal(id);
    if (e.target.closest("[data-modal-close]")) closeModal(id);
  });
}
function ensureRejectModal() {
  const m = document.getElementById("rejectModal");
  if (!m) throw new Error("rejectModal introuvable dans index.html");
  bindModalClose("rejectModal");
}
function ensurePaymentModal() {
  const m = document.getElementById("paymentModal");
  if (m) {
    bindModalClose("paymentModal");
    return;
  }

  // fallback si un jour tu retires le modal HTML
  const wrap = document.createElement("div");
  wrap.id = "paymentModal";
  wrap.className = "modal";
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML = `
    <div class="modal__backdrop" data-modal-close></div>
    <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="paymentTitle">
      <div class="modal__header">
        <div class="modal__title" id="paymentTitle">Enregistrer un encaissement</div>
        <button class="icon-btn" type="button" data-modal-close aria-label="Fermer">✕</button>
      </div>
      <div class="modal__body">
        <div class="grid2-modal">
          <label class="field">
            <div class="field__label"><span>Montant encaissé</span></div>
            <input id="payAmount" type="number" step="0.01" placeholder="0.00" />
          </label>
          <label class="field">
            <div class="field__label"><span>Date</span></div>
            <input id="payDate" type="date" />
          </label>
        </div>
        <div class="grid2-modal u-mt">
          <label class="field">
            <div class="field__label"><span>Mode</span></div>
            <select id="payMethod">
              <option value="CARD">Carte</option>
              <option value="TRANSFER">Virement</option>
              <option value="CASH">Espèces</option>
              <option value="CHECK">Chèque</option>
              <option value="SEPA">Prélèvement</option>
              <option value="OTHER">Autre</option>
            </select>
          </label>
          <label class="field">
            <div class="field__label"><span>Référence (optionnel)</span></div>
            <input id="payRef" type="text" placeholder="Transaction / remittance…" />
          </label>
        </div>
      </div>
      <div class="modal__footer">
        <button class="btn btn--ghost" type="button" data-modal-close>Annuler</button>
        <button class="btn" type="button" id="payConfirmBtn">Enregistrer</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  bindModalClose("paymentModal");
}

/* ----------------- Company UI ----------------- */

function safeJsonParse(x, fallback = {}) {
  if (!x) return fallback;
  if (typeof x === "object") return x;
  try {
    const o = JSON.parse(String(x));
    return o && typeof o === "object" ? o : fallback;
  } catch {
    return fallback;
  }
}

function num(x, def = 0) {
  const v = Number(x);
  return Number.isFinite(v) ? v : def;
}

function round2(x) {
  return Math.round((num(x, 0) + Number.EPSILON) * 100) / 100;
}

function jsonStringifySafe(x) {
  try {
    return JSON.stringify(x ?? {});
  } catch {
    return "{}";
  }
}

function companyPayloadFromForm() {
  const current = state?.company || {};

  const metaCurrent = safeJsonParse(current?.meta_json, {});
  const metaTextarea = safeJsonParse($("co-meta-json")?.value, {});
  const meta = { ...metaCurrent, ...metaTextarea };

  const annualRaw = $("co-annual-target-ht")?.value ?? "";
  const annual = round2(num(annualRaw, NaN));
  if (Number.isFinite(annual) && annual > 0) meta.annual_target_ht = annual;
  else delete meta.annual_target_ht;

  const peppolEndpointId = $("co-peppol-endpoint-id")?.value?.trim() || "";
  const peppolEndpointScheme = $("co-peppol-endpoint-scheme")?.value?.trim() || "";

  if (peppolEndpointId) meta.peppol_endpoint_id = peppolEndpointId;
  else delete meta.peppol_endpoint_id;

  if (peppolEndpointScheme) meta.peppol_endpoint_scheme = peppolEndpointScheme;
  else delete meta.peppol_endpoint_scheme;

  const meta_json = jsonStringifySafe(meta);
  if ($("co-meta-json")) $("co-meta-json").value = meta_json;

  return {
    legal_name: $("co-legal-name")?.value,
    legal_id: $("co-legal-id")?.value,
    vat_id: $("co-vat-id")?.value,
    vat_regime: $("co-vat-regime")?.value || "REAL_NORMAL_MONTHLY",
    country: $("co-country")?.value,
    currency: $("co-currency")?.value,
    street: $("co-street")?.value,
    street2: $("co-street2")?.value,
    postal_code: $("co-postal")?.value,
    city: $("co-city")?.value,
    email: $("co-email")?.value,
    phone: $("co-phone")?.value,
    
    smtp_host: $("company-smtp-host")?.value?.trim() || "",
    smtp_port: Number($("company-smtp-port")?.value || 587),
    smtp_user: $("company-smtp-user")?.value?.trim() || "",
    smtp_password: $("company-smtp-password")?.value || "",
    smtp_from_name: $("company-smtp-from-name")?.value?.trim() || "",

    cgv_text: $("co-cgv-text")?.value || "",

    bank_name: $("co-bank-name")?.value || "",
    bank_holder: $("co-bank-holder")?.value || "",
    bank_extra: $("co-bank-extra")?.value || "",
    iban: $("co-bank-iban")?.value || "",
    bic: $("co-bank-bic")?.value || "",

    show_logo: !!$("co-show-logo")?.checked,

    meta_json,
  };
}

function fillCompanyForm(c) {
  const meta = safeJsonParse(c?.meta_json, {});

  if ($("co-legal-name")) $("co-legal-name").value = c?.legal_name || "";
  if ($("co-legal-id")) $("co-legal-id").value = c?.legal_id || "";
  if ($("co-vat-id")) $("co-vat-id").value = c?.vat_id || "";
  if ($("co-country")) $("co-country").value = c?.country || "RS";
  if ($("co-currency")) $("co-currency").value = c?.currency || "EUR";
  if ($("co-street")) $("co-street").value = c?.street || "";
  if ($("co-street2")) $("co-street2").value = c?.street2 || "";
  if ($("co-postal")) $("co-postal").value = c?.postal_code || "";
  if ($("co-city")) $("co-city").value = c?.city || "";
  if ($("co-email")) $("co-email").value = c?.email || "";
  if ($("co-phone")) $("co-phone").value = c?.phone || "";
  
  if ($("company-smtp-host")) { $("company-smtp-host").value = c?.smtp_host || "";
}

  if ($("company-smtp-port")) { $("company-smtp-port").value = c?.smtp_port || 587;
}

  if ($("company-smtp-user")) { $("company-smtp-user").value = c?.smtp_user || "";
}

  if ($("company-smtp-password")) { $("company-smtp-password").value = c?.smtp_password || "";
}

  if ($("company-smtp-from-name")) { $("company-smtp-from-name").value = c?.smtp_from_name || "";
}

  if ($("co-vat-regime")) $("co-vat-regime").value = c?.vat_regime || "REAL_NORMAL_MONTHLY";

  if ($("co-peppol-endpoint-id")) $("co-peppol-endpoint-id").value = meta?.peppol_endpoint_id || "";
  if ($("co-peppol-endpoint-scheme")) $("co-peppol-endpoint-scheme").value = meta?.peppol_endpoint_scheme || "";
  
  // Auto-suggest si vide
  const curScheme = meta?.peppol_endpoint_scheme || "";
  const curId = meta?.peppol_endpoint_id || "";
  if (!curScheme || !curId) {
    const guess = computePeppolEndpointFromCompany(c || {});
    if (guess.scheme && guess.id) {
      if ($("co-peppol-endpoint-scheme")) $("co-peppol-endpoint-scheme").value = guess.scheme;
      if ($("co-peppol-endpoint-id")) $("co-peppol-endpoint-id").value = guess.id;
    }
  }

  if ($("co-show-logo")) $("co-show-logo").checked = !!(c?.show_logo ?? 1);

  if ($("co-cgv-text")) $("co-cgv-text").value = c?.cgv_text || "";
  if ($("co-bank-name")) $("co-bank-name").value = c?.bank_name || "";
  if ($("co-bank-holder")) $("co-bank-holder").value = c?.bank_holder || "";
  if ($("co-bank-extra")) $("co-bank-extra").value = c?.bank_extra || "";
  if ($("co-bank-iban")) $("co-bank-iban").value = c?.iban || "";
  if ($("co-bank-bic")) $("co-bank-bic").value = c?.bic || "";

  const annualTarget = round2(num(meta?.annual_target_ht, 0));
  if ($("co-annual-target-ht")) $("co-annual-target-ht").value = annualTarget ? String(annualTarget) : "";
  if ($("co-meta-json")) $("co-meta-json").value = c?.meta_json || "{}";

  const img = $("companyLogoPreview");
  const fallback = $("companyLogoFallback");

  if (img && fallback) {
    if (c?.logo_path) {
      img.src = `file://${c.logo_path}`;
      img.style.display = "block";
      fallback.style.display = "none";
    } else {
      img.removeAttribute("src");
      img.style.display = "none";
      fallback.style.display = "inline";
    }
  }
}

async function saveCompanyFromUI() {
  const payload = companyPayloadFromForm();
  const meta = safeJsonParse(payload.meta_json, {});
  const v = validatePeppolEndpoint({
    scheme: meta.peppol_endpoint_scheme,
    id: meta.peppol_endpoint_id
  });

  if (!v.ok) {
    // Bloques :
    // throw new Error("PEPPOL: Endpoint scheme + ID requis (ex: 0009 + SIRET).");
    // Avertis :
    setStatus("⚠️ PEPPOL: Endpoint scheme/ID manquant ou invalide (export PEPPOL impossible).");
  }
  const saved = await window.api.company.save(payload);
  console.log("SAVED COMPANY =", saved);
  state.company = saved;
  fillCompanyForm(saved);
}

/* ----------------- Clients UI (manquants) ----------------- */
function fillClientForm(c) {
  if ($("cl-id")) $("cl-id").value = c?.id || "";
  if ($("cl-customer-type")) $("cl-customer-type").value = (c?.customer_type || "B2C").toString().toUpperCase();

  if ($("cl-name")) $("cl-name").value = c?.name || "";
  if ($("cl-email")) $("cl-email").value = c?.email || "";
  if ($("cl-phone")) $("cl-phone").value = c?.phone || "";

  if ($("cl-country")) $("cl-country").value = c?.country || "FR";
  if ($("cl-vat-subject")) $("cl-vat-subject").value = String(c?.vat_subject ?? 1);
  if ($("cl-vat-id")) $("cl-vat-id").value = c?.vat_id || "";
  if ($("cl-legal-id")) $("cl-legal-id").value = c?.legal_id || "";

  if ($("cl-street")) $("cl-street").value = c?.street || "";
  if ($("cl-street2")) $("cl-street2").value = c?.street2 || "";
  if ($("cl-postal")) $("cl-postal").value = c?.postal_code || "";
  if ($("cl-city")) $("cl-city").value = c?.city || "";
  if ($("cl-payment-term")) $("cl-payment-term").value = normalizePaymentTermCode(c?.payment_term) || "";

  const pd = c?.payment_days;
  if ($("cl-payment-days")) $("cl-payment-days").value = pd == null ? "" : String(pd);

  if ($("cl-payment-text")) $("cl-payment-text").value = c?.payment_text || "";

  const qvd = c?.quote_validity_days;
  if ($("cl-quote-validity-days")) $("cl-quote-validity-days").value = qvd == null ? "" : String(qvd);

  if ($("cl-notes")) $("cl-notes").value = c?.notes || "";
}

function clientPayloadFromForm() {
  return {
    id: $("cl-id")?.value || undefined,
    customer_type: ($("cl-customer-type")?.value || "B2C").toString().toUpperCase(),
    name: $("cl-name")?.value || "",
    email: $("cl-email")?.value || "",
    phone: $("cl-phone")?.value || "",
    country: $("cl-country")?.value || "FR",
    vat_subject: Number($("cl-vat-subject")?.value ?? 1),
    vat_id: $("cl-vat-id")?.value || "",
    legal_id: $("cl-legal-id")?.value || "",
    street: $("cl-street")?.value || "",
    street2: $("cl-street2")?.value || "",
    postal_code: $("cl-postal")?.value || "",
    city: $("cl-city")?.value || "",
        // ✅ NEW: règlement & devis (defaults)
    payment_term: normalizePaymentTermCode($("cl-payment-term")?.value || ""),
    payment_days: (() => {
      const v = $("cl-payment-days")?.value;
      return v === "" || v == null ? null : Number(v);
    })(),
    payment_text: $("cl-payment-text")?.value || "",
    quote_validity_days: (() => {
      const v = $("cl-quote-validity-days")?.value;
      return v === "" || v == null ? null : Number(v);
    })(),

    // ✅ Aliases camelCase 
    paymentTerm: normalizePaymentTermCode($("cl-payment-term")?.value || ""),
    paymentDays: (() => {
      const v = $("cl-payment-days")?.value;
      return v === "" || v == null ? null : Number(v);
    })(),
    paymentText: $("cl-payment-text")?.value || "",
    quoteValidityDays: (() => {
      const v = $("cl-quote-validity-days")?.value;
      return v === "" || v == null ? null : Number(v);
    })(),

    notes: $("cl-notes")?.value || "",
  };
}

/* ----------------- Items UI (manquants) ----------------- */
function fillItemForm(a) {
  if ($("it-id")) $("it-id").value = a?.id || "";
  if ($("it-ref")) $("it-ref").value = a?.ref || "";
  if ($("it-type")) $("it-type").value = (a?.type || "simple").toString();
  if ($("it-item-type")) $("it-item-type").value = (a?.item_type || "SERVICE").toString().toUpperCase();
  if ($("it-label")) $("it-label").value = a?.label || a?.name || "";
  if ($("it-price")) $("it-price").value = String(a?.unit_price_ht ?? a?.price ?? 0);
  if ($("it-tva")) $("it-tva").value = String(a?.tva_percent ?? 20);
  if ($("it-unit")) $("it-unit").value = a?.unit_code || a?.unit || "";
  if ($("it-active")) $("it-active").value = String(a?.active ?? 1);
  if ($("it-desc")) $("it-desc").value = a?.description || a?.desc || "";
}

function itemPayloadFromForm() {
  return {
    id: $("it-id")?.value || undefined,
    ref: $("it-ref")?.value || "",
    type: $("it-type")?.value || "simple",
    item_type: ($("it-item-type")?.value || "SERVICE").toString().toUpperCase(),
    name: $("it-label")?.value || "",
    label: $("it-label")?.value || "",
    unit_price_ht: Number($("it-price")?.value || 0),
    tva_percent: Number($("it-tva")?.value || 0),
    unit_code: $("it-unit")?.value || "C62",
    active: Number($("it-active")?.value ?? 1),
    description: $("it-desc")?.value || "",
  };
}

/* ----------------- Lists rendering ----------------- */
function renderList(container, rows, selectedId, titleFn, subFn) {
  if (!container) return;
  container.innerHTML = "";
  for (const r of rows) {
    const b = document.createElement("button");
    b.className = "list__item" + (r.id === selectedId ? " is-selected" : "");
    b.type = "button";
    b.dataset.id = r.id;
    b.innerHTML = `
      <div class="list__title"></div>
      <div class="list__sub"></div>
`   ;

    const tEl = b.querySelector(".list__title");
    const sEl = b.querySelector(".list__sub");

    if (tEl) tEl.textContent = normalizeLabel(titleFn(r));
    if (sEl) sEl.textContent = normalizeLabel(subFn ? subFn(r) : "");

    container.appendChild(b);
  }
}

function setSelectOptions(sel, options, selected) {
  if (!sel) return;
  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = t("ui.choose", "— choisir —");
  sel.appendChild(opt0);

  for (const o of options) {
    const op = document.createElement("option");
    op.value = o.id;
    op.textContent = o.label;
    if (selected && String(o.id) === String(selected)) op.selected = true;
    sel.appendChild(op);
  }
}

// =========================
// Conformity (e-Reporting) UI
// =========================

let __cf_inited = false;

function cf$(id) {
  return document.getElementById(id);
}

function cfSetHint(id, txt) {
  const el = $(id);
  if (el) el.textContent = txt || "—";
}

function cfPushChat(role, text) {
  const box = $("cf-ai-chat");
  if (!box) return;
  const wrap = document.createElement("div");
  wrap.style.margin = "8px 0";
  wrap.style.opacity = role === "user" ? "0.95" : "1";
  wrap.innerHTML = `
    <div style="font-size:12px;opacity:.7;margin-bottom:2px;">${role === "user" ? "Vous" : "Agent"}</div>
    <div style="line-height:1.35;white-space:pre-wrap;">${text}</div>
  `;
  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;
}

function cfNormalizeConfig(cfg = {}) {
  // Valeurs par défaut (adaptées à ton UI)
  return {
    scope: cfg.scope ?? "FR",               // FR | INTL
    periodicity: cfg.periodicity ?? "M",    // D | M | B
    archiving: cfg.archiving ?? "ON",       // ON | OFF
    platform: cfg.platform ?? "",           // PA | OTHER
    next_due: cfg.next_due ?? "",           // yyyy-mm-dd
    emits_b2c: String(cfg.emits_b2c ?? cfg.emitsB2c ?? 0),            // "0"|"1"
    has_international: String(cfg.has_international ?? cfg.hasInternational ?? 0) // "0"|"1"
  };
}

function cfComputeEligibility(cfg) {
  // Règles simples (tu peux enrichir)
  // En général : concerné si opérations B2C et/ou international (et B2B non domestique selon cas),
  // ici on donne un diagnostic pédagogique.
  const emitsB2c = cfg.emits_b2c === "1";
  const intl = cfg.has_international === "1" || cfg.scope === "INTL";
  const platformOk = !!cfg.platform;

  const concerned = emitsB2c || intl; // simplifié
  const reasons = [];
  if (emitsB2c) reasons.push("Vous émettez du B2C (flux e-reporting requis).");
  if (intl) reasons.push("Vous avez des opérations internationales (flux e-reporting requis).");
  if (!emitsB2c && !intl) reasons.push("A priori moins concerné par le e-reporting (cas B2B domestique pur).");

  const warnings = [];
  if (!platformOk) warnings.push("Plateforme non choisie (PA, OTHER).");
  if (!cfg.periodicity) warnings.push("Périodicité manquante.");

  return { concerned, reasons, warnings };
}

function cfMissingFields(cfg) {
  const missing = [];
  if (!cfg.scope) missing.push("Scope");
  if (!cfg.periodicity) missing.push("Périodicité");
  if (!cfg.archiving) missing.push("Archivage");
  if (!cfg.platform) missing.push("Plateforme");
  return missing;
}

async function cfLoadToForm() {
  const raw = await window.api.conformity.getConfig();
  const cfg = cfNormalizeConfig(raw || {});

  // --- Backward compat / terminologie ---
  // pa_name = nom de la Plateforme Agréée (PA)
  // platform (legacy) : ancien champ
  const paName = (cfg.pa_name ?? cfg.platform ?? "").toString();

  // platform_kind: "PA" | "SC" | "OTHER"
  const kind = String(cfg.platform_kind || "PA").toUpperCase();
  const safeKind = ["PA", "SC", "OTHER"].includes(kind) ? kind : "PA";

  // jurisdiction (multi-pays) : "FR" | "DEFAULT" | "BE" | ...
  const jurisdiction =
    (cfg.jurisdiction || (cfg.scope === "FR" ? "FR" : "DEFAULT")).toString().toUpperCase();

  // --- Fill form ---
  $("cf-scope").value = cfg.scope;
  $("cf-periodicity").value = cfg.periodicity;
  $("cf-archiving").value = cfg.archiving;
  $("cf-platform").value = paName;
  $("cf-next-due").value = cfg.next_due || "";
  $("cf-emits-b2c").value = cfg.emits_b2c;
  $("cf-has-international").value = cfg.has_international;

  // --- Contextual hints ---
  cfSetHint(
    "cf-help-scope",
    cfg.scope === "FR"
      ? "FR : activité principalement en France. INTL : vous avez des opérations hors France."
      : "INTL : vous avez des opérations hors France (UE/hors UE)."
  );

  // Periodicity: si FR, rappeler que c’est piloté par TVA
  cfSetHint(
    "cf-help-periodicity",
    jurisdiction === "FR"
      ? "France : la fréquence de transmission e-reporting dépend du régime de TVA (cette valeur peut être imposée)."
      : "Choisissez la fréquence de constitution/contrôle interne (selon vos process)."
  );

  cfSetHint("cf-help-archiving", "ON recommandé : conserve les preuves et exports.");

  const kindLabel =
    safeKind === "PA"
        ? "PA (Plateforme Agréée)"
        : safeKind === "SC"
          ? "SC (Solution connectée à une PA)"
          : "Autre";

  cfSetHint(
  "cf-help-platform",
  cfg.scope === "FR"
    ? "France : PA = Plateforme Agréée. Indiquez le nom de la plateforme utilisée."
    : "International : indiquez le nom du portail/plateforme utilisé(e) pour le e-reporting."
);

  cfSetHint("cf-help-nextdue", "Info : prochaine échéance interne (pas un envoi automatique).");
  cfSetHint("cf-help-b2c", "Oui si vous facturez des particuliers.");
  cfSetHint("cf-help-intl", "Oui si vous vendez/achetez hors France (UE/hors UE).");

  // --- Eligibility hint ---
  const elig = cfComputeEligibility(cfg);
  const hint = [
    elig.concerned
      ? "✅ Vous êtes probablement concerné par du e-reporting."
      : "🟡 Vous êtes probablement moins concerné (à confirmer).",
    ...elig.reasons,
    elig.warnings.length ? "⚠️ " + elig.warnings.join(" ") : ""
  ]
    .filter(Boolean)
    .join(" ");
  cfSetHint("cf-eligibility-hint", hint);

  // --- Missing fields box ---
  const missing = cfMissingFields(cfg);
  const box = $("cf-missing-box");
  const list = $("cf-missing-list");
  if (box && list) {
    if (missing.length) {
      box.style.display = "";
      list.textContent = "• " + missing.join("\n• ");
    } else {
      box.style.display = "none";
      list.textContent = "";
    }
  }

  return cfg;
}

let __cf_saveTimer = null;
function cfScheduleSave() {
  clearTimeout(__cf_saveTimer);
  __cf_saveTimer = setTimeout(async () => {
    const payload = {
      scope: $("cf-scope").value,
      periodicity: $("cf-periodicity").value,
      archiving: $("cf-archiving").value,
      platform: $("cf-platform").value,
      next_due: $("cf-next-due").value,
      emits_b2c: $("cf-emits-b2c").value,
      has_international: $("cf-has-international").value
    };
    try {
      await window.api.conformity.saveConfig(payload);
      const cfg = cfNormalizeConfig(payload);
      const elig = cfComputeEligibility(cfg);
      cfSetHint("cf-eligibility-hint", [
        elig.concerned ? "✅ Vous êtes probablement concerné par du e-reporting." : "🟡 Vous êtes probablement moins concerné (à confirmer).",
        ...elig.reasons,
        elig.warnings.length ? ("⚠️ " + elig.warnings.join(" ")) : ""
      ].filter(Boolean).join(" "));
      $("appStatus") && ($("appStatus").textContent = "Sauvé");
      setTimeout(() => $("appStatus") && ($("appStatus").textContent = "Prêt"), 800);
    } catch (e) {
      console.error(e);
      $("appStatus") && ($("appStatus").textContent = "Erreur");
    }
  }, 250);
}

// -------------------------
// Mini “agent IA” (guidé, deterministic)
// -------------------------
const cfAgent = {
  step: 0,
  state: { b2c: null, intl: null, platform: null },

  reset() {
    this.step = 0;
    this.state = { b2c: null, intl: null, platform: null };
    const chat = $("cf-ai-chat");
    if (chat) chat.innerHTML = "";
    cfPushChat("agent", "On fait un diagnostic rapide.\nRéponds par oui/non (ou je ne sais pas).");
    cfPushChat("agent", "1) Est-ce que tu factures des particuliers (B2C) ?");
  },

  parseYesNo(s) {
    const t = String(s || "").trim().toLowerCase();
    if (!t) return null;
    if (["oui","o","y","yes"].includes(t)) return true;
    if (["non","n","no"].includes(t)) return false;
    return null;
  },

  async answer(text) {
    const yn = this.parseYesNo(text);
    if (this.step === 0) {
      if (yn === null) return cfPushChat("agent", "Répondez par oui/non 🙂");
      this.state.b2c = yn;
      this.step = 1;
      cfPushChat("agent", "2) Est-ce que vous réalisez des ventes/prestations hors France (international) ?");
      return;
    }

    if (this.step === 1) {
      if (yn === null) return cfPushChat("agent", "Répondez par oui/non 🙂");
      this.state.intl = yn;
      this.step = 2;
      cfPushChat("agent", "3) Vous passez par quelle plateforme ? (PA / SC / OTHER) — Choisissez l’une des 3 valeurs.");
      return;
    }

    if (this.step === 2) {
      const t = String(text || "").trim().toUpperCase();
      if (!["PA","OTHER"].includes(t)) return cfPushChat("agent", "Tape PA, SC ou OTHER.");
      this.state.platform = t;
      this.step = 3;

      // appliquer recommandations dans le formulaire
      $("cf-emits-b2c").value = this.state.b2c ? "1" : "0";
      $("cf-has-international").value = this.state.intl ? "1" : "0";
      $("cf-platform").value = this.state.platform;

      // suggestion scope
      $("cf-scope").value = this.state.intl ? "INTL" : "FR";

      // suggestion periodicity (simple)
      $("cf-periodicity").value = (this.state.b2c || this.state.intl) ? "D" : "M";

      cfScheduleSave();

      const concerned = this.state.b2c || this.state.intl;
      const summary = concerned
        ? "✅ Concerné : tu dois préparer les flux e-reporting (B2C et/ou international)."
        : "🟡 A priori moins concerné (B2B domestique pur), mais à confirmer selon ton activité.";

      $("cf-ai-summary").textContent = summary + " J’ai pré-rempli les champs utiles.";
      cfPushChat("agent", summary);
      cfPushChat("agent", "Tu peux cliquer “Vérifier complétude” pour voir les champs manquants.");
      return;
    }
  }
};

async function initConformityPage() {
  if (__cf_inited) {
    // déjà bindé : juste reload
    await cfLoadToForm();
    return;
  }
  __cf_inited = true;

  // bind changements => save
  ["cf-scope","cf-periodicity","cf-archiving","cf-platform","cf-next-due","cf-emits-b2c","cf-has-international"]
    .forEach(id => {
      const el = $(id);
      if (!el) return;
      el.addEventListener("change", () => {
        cfScheduleSave();
        cfLoadToForm().catch(console.error);
      });
      el.addEventListener("input", () => {
        if (id === "cf-next-due") cfScheduleSave();
      });
    });

  // boutons IA
  $("cf-ai-start")?.addEventListener("click", () => cfAgent.reset());
  $("cf-ai-send")?.addEventListener("click", async () => {
    const inp = $("cf-ai-input");
    if (!inp) return;
    const t = inp.value.trim();
    if (!t) return;
    inp.value = "";
    cfPushChat("user", t);
    await cfAgent.answer(t);
  });
  $("cf-ai-input")?.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") $("cf-ai-send")?.click();
  });

  $("cf-ai-recommend")?.addEventListener("click", async () => {
    const cfg = await cfLoadToForm();
    const elig = cfComputeEligibility(cfg);
    cfPushChat("agent", "Recommandations :\n" + [
      `- Plateforme: ${cfg.platform || "à choisir"}`,
      `- Scope: ${cfg.scope}`,
      `- Périodicité: ${cfg.periodicity}`,
      `- Archivage: ${cfg.archiving} (ON recommandé)`,
      elig.concerned ? "- Vous êtes concerné : préparez les contrôles + preuves (journal/audit)." : "- Cas simple : vérifiez si vous avez du B2C/INTL."
    ].join("\n"));
  });

  $("cf-ai-check")?.addEventListener("click", async () => {
    const cfg = await cfLoadToForm();
    const missing = cfMissingFields(cfg);
    if (!missing.length) {
      cfPushChat("agent", "✅ Tous les champs “bloquants” sont remplis.");
    } else {
      cfPushChat("agent", "⚠️ Champs à compléter : " + missing.join(", "));
    }
  });

  // premier load
  await cfLoadToForm();
}

/* ----------------- Inbound UI helpers ----------------- */
// ✅ Statuts inbound supprimables / décisionnables
const INBOUND_DELETABLE_STATUSES = new Set(["received", "validated", "received_not_valid", "non_valid", "invalid", "error"]);

const INBOUND_DECIDABLE_STATUSES = new Set(["received", "received_not_valid", "non_valid", "invalid"]);

function inboundStatusLabel(st) {
  const s = String(st || "received").toLowerCase();

  if (s === "accepted") return t("inbound.status.accepted", "Acceptée");
  if (s === "refused") return t("inbound.status.refused_buyer", "Refusée (acheteur)");
  if (s === "rejected") return t("inbound.status.rejected_platform", "Rejetée (plateforme)");
  if (s === "disputed") return t("inbound.status.disputed", "Litige");
  if (s === "received") return t("inbound.status.received", "Reçue");
  if (s === "received_not_valid" || s === "non_valid" || s === "invalid") return t("inbound.status.received_not_valid", "Reçue (non valide)");
  if (s === "error") return t("inbound.status.error", "Erreur");
  return s;
}

function inboundStatusPillClass(st) {
  const s = String(st || "received").toLowerCase();

  if (s === "accepted") return "pill pill--ok";
  if (s === "refused" || s === "rejected") return "pill pill--danger";
  if (s === "disputed") return "pill pill--warn";

  if (s === "received_not_valid" || s === "non_valid" || s === "invalid") return "pill pill--warn";
  if (s === "error") return "pill pill--warn";
  return "pill";
}

function inferInboundFormatLabel(doc) {
  // Objectif: afficher un label même si le backend n'envoie pas "format"
  // Exemples possibles: UBL, Factur-X, PDF, XML, PEPPOL...
  const d = doc || {};
  const fmt =
    String(d.format || d.doc_format || d.file_format || d.mime || d.mimetype || "")
      .trim()
      .toLowerCase();

  // heuristiques simples
  if (fmt.includes("factur") || fmt.includes("zugferd")) return "Factur-X";
  if (fmt.includes("ubl")) return "UBL";
  if (fmt.includes("xml")) return "XML";
  if (fmt.includes("pdf")) return "PDF";

  // fallback: si on a un nom de fichier
  const name = String(d.filename || d.file_name || d.original_name || "").toLowerCase();
  if (name.endsWith(".xml")) return "XML";
  if (name.endsWith(".pdf")) return "PDF";

  return t("inbound.detail.format_unknown", "Inconnu");
}

/* ----------------- Inbound detail (rich) helpers ----------------- */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escLabel(s) {
  return esc(normalizeLabel(s)); // decode &#039; puis escape XSS
}

function sniffDelimiter(text) {
  const sample = String(text || "").slice(0, 2000);
  const candidates = [",", ";", "\t", "|"];
  const counts = candidates.map((d) => [d, (sample.match(new RegExp(d === "\t" ? "\\t" : "\\" + d, "g")) || []).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]?.[1] ? counts[0][0] : ",";
}

function parseCsv(text, delimiter, hasHeader) {
  // CSV “light” : gère guillemets, séparateurs basiques
  const d = delimiter === "auto" ? sniffDelimiter(text) : delimiter;
  const rows = [];
  let cur = [];
  let cell = "";
  let inQ = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') {
      // double quote escape
      if (inQ && text[i + 1] === '"') { cell += '"'; i++; }
      else inQ = !inQ;
      continue;
    }
    if (!inQ && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cur.push(cell);
      rows.push(cur.map((x) => String(x ?? "")));
      cur = [];
      cell = "";
      continue;
    }
    if (!inQ && ch === d) {
      cur.push(cell);
      cell = "";
      continue;
    }
    cell += ch;
  }
  if (cell.length || cur.length) { cur.push(cell); rows.push(cur.map((x) => String(x ?? ""))); }

  const clean = rows.filter((r) => r.some((c) => String(c).trim() !== ""));
  if (!clean.length) return { headers: [], data: [], delimiter: d };

  let headers = [];
  let data = clean;

  if (hasHeader) {
    headers = clean[0].map((h, idx) => (String(h || "").trim() || `col_${idx + 1}`));
    data = clean.slice(1);
  } else {
    headers = clean[0].map((_, idx) => `col_${idx + 1}`);
  }

  return { headers, data, delimiter: d };
}

// champs client supportés (mapping)
const CLIENT_FIELDS = [
  { key: "customer_type", labelKey: "clients.field.customer_type", fallback: "Type client (B2C/B2B/B2G)" },
  { key: "name", labelKey: "clients.field.name", fallback: "Nom" },
  { key: "email", labelKey: "clients.field.email", fallback: "Email" },
  { key: "phone", labelKey: "clients.field.phone", fallback: "Téléphone" },
  { key: "country", labelKey: "clients.field.country", fallback: "Pays" },
  { key: "vat_subject", labelKey: "clients.field.vat_subject", fallback: "Assujetti TVA (0/1)" },
  { key: "vat_id", labelKey: "clients.field.vat_id", fallback: "N° TVA" },
  { key: "legal_id", labelKey: "clients.field.legal_id", fallback: "ID légal (SIRET/SIREN/etc)" },
  { key: "street", labelKey: "clients.field.street", fallback: "Adresse ligne 1" },
  { key: "street2", labelKey: "clients.field.street2", fallback: "Adresse ligne 2" },
  { key: "postal_code", labelKey: "clients.field.postal_code", fallback: "Code postal" },
  { key: "city", labelKey: "clients.field.city", fallback: "Ville" },
  { key: "payment_term", labelKey: "clients.field.payment_term", fallback: "Conditions paiement (code)" },
  { key: "payment_days", labelKey: "clients.field.payment_days", fallback: "Jours paiement" },
  { key: "payment_text", labelKey: "clients.field.payment_text", fallback: "Texte paiement" },
  { key: "quote_validity_days", labelKey: "clients.field.quote_validity_days", fallback: "Validité devis (jours)" },
  { key: "notes", labelKey: "clients.field.notes", fallback: "Notes" },
];

function guessMapping(headers) {
  const h = headers.map((x) => String(x || "").toLowerCase().trim());
  const map = {};
  const find = (regexes) => h.findIndex((v) => regexes.some((r) => r.test(v)));

  const rules = [
    ["name", [/^name$/, /nom/, /client/, /raison/]],
    ["email", [/email/, /e-mail/, /mail/]],
    ["phone", [/phone/, /téléphone/, /tel/, /mobile/]],
    ["country", [/country/, /pays/]],
    ["vat_id", [/vat/, /tva/, /intracom/]],
    ["legal_id", [/siret/, /siren/, /rccm/, /id legal/, /company id/]],
    ["street", [/address 1/, /adresse 1/, /^address$/, /^adresse$/, /street/]],
    ["street2", [/address 2/, /adresse 2/, /street2/]],
    ["postal_code", [/postal/, /zip/, /cp/]],
    ["city", [/city/, /ville/]],
    ["customer_type", [/type/, /b2b/, /b2c/, /b2g/]],
    ["notes", [/notes/, /comment/]],
  ];

  for (const [field, regs] of rules) {
    const idx = find(regs);
    if (idx >= 0) map[field] = headers[idx];
  }
  return map;
}

function num(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}
function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
}
function formatParty(p) {
  if (!p || typeof p !== "object") return { name: "—", vat: "", id: "", addr: "" };

  const address = p.address || p.postal_address || p.addr || {};
  const name = pick(p, ["name", "legal_name", "registration_name", "party_name"]) || "—";
  const vat = pick(p, ["vat_id", "vat", "vat_number", "vatId"]);
  const id = pick(p, ["legal_id", "company_id", "siret", "siren", "registration_id", "id"]);
  const addr = [
    pick(address, ["street", "line1", "address_line1"]),
    pick(address, ["street2", "line2", "address_line2"]),
    [pick(address, ["postal_code", "zip"]), pick(address, ["city", "town"])].filter(Boolean).join(" "),
    pick(address, ["country", "country_code"]),
  ]
    .filter(Boolean)
    .join(", ");

  return { name, vat, id, addr };
}

// essaie de trouver un "destinataire" selon les normalisations possibles
function extractRecipient(canonical) {
  const inv = canonical || {};
  const buyer = inv.buyer || {};

  const r =
    inv.recipient ||
    inv.invoicee ||
    inv.delivery ||
    inv.ship_to ||
    buyer.recipient ||
    buyer.contact ||
    null;

  return r ? formatParty(r) : null;
}

function calcLinesHT(lines) {
  return (Array.isArray(lines) ? lines : []).reduce((acc, l) => {
    return acc + num(l.line_total_ht ?? l.line_total ?? l.net_amount ?? l.ht ?? 0);
  }, 0);
}

function buildVatBreakdown(lines) {
  const map = new Map();
  for (const l of Array.isArray(lines) ? lines : []) {
    const rateRaw = l.tva_percent ?? l.vat_percent ?? l.tax_percent;
    const rate = rateRaw === undefined || rateRaw === null || String(rateRaw).trim() === "" ? "—" : String(rateRaw).trim();

    const base = num(l.line_total_ht ?? l.line_total ?? l.net_amount ?? l.ht ?? 0);
    const tax = num(l.line_tax_amount ?? l.tax_amount ?? 0) || (rate !== "—" ? base * (Number(rate) / 100) : 0);

    const cur = map.get(rate) || { base: 0, tax: 0 };
    cur.base += base;
    cur.tax += tax;
    map.set(rate, cur);
  }

  return [...map.entries()].sort((a, b) => {
    if (a[0] === "—") return 1;
    if (b[0] === "—") return -1;
    return Number(a[0]) - Number(b[0]);
  });
}

// compare VAT/ID buyer vs société (si dispo)
function normId(x) {
  return String(x || "").replace(/\s+/g, "").toUpperCase();
}

function renderInboundDetail(doc) {
  const el = $("inboundDetail");
  if (!el) return;

  if (!doc) {
    el.innerHTML = `<div class="card">
      <div class="card__title">${t("inbound.detail.title_fallback", "Détail")}</div>
      <div class="hint">${t("inbound.detail.hint", "Sélectionne une facture reçue.")}</div>
    </div>`;
    renderToolbar("inbound");
    return;
  }

  const d = normalizeInbound(doc);

  // --- décision / code (CREDITOR:RF01, PLATFORM:RFxx, etc.)
  const rawCode = String(doc?.reject_code || doc?.response_code || d?.reject_code || "").toUpperCase();
  const isCreditorRefusal = rawCode.startsWith("CREDITOR:");
  const isPlatformRejection = rawCode.startsWith("PLATFORM:");
  const rfCode = rawCode.includes(":") ? rawCode.split(":")[1] : rawCode;

  // --- statut affiché
  let statusText = inboundStatusLabel(d.status);
  if (d.status === "refused" && isCreditorRefusal) statusText = t("inbound.status.refused_buyer", "Refusée (acheteur)");
  if (d.status === "rejected" && isPlatformRejection) statusText = t("inbound.status.rejected_platform", "Rejetée (plateforme)");

  const reason = String(d.reject_reason || d.response_reason || "").trim();

  // --- warnings/errors robustes
  let warnMsg = "";
  try {
    warnMsg =
      doc?.warnings?.message ||
      (typeof doc?.warnings_json === "string" ? (JSON.parse(doc.warnings_json || "{}")?.message || "") : "");
  } catch {}

  let errMsg = "";
  try {
    errMsg =
      doc?.errors?.message ||
      (typeof doc?.errors_json === "string" ? (JSON.parse(doc.errors_json || "{}")?.message || "") : "");
  } catch {}

  const fmtLabel = typeof inferInboundFormatLabel === "function" ? inferInboundFormatLabel(doc) : "—";

  // --- canonical (déjà fourni par inbound:get)
  const inv = doc?.canonical || null;
  const seller = formatParty(inv?.seller || {});
  const buyer = formatParty(inv?.buyer || {});
  const recipient = extractRecipient(inv);

  const totals = inv?.totals || {};
  const lines = Array.isArray(inv?.lines) ? inv.lines : [];

  const totalHT =
    num(totals.total_ht) ||
    num(totals.tax_exclusive_amount) ||
    calcLinesHT(lines);

  const totalTVA =
    num(totals.total_tva) ||
    num(totals.tax_amount) ||
    0;

  const totalTTC =
    num(totals.grand_total) ||
    num(totals.payable_amount) ||
    num(totals.amount_due) ||
    num(totals.total_ttc) ||
    num(totals.tax_inclusive_amount) ||
    num(d.total_ttc) ||
    0;

  const currency = d.currency || inv?.currency || "EUR";

  // --- Alertes utiles à la validation/refus
  const alerts = [];

  // écart lignes vs total HT
  const sumLinesHT = calcLinesHT(lines);
  if (lines.length && Math.abs(sumLinesHT - totalHT) > 0.02) {
    alerts.push(`${t("inbound.alert.ht_mismatch", "Écart total HT")}: lignes=${money(sumLinesHT)} vs total=${money(totalHT)} ${currency}`);
  }

  // acheteur != société (si state.company chargé)
  const coVat = normId(state.company?.vat_id);
  const coId = normId(state.company?.legal_id);
  const buyerVat = normId(buyer.vat);
  const buyerId = normId(buyer.id);

  if (coVat && buyerVat && coVat !== buyerVat) {
    alerts.push(`${t("inbound.alert.buyer_vat_mismatch", "TVA acheteur différente")}: facture=${buyerVat} attendu=${coVat}`);
  }
  if (!coVat && coId && buyerId && coId !== buyerId) {
    alerts.push(`${t("inbound.alert.buyer_id_mismatch", "ID acheteur différent")}: facture=${buyerId} attendu=${coId}`);
  }

  // lignes sans désignation / TVA manquante (pratique pour refuser proprement)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] || {};
    const desc = String(l.description || l.name || l.label || "").trim();
    if (!desc) {
      alerts.push(`${t("inbound.alert.line_empty_desc", "Ligne sans désignation")}: #${i + 1}`);
      break;
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] || {};
    const rate = l.tva_percent ?? l.vat_percent ?? l.tax_percent;
    if (rate === undefined || rate === null || String(rate).trim() === "") {
      alerts.push(t("inbound.alert.vat_missing", "Au moins une ligne a un taux TVA manquant."));
      break;
    }
  }

  // TVA breakdown (estimation si pas fourni)
  const vatBreakdown = buildVatBreakdown(lines);

  // --- Render lignes
  const lineRows = lines
    .map((l) => {
      const desc = escLabel(l.description || l.name || l.label || "—");
      const qty = esc(l.quantity ?? l.qty ?? "");
      const pu = money(l.unit_price_ht ?? l.unit_price ?? l.price ?? 0);
      const vat = esc(l.tva_percent ?? l.vat_percent ?? l.tax_percent ?? "");
      const ht = money(l.line_total_ht ?? l.line_total ?? l.net_amount ?? l.ht ?? 0);
      return `
        <div class="table__row">
          <div title="${desc}">${desc}</div>
          <div class="t-right">${qty}</div>
          <div class="t-right">${pu}</div>
          <div class="t-right">${vat}</div>
          <div class="t-right">${ht}</div>
          <div></div>
        </div>
      `;
    })
    .join("");

  const recipientHtml = recipient
    ? `<div class="hint"><strong>${t("inbound.detail.recipient", "Destinataire")}</strong><br/>
        ${esc(recipient.name)}<br/>
        ${recipient.vat ? `TVA: ${esc(recipient.vat)}<br/>` : ""}
        ${recipient.id ? `ID: ${esc(recipient.id)}<br/>` : ""}
        ${recipient.addr ? `${esc(recipient.addr)}` : ""}
      </div>`
    : `<div class="hint"><strong>${t("inbound.detail.recipient", "Destinataire")}</strong><br/>—</div>`;

  const alertsHtml = alerts.length
    ? `<div class="u-mt">
        <div class="card__title">${t("inbound.detail.alerts", "Alertes (risques de refus)")}</div>
        <div class="hint" style="color: rgba(239,68,68,.9)">${alerts.map((a) => `• ${esc(a)}`).join("<br/>")}</div>
      </div>`
    : "";

  const vatHtml = vatBreakdown.length
    ? `<div class="u-mt">
        <div class="card__title">${t("inbound.detail.vat_breakdown", "TVA (détail estimé)")}</div>
        <div class="totals">
          ${vatBreakdown
            .map(([rate, v]) => {
              const label = rate === "—" ? t("inbound.detail.vat_unknown", "Taux —") : `${t("inbound.detail.vat_rate", "Taux")} ${esc(rate)}%`;
              return `<div class="totals__row">
                <span>${label}</span>
                <strong>${t("inbound.detail.base", "Base")} ${money(v.base)} • ${t("inbound.detail.vat", "TVA")} ${money(v.tax)} ${esc(currency)}</strong>
              </div>`;
            })
            .join("")}
        </div>
      </div>`
    : "";

  // --- Final HTML
  el.innerHTML = `
    <div class="card">
      <div class="card__title">${t("inbound.detail.title", "Facture reçue")}</div>

      <div class="hint">
        ${t("inbound.detail.status", "Statut")}:
        <span class="${inboundStatusPillClass(d.status)}">${statusText}</span>
      </div>

      <div class="u-mt">
        <div><strong>${t("inbound.detail.format", "Format")}:</strong> ${esc(fmtLabel)}</div>
        <div><strong>${t("inbound.detail.number", "Numéro")}:</strong> ${escLabel(d.doc_number || "—")}</div>
        <div><strong>${t("inbound.detail.date", "Date")}:</strong> ${esc(d.doc_date || "—")}</div>
        <div><strong>${t("inbound.detail.supplier", "Fournisseur")}:</strong> ${escLabel(d.supplier_name || "—")}</div>
        <div><strong>${t("inbound.detail.total", "Total")}:</strong> ${money(totalTTC)} ${esc(currency)}</div>
        ${rfCode ? `<div><strong>${t("inbound.detail.reason_code", "Code")}:</strong> ${esc(rfCode)}</div>` : ""}
      </div>

        ${reason ? `<div class="u-mt"><strong>${t("inbound.detail.reason", "Motif")}:</strong><br>${escLabel(reason)}</div>` : ""}

      <div class="u-mt row2">
        <div>
          <div class="card__title" style="margin:0 0 8px">${t("inbound.detail.seller", "Fournisseur")}</div>
          <div class="hint">
            <strong>${escLabel(seller.name)}</strong><br/>
            ${seller.vat ? `${t("party.vat","TVA")}: ${esc(seller.vat)}<br/>` : ""}
            ${seller.id ? `${t("party.id","ID")}: ${esc(seller.id)}<br/>` : ""}
            ${seller.addr ? `${esc(seller.addr)}` : ""}
          </div>
        </div>
        <div>
          <div class="card__title" style="margin:0 0 8px">${t("inbound.detail.buyer", "Acheteur")}</div>
          <div class="hint">
            <strong>${escLabel(buyer.name)}</strong><br/>
            ${buyer.vat ? `TVA: ${esc(buyer.vat)}<br/>` : ""}
            ${buyer.id ? `ID: ${esc(buyer.id)}<br/>` : ""}
            ${buyer.addr ? `${esc(buyer.addr)}` : ""}
          </div>
          <div class="u-mt--sm">${recipientHtml}</div>
        </div>
      </div>

      <div class="u-mt">
        <div class="card__title">${t("inbound.detail.totals", "Totaux")}</div>
        <div class="totals">
          <div class="totals__row"><span>${t("inbound.detail.total_ht", "Total HT")}</span><strong>${money(totalHT)} ${esc(currency)}</strong></div>
          <div class="totals__row"><span>${t("inbound.detail.total_vat", "Total TVA")}</span><strong>${money(totalTVA)} ${esc(currency)}</strong></div>
          <div class="totals__row"><span>${t("inbound.detail.total_ttc", "Total TTC")}</span><strong>${money(totalTTC)} ${esc(currency)}</strong></div>
        </div>
      </div>

      ${vatHtml}

      <div class="u-mt">
        <div class="card__title">${t("inbound.detail.lines", "Lignes")}</div>
        <div class="table">
          <div class="table__head">
            <div>${t("inbound.lines.desc", "Désignation")}</div>
            <div class="t-right">${t("inbound.lines.qty", "Qté")}</div>
            <div class="t-right">${t("inbound.lines.unit", "PU HT")}</div>
            <div class="t-right">TVA%</div>
            <div class="t-right">${t("inbound.lines.total_ht", "Total HT")}</div>
            <div></div>
          </div>
          ${lineRows || `<div class="table__row"><div>—</div><div></div><div></div><div></div><div></div><div></div></div>`}
        </div>
      </div>

      ${alertsHtml}

      ${warnMsg ? `<div class="u-mt"><strong>${t("inbound.detail.warning", "Avertissement")}:</strong><br>${esc(warnMsg)}</div>` : ""}
      ${
        errMsg
          ? `<div class="u-mt"><strong>${t("inbound.detail.error", "Erreur technique")}:</strong><br>
              <code style="white-space:pre-wrap;color:#f87171;">${esc(errMsg)}</code>
            </div>`
          : ""
      }
    </div>
  `;

  renderToolbar("inbound");
}

/* ----------------- Dashboard render ----------------- */
function renderDashboard() {
  const q = state.dashboard?.quotes || {};
  const qc = q.counts || {};
  const qa = q.amounts || {};
  const i = state.dashboard?.invoices || {};
  const p = state.dashboard?.payments || {};
  const by = p.by_method || {};
  const dep = state.dashboard?.deposits || {};

  const elQ = $("dashQuotesKpis");
  const elI = $("dashInvoicesKpis");
  const elP = $("dashPaymentsKpis");
  const elB = $("dashPaymentsByMethod");

  const hasDepositsBlock =
    !!document.getElementById("dash-deposits-issued") ||
    !!document.getElementById("dash-deposits-paid") ||
    !!document.getElementById("dash-deposits-waiting") ||
    !!document.getElementById("dash-deposits-count");

  if (elQ) {
    elQ.innerHTML = `
      <div class="totals">
        <div class="totals__row"><span>${t("dash.quotes.done", "Devis faits")}</span><strong>${Number(qc.done || 0)} — ${money(Number(qa.done || 0))} €</strong></div>
        <div class="totals__row"><span>${t("dash.quotes.accepted", "Valides")}</span><strong>${Number(qc.accepted || 0)} — ${money(Number(qa.accepted || 0))} €</strong></div>
        <div class="totals__row"><span>${t("dash.quotes.refused", "Refusés")}</span><strong>${Number(qc.rejected || 0)} — ${money(Number(qa.rejected || 0))} €</strong></div>
      </div>
    `;
  }

  if (elI) {
    elI.innerHTML = `
      <div class="totals">
        <div class="totals__row"><span>${t("dash.invoices.issued", "Émises")}</span><strong>${Number(i.issued || 0)}</strong></div>
        <div class="totals__row"><span>${t("dash.invoices.paid", "Payées")}</span><strong>${Number(i.paid || 0)}</strong></div>
        <div class="totals__row"><span>${t("dash.invoices.waiting", "En attente")}</span><strong>${Number(i.waiting || 0)}</strong></div>
      </div>
    `;
  }

  if (elP) {
    elP.innerHTML = `
      <div class="totals">
        <div class="totals__row"><span>${t("dash.payments.total", "Total encaissé")}</span><strong>${money(Number(p.total || 0))} €</strong></div>
      </div>
    `;
  }

  if (elB) {
    const labels = {
      card: t("pay.method.card", "CB"),
      transfer: t("pay.method.transfer", "Virement"),
      cash: t("pay.method.cash", "Espèces"),
      check: t("pay.method.check", "Chèque"),
      sepa: t("pay.method.sepa", "Prélèvement"),
      other: t("pay.method.other", "Autre"),
    };

    const list = Array.isArray(p.by_method) ? p.by_method : [];

    const rows = list
      .slice()
      .sort((a, b) => Number(b?.total || 0) - Number(a?.total || 0))
      .map((row) => {
        const k = String(row?.method || "other");
        const v = Number(row?.total || 0);
        return `<div class="totals__row"><span>${labels[k] || k}</span><strong>${money(v)} €</strong></div>`;
      })
      .join("");

    elB.innerHTML = rows
      ? `<div class="totals">${rows}</div>`
      : `<div class="hint">${t("dash.payments.none", "Aucun encaissement enregistré.")}</div>`;
  }

  // ---------------- ACOMPTES (Deposit invoices) ----------------

  if (hasDepositsBlock) {
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    setText("dash-deposits-issued", `${money(Number(dep.issued_ttc || 0))} €`);
    setText("dash-deposits-paid", `${money(Number(dep.paid_ttc || 0))} €`);
    setText("dash-deposits-waiting", `${money(Number(dep.waiting_ttc || 0))} €`);

    // ✅ optionnel: si tu ajoutes un élément pour count plus tard
    setText("dash-deposits-count", String(Number(dep.count_issued || 0)));
  }
}

/* ----------------- Payments page ----------------- */
function paymentInvoiceAmount(invoice) {
  const totalTtc = Number(invoice?.total_ttc ?? 0) || 0;
  const prepaid = String(invoice?.type || "").toLowerCase() === "final"
    ? Number(invoice?.prepaid_amount || 0) || 0
    : 0;
  if (totalTtc > 0) return Math.max(0, round2(totalTtc - prepaid));
  return Math.max(0, Number(invoice?.amount_due || 0) || 0);
}

function paymentInvoiceStatus(invoice, paidAmount) {
  const due = paymentInvoiceAmount(invoice);
  if (due <= 0 || Number(paidAmount || 0) + 0.001 >= due) return "paid";
  if (Number(paidAmount || 0) > 0) return "partial";
  return "unpaid";
}

function paymentStatusText(status) {
  return t(`payments.status.${status}`, status);
}

function renderPaymentOverview(invoices, payments) {
  const kpisEl = document.getElementById("p-paymentKpis");
  const summaryEl = document.getElementById("p-invoiceSummary");
  const statusFilter = String(document.getElementById("p-payment-status")?.value || "all");
  const receivables = (Array.isArray(invoices) ? invoices : []).filter((invoice) =>
    String(invoice?.status || "").toLowerCase() === "issued" && String(invoice?.type || "").toLowerCase() !== "credit_note"
  );
  const paidByInvoice = new Map();
  let totalPaid = 0;
  for (const payment of Array.isArray(payments) ? payments : []) {
    const invoiceId = String(payment?.invoice_id || payment?.invoiceId || "");
    const amount = Number(payment?.amount || 0) || 0;
    totalPaid += amount;
    if (invoiceId) paidByInvoice.set(invoiceId, round2((paidByInvoice.get(invoiceId) || 0) + amount));
  }

  const rows = receivables.map((invoice) => {
    const paid = Number(paidByInvoice.get(String(invoice.id)) || 0);
    const due = paymentInvoiceAmount(invoice);
    return {
      invoice,
      paid,
      due,
      remaining: Math.max(0, round2(due - paid)),
      paymentStatus: paymentInvoiceStatus(invoice, paid),
    };
  });
  const paidCount = rows.filter((row) => row.paymentStatus === "paid").length;
  const outstanding = round2(rows.reduce((sum, row) => sum + row.remaining, 0));

  if (kpisEl) {
    const kpis = [
      [t("payments.overview.total_paid", "Total encaissé"), `${money(totalPaid)} €`],
      [t("payments.overview.operations", "Paiements enregistrés"), String((payments || []).length)],
      [t("payments.overview.paid_invoices", "Factures payées"), `${paidCount} / ${rows.length}`],
      [t("payments.overview.outstanding", "Reste à encaisser"), `${money(outstanding)} €`],
    ];
    kpisEl.innerHTML = kpis.map(([label, value]) => `
      <div class="kpi">
        <div class="kpi__label">${esc(label)}</div>
        <div class="kpi__value">${esc(value)}</div>
      </div>
    `).join("");
  }

  if (!summaryEl) return;
  const filtered = rows
    .filter((row) => statusFilter === "all" || row.paymentStatus === statusFilter)
    .sort((a, b) => b.remaining - a.remaining || String(b.invoice?.date || "").localeCompare(String(a.invoice?.date || "")));

  if (!filtered.length) {
    summaryEl.innerHTML = `<div class="hint">${t("payments.overview.no_invoices", "Aucune facture pour ce filtre.")}</div>`;
    return;
  }

  summaryEl.innerHTML = `
    <div class="paymentsTableWrap">
      <div class="paymentsTable">
        <div class="paymentsTable__row paymentsTable__row--head">
          <div>${t("payments.col.invoice", "Facture")}</div>
          <div>${t("payments.col.client", "Client")}</div>
          <div>${t("payments.col.status", "Statut")}</div>
          <div class="paymentsTable__amount">${t("payments.col.total", "Total")}</div>
          <div class="paymentsTable__amount">${t("payments.col.paid", "Encaissé")}</div>
          <div class="paymentsTable__amount">${t("payments.col.remaining", "Reste")}</div>
        </div>
        ${filtered.map((row) => {
          const invoice = row.invoice || {};
          const invoiceId = String(invoice.id || "");
          return `
            <div class="paymentsTable__row">
              <div><button class="paymentInvoiceButton" type="button" data-payment-invoice="${esc(invoiceId)}">${esc(invoice.invoice_number || invoice.number || invoiceId)}</button></div>
              <div class="paymentsTable__muted" title="${esc(invoice.client_name || "")}">${esc(invoice.client_name || "—")}</div>
              <div><span class="paymentStatus paymentStatus--${row.paymentStatus}">${esc(paymentStatusText(row.paymentStatus))}</span></div>
              <div class="paymentsTable__amount">${money(row.due)} €</div>
              <div class="paymentsTable__amount">${money(row.paid)} €</div>
              <div class="paymentsTable__amount">${money(row.remaining)} €</div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;

  summaryEl.onclick = async (event) => {
    const button = event.target?.closest?.("[data-payment-invoice]");
    if (!button) return;
    const invoiceId = String(button.getAttribute("data-payment-invoice") || "");
    const select = document.getElementById("p-invoice");
    if (!invoiceId || !select) return;
    select.value = invoiceId;
    state.payments.selectedInvoiceId = invoiceId;
    await renderPaymentsPage();
  };
}

async function renderPaymentsPage() {
  const invoiceId = String(document.getElementById("p-invoice")?.value || state.payments.selectedInvoiceId || "").trim();
  state.payments.selectedInvoiceId = invoiceId || null;

  const hint = document.getElementById("p-invoiceHint");
  const listEl = document.getElementById("p-paymentsList");
  const historyTitle = document.getElementById("p-historyTitle");
  const historyHint = document.getElementById("p-historyHint");
  if (!listEl) return;

  listEl.innerHTML = `<div class="hint">${t("payments.loading", "Chargement…")}</div>`;

  let allPayments = [];
  try {
    allPayments = await window.api.payments.listAll({});
  } catch (error) {
    state.payments.list = [];
    listEl.innerHTML = `<div class="hint">${t("payments.load_error", "Impossible de charger les paiements.")}</div>`;
    console.error(error);
    return;
  }

  const unique = new Map();
  for (const payment of Array.isArray(allPayments) ? allPayments : []) {
    const key = String(payment?.id || "") || `${payment?.invoice_id || ""}__${payment?.date || ""}__${payment?.amount || ""}__${payment?.method || ""}`;
    if (!unique.has(key)) unique.set(key, payment);
  }
  state.payments.all = Array.from(unique.values());
  renderPaymentOverview(state.invoices || [], state.payments.all);

  const invoiceMap = new Map((state.invoices || []).map((invoice) => [String(invoice.id || ""), invoice]));
  const selectedInvoice = invoiceMap.get(invoiceId);
  const selectedNumber = selectedInvoice?.invoice_number || selectedInvoice?.number || invoiceId;

  if (hint) {
    hint.textContent = invoiceId
      ? t("payments.select_invoice_hint_one", "Facture sélectionnée : {id}", { id: selectedNumber })
      : t("payments.select_invoice_hint_none", "Toutes les opérations sont visibles. Sélectionnez une facture pour saisir un paiement.");
  }
  if (historyTitle) historyTitle.textContent = invoiceId
    ? t("payments.history_selected.title", "Paiements de la facture")
    : t("payments.history_all.title", "Tous les paiements");
  if (historyHint) historyHint.textContent = invoiceId
    ? t("payments.history_selected.hint", "Historique de {invoice}.", { invoice: selectedNumber })
    : t("payments.history_all.hint", "Historique global, toutes factures confondues.");

  state.payments.list = invoiceId
    ? state.payments.all.filter((payment) => String(payment?.invoice_id || payment?.invoiceId || "") === invoiceId)
    : state.payments.all;

  if (!state.payments.list.length) {
    listEl.innerHTML = `<div class="hint">${invoiceId
      ? t("payments.none_for_invoice", "Aucun paiement sur cette facture.")
      : t("payments.none_all", "Aucun paiement enregistré.")}</div>`;
    return;
  }

  const methodLabels = {
    card: t("pay.method.card", "Carte"),
    transfer: t("pay.method.transfer", "Virement bancaire"),
    cash: t("pay.method.cash", "Espèces"),
    check: t("pay.method.check", "Chèque"),
    sepa: t("pay.method.sepa", "Prélèvement"),
    other: t("pay.method.other", "Autre"),
  };
  const sorted = [...state.payments.list].sort((a, b) =>
    String(b?.created_at || b?.date || "").localeCompare(String(a?.created_at || a?.date || ""))
  );

  listEl.innerHTML = `
    <div class="paymentsTableWrap">
      <div class="paymentsTable">
        <div class="paymentsTable__row paymentsTable__row--head paymentsTable__row--payment">
          <div>${t("pay.col.date", "Date")}</div>
          <div>${t("payments.col.invoice", "Facture")}</div>
          <div>${t("payments.col.client", "Client")}</div>
          <div>${t("pay.col.method", "Moyen")}</div>
          <div>${t("pay.col.reference", "Référence / notes")}</div>
          <div class="paymentsTable__amount">${t("pay.col.amount", "Montant")}</div>
          <div class="paymentsTable__amount">${t("pay.col.action", "Action")}</div>
        </div>
        ${sorted.map((payment) => {
          const paymentId = String(payment?.id || "");
          const linkedInvoice = invoiceMap.get(String(payment?.invoice_id || payment?.invoiceId || "")) || {};
          const method = String(payment?.method || "other").toLowerCase();
          const reference = String(payment?.reference || payment?.notes || "");
          return `
            <div class="paymentsTable__row paymentsTable__row--payment">
              <div>${esc(String(payment?.date || payment?.payment_date || "—"))}</div>
              <div>${esc(linkedInvoice.invoice_number || linkedInvoice.number || "—")}</div>
              <div class="paymentsTable__muted" title="${esc(linkedInvoice.client_name || "")}">${esc(linkedInvoice.client_name || "—")}</div>
              <div>${esc(methodLabels[method] || method)}</div>
              <div class="paymentsTable__muted" title="${esc(reference)}">${esc(reference || "—")}</div>
              <div class="paymentsTable__amount">${money(Number(payment?.amount || 0))} ${esc(String(payment?.currency || "EUR").toUpperCase())}</div>
              <div class="paymentsTable__amount"><button type="button" class="paymentDeleteButton" data-paydel="${esc(paymentId)}" ${paymentId ? "" : "disabled"}>${t("action.delete", "Supprimer")}</button></div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;

  listEl.onclick = async (event) => {
    const button = event.target?.closest?.("[data-paydel]");
    if (!button) return;
    const paymentId = String(button.getAttribute("data-paydel") || "");
    if (!paymentId) return setStatus(t("payments.delete_missing_id", "Identifiant du paiement manquant."));
    try {
      await window.api.payments.delete(paymentId);
      await renderPaymentsPage();
      await refreshModule("dashboard").catch(() => {});
      setStatus(t("status.payment_deleted", "Paiement supprimé"));
    } catch (error) {
      setStatus(t("payments.delete_error", "Impossible de supprimer le paiement."));
      console.error(error);
    }
  };
}

/* ----------------- Quote / Invoice lines editor ----------------- */
function renderLines(container, lines, onChange, onRemove, readOnly = false) {
  if (!container) return;
  container.innerHTML = "";

  const safeLines = Array.isArray(lines) ? lines : [];

  safeLines.forEach((l, idx) => {
    const lt = computeLine(l);
    const row = document.createElement("div");
    row.className = "table__row";

    row.innerHTML = `
      <div class="cell-desc">
        ${
          readOnly
            ? `
              <div class="line-desc-text" title="${normalizeLabel(l.description || "")}">
                ${normalizeLabel(l.description || "")}
              </div>
              ${
                l.details
                  ? `
                    <div class="line-details-text">
                      ${String(l.details || "")}
                    </div>
                  `
                  : ""
              }
            `
            : `
              <input
                class="line-desc cell-input-text"
                data-k="description"
                data-i="${idx}"
                type="text"
                value="${String(l.description || "").replace(/"/g, "&quot;")}"
                placeholder="${t("lines.desc_ph", "Désignation")}"
                data-i18n-attr="placeholder:lines.desc_ph"
              />
              <textarea
                class="line-details cell-input-text"
                data-k="details"
                data-i="${idx}"
                rows="2"
                placeholder="${t("quotes.line_details_ph", "Détails…")}"
                data-i18n-attr="placeholder:quotes.line_details_ph"
              >${String(l.details || "")}</textarea>
            `
        }
      </div>

      <div class="t-right">
        <input
          class="cell-input"
          data-k="quantity"
          data-i="${idx}"
          type="number"
          step="0.01"
          value="${l.quantity}"
          ${readOnly ? "disabled" : ""}
        >
      </div>

      <div class="t-right">
        <input
          class="cell-input"
          data-k="unit_price_ht"
          data-i="${idx}"
          type="number"
          step="0.01"
          value="${l.unit_price_ht}"
          ${readOnly ? "disabled" : ""}
        >
      </div>

      <div class="t-right">
        <input
          class="cell-input"
          data-k="tva_percent"
          data-i="${idx}"
          type="number"
          step="0.01"
          value="${l.tva_percent}"
          ${readOnly ? "disabled" : ""}
        >
      </div>

      <div class="t-right">
        <strong data-linetotal="${idx}">${money(lt.ht)}</strong>
      </div>

      <div class="t-right">
        <button
          class="icon-btn"
          type="button"
          data-rm="${idx}"
          aria-label="${t("action.delete", "Delete")}"
          ${readOnly ? "disabled" : ""}
        >✕</button>
      </div>
    `;

    container.appendChild(row);
    applyStaticI18n(row);
  });

  if (readOnly) return;

  container.querySelectorAll("input.cell-input").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const i = Number(e.target.dataset.i);
      const k = e.target.dataset.k;
      if (!Array.isArray(safeLines) || !safeLines[i]) return;

      const raw = e.target.value;
      safeLines[i][k] = Number(raw);

      if (typeof onChange === "function") {
        onChange(i, k, raw);
      }

      const el = container.querySelector(`[data-linetotal="${i}"]`);
      if (el) el.textContent = money(computeLine(safeLines[i]).ht);
    });
  });

  container.querySelectorAll(".cell-input-text").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const i = Number(e.target.dataset.i);
      const k = e.target.dataset.k;
      if (!Array.isArray(safeLines) || !safeLines[i]) return;

      safeLines[i][k] = e.target.value;

      if (typeof onChange === "function") {
        onChange(i, k, e.target.value);
      }
    });
  });

  container.querySelectorAll("button[data-rm]").forEach((b) => {
    b.addEventListener("click", () => onRemove(Number(b.dataset.rm)));
  });
}

function refreshQuoteTotals() {
  if (!state.quoteDraft) state.quoteDraft = { lines: [] };
  if (!Array.isArray(state.quoteDraft.lines)) state.quoteDraft.lines = [];

  const t_ = computeTotals(state.quoteDraft.lines);

  state.quoteDraft.total_ht = Number(t_.total_ht || 0);
  state.quoteDraft.total_tva = Number(t_.total_tva || 0);
  state.quoteDraft.total_ttc = Number(t_.total_ttc || 0);

  if ($("q-total-ht")) $("q-total-ht").textContent = money(t_.total_ht);
  if ($("q-total-tva")) $("q-total-tva").textContent = money(t_.total_tva);
  if ($("q-total-ttc")) $("q-total-ttc").textContent = money(t_.total_ttc);
}

function refreshInvoiceTotals() {
  if (!state.invoiceDraft) state.invoiceDraft = { lines: [] };
  if (!Array.isArray(state.invoiceDraft.lines)) state.invoiceDraft.lines = [];
  const t_ = computeTotals(state.invoiceDraft.lines);
  if ($("i-total-ht")) $("i-total-ht").textContent = money(t_.total_ht);
  if ($("i-total-tva")) $("i-total-tva").textContent = money(t_.total_tva);
  if ($("i-total-ttc")) $("i-total-ttc").textContent = money(t_.total_ttc);

  const prepaid = Number(state.invoiceDraft.prepaid_amount || 0) || 0;
  const due = Math.max(0, Number(t_.total_ttc || 0) - prepaid);
  if ($("i-prepaid-amount")) $("i-prepaid-amount").textContent = money(prepaid);
  if ($("i-amount-due")) $("i-amount-due").textContent = money(due);
}

function renderQuoteDraft() {
  if (!state.quoteDraft) state.quoteDraft = {};
  if (!Array.isArray(state.quoteDraft.lines)) state.quoteDraft.lines = [];

  if ($("q-id")) $("q-id").value = state.quoteDraft.id || "";
  if ($("q-date")) $("q-date").value = state.quoteDraft.date || new Date().toISOString().slice(0, 10);
  if ($("q-client")) $("q-client").value = state.quoteDraft.client_id || $("q-client")?.value || "";

  if ($("q-vat-mode")) $("q-vat-mode").value = state.quoteDraft.vat_mode || getVatModeFromUi("q");
  setVatEffectiveToUi("q", state.quoteDraft.vat_effective || "AUTO");

  if ($("q-validity-days")) $("q-validity-days").value = state.quoteDraft.validity_days ?? $("q-validity-days")?.value ?? "";
  if ($("q-valid-until")) $("q-valid-until").value = state.quoteDraft.valid_until || $("q-valid-until")?.value || "";
  if ($("q-payment-text")) $("q-payment-text").value = state.quoteDraft.payment_text || $("q-payment-text")?.value || "";

  renderLines(
    $("q-lines"),
    state.quoteDraft.lines,
    () => {
      refreshQuoteTotals();
      applyLinesGridLayout("quotes");
      applyStaticI18n($("q-lines"));
    },
    (i) => {
      state.quoteDraft.lines.splice(i, 1);
      refreshQuoteTotals();
      renderQuoteDraft();
    }
  );

  refreshQuoteTotals();
  applyLinesGridLayout("quotes");

  const badge = document.getElementById("q-status-badge");
  if (!badge) {
    console.warn("[renderQuoteDraft] q-status-badge introuvable dans le DOM");
    return;
  }

  const st = String(state.quoteDraft?.status || "draft").toLowerCase();

  const labelByStatus = {
    draft: "Brouillon",
    sent: "Envoyé",
    accepted: "Accepté",
    rejected: "Refusé",
    cancelled: "Annulé",
  };

  const label = labelByStatus[st] || st;

  // texte + affichage
  badge.textContent = label;
  badge.style.display = "inline-block"; // ✅ override du display:none

  // classes
  badge.classList.remove(
    "q-status--draft",
    "q-status--sent",
    "q-status--accepted",
    "q-status--rejected",
    "q-status--cancelled"
  );
  badge.classList.add("q-status-badge", "q-status--" + st);

  // fallback inline styles au cas où styles.css n'est pas chargé / pas à jour
  const colors = {
    draft: { bg: "#f3f4f6", fg: "#374151", bd: "#d1d5db" },
    sent: { bg: "#e8f1ff", fg: "#1d4ed8", bd: "#a8c7ff" },
    accepted: { bg: "#e7f7ed", fg: "#116b2d", bd: "#8fe0aa" },
    rejected: { bg: "#fee2e2", fg: "#991b1b", bd: "#fca5a5" },
    cancelled: { bg: "#fff7ed", fg: "#9a3412", bd: "#fdba74" },
  };

  const c = colors[st] || colors.draft;
  badge.style.background = c.bg;
  badge.style.color = c.fg;
  badge.style.borderColor = c.bd;

  console.log("[renderQuoteDraft] status badge:", { status: st, label });
}

(function renderQuoteDepositsUi() {
  const hintEl = document.getElementById("q-deposits-hint");
  const boxEl = document.getElementById("q-deposits-box");
  const totalEl = document.getElementById("q-deposits-total");
  const listEl = document.getElementById("q-deposits-list");

  if (!hintEl || !boxEl || !totalEl || !listEl) return;

  const deps = Array.isArray(state.quoteDraft?.deposits) ? state.quoteDraft.deposits : [];
  const total = Number(state.quoteDraft?.deposits_total_ttc || 0);

  if (!deps.length) {
    hintEl.textContent = t("quotes.deposits.none", "Aucun acompte généré pour ce devis.");
    boxEl.style.display = "none";
    listEl.innerHTML = "";
    return;
  }

  hintEl.textContent = t("quotes.deposits.found", "{n} acompte(s) trouvé(s).", { n: deps.length });
  boxEl.style.display = "block";
  totalEl.textContent = `${money(total)} €`;

  // liste simple (numéro / statut / total) + bouton ouvrir
  listEl.innerHTML = `
    <div class="totals">
      ${deps.map((inv) => {
        const id = String(inv.id || "");
        const num = inv.invoice_number || inv.number || id;
        const st = String(inv.status || "").toLowerCase();
        const ttc = money(Number(inv.total_ttc || 0));
        return `
          <div class="totals__row">
            <span>${esc(String(num))} • ${esc(st || "—")}</span>
            <strong>${ttc} €</strong>
            <button type="button"
              class="btn btn--secondary"
              style="margin-left:10px;padding:6px 10px;"
              data-open-invoice="${esc(id)}">
              ${t("action.open", "Ouvrir")}
            </button>
          </div>
        `;
      }).join("")}
    </div>
  `;

  // open invoice (delegation)
  listEl.onclick = (ev) => {
    const btn = ev.target?.closest?.("[data-open-invoice]");
    if (!btn) return;
    const id = String(btn.getAttribute("data-open-invoice") || "");
    if (!id) return;
    state.selectedInvoiceId = id;
    showPage("invoices");
  };
})();

function renderInvoiceDraft() {
  if ($("i-id")) $("i-id").value = state.invoiceDraft.id || "";
  if ($("i-date")) $("i-date").value = state.invoiceDraft.date || new Date().toISOString().slice(0, 10);
  if ($("i-client")) $("i-client").value = state.invoiceDraft.client_id || $("i-client")?.value || "";

  if ($("i-vat-mode")) $("i-vat-mode").value = state.invoiceDraft.vat_mode || getVatModeFromUi("i");
  setVatEffectiveToUi("i", state.invoiceDraft.vat_effective || "AUTO");

  const readOnly = state.invoiceDraft?.id && !isDraftInvoice();

  renderLines(
    $("i-lines"),
    state.invoiceDraft.lines,
    () => {
      refreshInvoiceTotals();
      applyLinesGridLayout("invoices");
    },
    (i) => {
      state.invoiceDraft.lines.splice(i, 1);
      refreshInvoiceTotals();
      renderInvoiceDraft();
    },
    readOnly
  );

  refreshInvoiceTotals();
  applyLinesGridLayout("invoices");
  renderToolbar("invoices");
}

/* ----------------- Exports selectors ----------------- */
function getSelectedExportQuoteId() {
  const sel = $("ex-quote");
  const v = String(sel?.value || "").trim();
  return v || null;
}
function getSelectedExportInvoiceId() {
  const sel = $("ex-invoice");
  const v = String(sel?.value || "").trim();
  return v || null;
}
function getExportLocale() {
  const v = String($("ex-locale")?.value || state.lang || "fr").toLowerCase();
  return ["fr", "en", "sr", "es", "it"].includes(v) ? v : "fr";
}
function fillExportsPickers() {
  ensureExportLocaleOptions();
  setExportLocaleUi(state.lang);
  setSelectOptions(
    $("ex-quote"),
    (state.quotes || []).map((q) => ({
      id: q.id,
      label: `${q.number || q.id} — ${q.client_name || "—"} • ${money(q.total_ttc)} €`,
    })),
    getSelectedExportQuoteId() || state.selectedQuoteId || state.quoteDraft?.id
  );

  setSelectOptions(
    $("ex-invoice"),
    (state.invoices || []).map((i) => ({
      id: i.id,
      label: `${i.invoice_number || i.id} — ${i.client_name || "—"} • ${money(i.total_ttc)} €`,
    })),
    getSelectedExportInvoiceId() || state.selectedInvoiceId || state.invoiceDraft?.id
  );
}

/* ----------------- Deposits helpers ----------------- */
async function loadDepositsForQuote(quoteId) {
  if (!quoteId) return [];

  const invoices = (await window.api.invoices.list({ q: "" })).map(normalizeInvoice);

  return invoices.filter((inv) => {
    const qid =
      inv.quote_id ??
      inv.source_quote_id ??
      inv.meta_json?.quote_id ??
      inv.meta_json?.source_quote_id ??
      null;

    return String(qid || "") === String(quoteId) && invoiceKind(inv) === "deposit";
  });
}

/* ----------------- Refresh per module ----------------- */
async function refreshModule(moduleKey) {
  if (moduleKey === "company") {
    state.company = await window.api.company.get();
    if (state.company) fillCompanyForm(state.company);
    return;
  }

  if (moduleKey === "dashboard") {
    await computeAndRenderDashboard();
    return;
  }

  // ===================== BEGIN PATCH E-INVOICING / E-REPORTING (REFRESH MODULE) =====================
if (moduleKey === "conformity") {
  // 1) Lire la config depuis la fiche Société (DB)
  let cfg = null;

  if (window.api?.conformity?.getConfig) {
    cfg = await window.api.conformity.getConfig();
  } else if (window.api?.company?.getConformityConfig) {
    cfg = await window.api.company.getConformityConfig();
  }

  if (cfg && typeof cfg === "object") {
    state.conformity = {
      ...state.conformity,
      ...cfg,
      kpis: { ...(state.conformity?.kpis || {}), ...(cfg.kpis || {}) },
    };
  }

  const s = state.conformity || {};

  // 2) Hint éligibilité
  const hintEl = document.getElementById("cf-eligibility-hint");
if (hintEl) {
  const emitsB2C = Number(s.emits_b2c || 0) === 1;
  const hasIntl = Number(s.has_international || 0) === 1;

  if (!emitsB2C && !hasIntl) {
    hintEl.textContent = t(
      "conformity.eligibility.none",
      "E-reporting not required: no B2C and no international. (France B2B = e-invoicing, not e-reporting)"
    );
    hintEl.style.opacity = "0.85";
  } else if (emitsB2C && !hasIntl) {
    hintEl.textContent = t(
      "conformity.eligibility.b2c_only",
      "E-reporting required for B2C (Flows 9/10)."
    );
    hintEl.style.opacity = "0.95";
  } else if (!emitsB2C && hasIntl) {
    hintEl.textContent = t(
      "conformity.eligibility.intl_only",
      "E-reporting required for international (Flow 8 + payments)."
    );
    hintEl.style.opacity = "0.95";
  } else {
    hintEl.textContent = t(
      "conformity.eligibility.b2c_and_intl",
      "E-reporting required: B2C + international."
    );
    hintEl.style.opacity = "0.95";
  }
}

  // 3) Appliquer vers UI
  const elScope = document.getElementById("cf-scope");
  const elPer = document.getElementById("cf-periodicity");
  const elArch = document.getElementById("cf-archiving");
  const elPlat = document.getElementById("cf-platform");
  const elDue = document.getElementById("cf-next-due");
  const elB2C = document.getElementById("cf-emits-b2c");
  const elIntl = document.getElementById("cf-has-international");

  if (elScope) elScope.value = s.scope || "FR";
  if (elPer) elPer.value = s.periodicity || "M";
  if (elArch) elArch.value = s.archiving || "ON";
  if (elPlat) elPlat.value = s.platform || "";
  if (elDue) elDue.value = s.next_due || "";

  if (elB2C) elB2C.value = String(s.emits_b2c ?? 0);
  if (elIntl) elIntl.value = String(s.has_international ?? 0);

  // 4) KPIs
  const kpis = s.kpis || {};
  const k8 = document.getElementById("cf-kpi-flux8");
  const k9 = document.getElementById("cf-kpi-flux9");
  const k10 = document.getElementById("cf-kpi-flux10");
  if (k8) k8.textContent = String(kpis.flux8 ?? 0);
  if (k9) k9.textContent = String(kpis.flux9 ?? 0);
  if (k10) k10.textContent = String(kpis.flux10 ?? 0);

  return;
}

  if (moduleKey === "clients") {
    const q = $("clientsSearch")?.value || "";
    state.clients = (await window.api.clients.list({ q })).map(normalizeClient);

    renderList(
      $("clientsList"),
      state.clients,
      state.selectedClientId,
      (c) => `${c.name} ${c.customer_type ? `(${c.customer_type})` : ""}`,
      (c) => c.email || ""
    );

    if (!state.selectedClientId && state.clients[0]) state.selectedClientId = state.clients[0].id;

    let selected = null;
    if (state.selectedClientId) {
    selected = normalizeClient(await window.api.clients.get(state.selectedClientId));
  }

fillClientForm(selected);
return;
  }

  if (moduleKey === "items") {
    const q = $("itemsSearch")?.value || "";
    state.items = (await window.api.items.list({ q })).map(normalizeItem);

    renderList(
      $("itemsList"),
      state.items,
      state.selectedItemId,
      (a) => a.ref || "—",
      (a) => `${a.label || a.name || ""} • ${a.item_type || "SERVICE"}`
    );

    if (!state.selectedItemId && state.items[0]) state.selectedItemId = state.items[0].id;
    const selected = state.items.find((x) => x.id === state.selectedItemId) || null;
    fillItemForm(selected);
    return;
  }

  if (moduleKey === "quotes") {
    const q = $("quotesSearch")?.value || "";
    state.quotes = (await window.api.quotes.list({ q })).map(normalizeQuote);

    renderList(
      $("quotesList"),
      state.quotes,
      state.selectedQuoteId,
      (qq) => qq.number || "—",
      (qq) => `${qq.client_name || "—"} • ${money(qq.total_ttc)} €`
    );

    await refreshClientAndArticlePickers();

    if (!state.selectedQuoteId) {
      if (!state.quoteDraft.date) state.quoteDraft.date = new Date().toISOString().slice(0, 10);
      renderQuoteDraft();
      await applyVatForQuote({ silent: true }).catch(() => {});
      return;
    }

    const full = await window.api.quotes.getFull(state.selectedQuoteId);
    if (!full?.quote) {
      state.selectedQuoteId = null;
      renderQuoteDraft();
      await applyVatForQuote({ silent: true }).catch(() => {});
      return;
    }

    state.quoteDraft = {
      id: full.quote.id,
      number: full.quote.number || "",
      status: full.quote.status || "draft",
      client_id: full.quote.client_id || "",
      date: full.quote.date,
      vat_mode: full.quote.vat_mode || "AUTO",
      vat_effective: "AUTO",
      validity_days: full.quote.validity_days ?? null,
      valid_until: full.quote.valid_until || "",
      payment_text: full.quote.payment_text || "",
      lines: (full.lines || []).map((l) => ({
        article_id: l.article_id,
        article_ref: l.article_ref,
        description: l.description,
        quantity: l.quantity,
        unit_price_ht: l.unit_price_ht,
        tva_percent: l.tva_percent,
        unit_code: l.unit_code || "C62",
        remise_percent: l.remise_percent || 0,
        line_type: l.line_type || "standard",
        item_type: (l.item_type || "SERVICE").toString().toUpperCase(),
      })),    
    };

    state.quoteDraft.deposits = await loadDepositsForQuote(state.selectedQuoteId);

    state.quoteDraft.deposits_total_ttc = round2(
      (state.quoteDraft.deposits || []).reduce(
        (sum, inv) => sum + Number(inv.total_ttc || 0),
        0
      )
    );

renderQuoteDraft();

    await applyVatForQuote({ silent: true });
    if (state.currentModule === "exports") fillExportsPickers();
    return;
  }

  if (moduleKey === "invoices") {
    const q = $("invoicesSearch")?.value || "";
    state.invoices = (await window.api.invoices.list({ q })).map(normalizeInvoice);

    renderList(
      $("invoicesList"),
      state.invoices,
      state.selectedInvoiceId,
      (ii) => ii.invoice_number || "—",
      (ii) => `${ii.client_name || "—"} • ${money(ii.total_ttc)} €`
    );

    await refreshClientAndArticlePickers();

    if (!state.selectedInvoiceId) {
      if (!state.invoiceDraft.date) state.invoiceDraft.date = new Date().toISOString().slice(0, 10);
      renderInvoiceDraft();
      await applyVatForInvoice({ silent: true }).catch(() => {});
      return;
    }

    const full = await window.api.invoices.getFull(state.selectedInvoiceId);
    if (!full?.invoice) {
      state.selectedInvoiceId = null;
      renderInvoiceDraft();
      await applyVatForInvoice({ silent: true }).catch(() => {});
      return;
    }

    state.invoiceDraft = {
      id: full.invoice.id,
      client_id: full.invoice.client_id || "",
      date: full.invoice.date,
      due_date: full.invoice.due_date || full.invoice.dueDate || "",
      payment_term: full.invoice.payment_term || full.invoice.paymentTerm || "",
      payment_text: full.invoice.payment_text || full.invoice.paymentText || "",
      status: full.invoice.status || "draft",
      type_code: full.invoice.type_code || full.invoice.invoice_type_code || "380",
      prepaid_amount: Number(full.invoice.prepaid_amount || 0) || 0,
      source_quote_id: full.invoice.source_quote_id || null,
      vat_mode: full.invoice.vat_mode || "AUTO",
      vat_effective: "AUTO",
      lines: (full.lines || []).map((l) => ({
        article_id: l.article_id,
        article_ref: l.article_ref,
        description: l.description,
        quantity: l.quantity,
        unit_price_ht: l.unit_price_ht,
        tva_percent: l.tva_percent,
        unit_code: l.unit_code || "C62",
        remise_percent: l.remise_percent || 0,
        line_type: l.line_type || "standard",
        item_type: (l.item_type || "SERVICE").toString().toUpperCase(),
      })),
    };

    renderInvoiceDraft();
    await applyVatForInvoice({ silent: true });
    if (state.currentModule === "exports") fillExportsPickers();
    return;
  }

  if (moduleKey === "inbound") {
    const q = $("inboundSearch")?.value || "";
    if (!window.api?.inbound?.list) {
      state.inbound = [];
      renderList($("inboundList"), [], null, () => "Inbound non disponible", () => "IPC inbound:list non branché");
      renderInboundDetail(null);
      renderToolbar("inbound");
      return;
    }

    state.inbound = (await window.api.inbound.list({ q })).map(normalizeInbound);

    renderList(
      $("inboundList"),
      state.inbound,
      state.selectedInboundId,
      (d) => `${d.doc_number || "—"} • ${d.supplier_name || "—"}`,
      (d) => `${d.doc_date || "—"} • ${money(d.total_ttc)} ${d.currency || "EUR"} • ${inboundStatusLabel(d.status)}`
    );

    if (!state.selectedInboundId && state.inbound[0]) state.selectedInboundId = state.inbound[0].id;

    if (state.selectedInboundId) {
      if (window.api?.inbound?.get) state.inboundDoc = await window.api.inbound.get(state.selectedInboundId);
      else state.inboundDoc = state.inbound.find((x) => x.id === state.selectedInboundId) || null;
    } else {
      state.inboundDoc = null;
    }

    renderInboundDetail(state.inboundDoc);
    return;
  }

  if (moduleKey === "payments") {
  state.invoices = (await window.api.invoices.list({})).map(normalizeInvoice);
  const invoiceStatusLabels = {
    draft: t("payments.invoice_status.draft", "Brouillon"),
    issued: t("payments.invoice_status.issued", "Émise"),
  };

  const sel = $("p-invoice");
  const cur = String(sel?.value || state.payments.selectedInvoiceId || "").trim();

  setSelectOptions(
    $("p-invoice"),
    (state.invoices || []).map((i) => ({
      id: i.id,
      label: `${i.invoice_number || i.id} — ${i.client_name || "—"} • ${money(i.total_ttc)} € • ${invoiceStatusLabels[String(i.status || "draft")] || String(i.status || "draft")}`,
    })),
    cur || null
  );

  if ($("p-date")) $("p-date").value = $("p-date").value || new Date().toISOString().slice(0, 10);

  state.payments.selectedInvoiceId = String($("p-invoice")?.value || cur || "").trim() || null;

  // ✅ Le rendu fait le chargement (1 seule source de vérité)
  await renderPaymentsPage();

  // ✅ re-render au changement de facture
  const pSel = $("p-invoice");
  if (pSel && !pSel._boundPaymentsChange) {
    pSel.addEventListener("change", async () => {
      state.payments.selectedInvoiceId = String(pSel.value || "").trim() || null;
      await renderPaymentsPage();
    });
    pSel._boundPaymentsChange = true;
  }

  const statusSel = $("p-payment-status");
  if (statusSel && !statusSel._boundPaymentsStatusChange) {
    statusSel.addEventListener("change", () => renderPaymentOverview(state.invoices || [], state.payments.all || []));
    statusSel._boundPaymentsStatusChange = true;
  }

  return;
}

  if (moduleKey === "exports") {
    const qQ = $("quotesSearch")?.value || "";
    const qI = $("invoicesSearch")?.value || "";

    state.quotes = (await window.api.quotes.list({ q: qQ })).map(normalizeQuote);
    state.invoices = (await window.api.invoices.list({ q: qI })).map(normalizeInvoice);

    fillExportsPickers();
    return;
  }
}

async function refreshClientAndArticlePickers() {
  state.clients = (await window.api.clients.list({})).map(normalizeClient);
  state.items = (await window.api.items.list({})).map(normalizeItem);

  setSelectOptions(
    $("q-client"),
    state.clients.map((c) => ({ id: c.id, label: `${c.name} ${c.customer_type ? `(${c.customer_type})` : ""}` })),
    $("q-client")?.value || state.quoteDraft.client_id
  );
  setSelectOptions(
    $("i-client"),
    state.clients.map((c) => ({ id: c.id, label: `${c.name} ${c.customer_type ? `(${c.customer_type})` : ""}` })),
    $("i-client")?.value || state.invoiceDraft.client_id
  );

  setSelectOptions(
    $("q-add-article"),
    state.items.map((a) => ({ id: a.id, label: `${a.ref || "—"} — ${a.label || a.name || ""} (${a.item_type || "SERVICE"})` })),
    $("q-add-article")?.value
  );
  setSelectOptions(
    $("i-add-article"),
    state.items.map((a) => ({ id: a.id, label: `${a.ref || "—"} — ${a.label || a.name || ""} (${a.item_type || "SERVICE"})` })),
    $("i-add-article")?.value
  );
}

async function tryCopyToClipboard(text) {
  try {
    if (!text) return false;
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  return false;
}

function getPeppolProfile() {
  return "peppol-bis3";
}

/* ----------------- Global shortcuts ----------------- */
function focusSearchForCurrentModule() {
  const m = state.currentModule;
  const map = { clients: "clientsSearch", items: "itemsSearch", quotes: "quotesSearch", invoices: "invoicesSearch", inbound: "inboundSearch" };
  const id = map[m];
  const el = id ? $(id) : null;
  if (el) {
    el.focus();
    el.select?.();
    setStatusKey("status.search", "Search");
  } else {
    setStatusKey("status.search_unavailable", t("status.search_unavailable", "Search unavailable on this page."));
  }
}

async function createNewForCurrentModule() {
  const m = state.currentModule;
  const map = { clients: "clients:new", items: "items:new", quotes: "quotes:new", invoices: "invoices:new" };
  const action = map[m];
  if (action) return handleAction(action);
  setStatusKey("status.create_unavailable", "Creation unavailable on this page.");
}

async function recordPaymentAutoIssue(paymentPayload) {
  const invoiceId = paymentPayload.invoice_id || paymentPayload.invoiceId;
  if (!invoiceId) throw new Error("Paiement: invoice_id manquant.");

  const full = await window.api.invoices.getFull(invoiceId);
  const st = String(full?.invoice?.status || "draft").toLowerCase();

  if (st === "draft") {
    await window.api.invoices.issue(invoiceId);
  }

  return await window.api.payments.record(paymentPayload);
}

/* ----------------- Actions ----------------- */
async function handleAction(actionId, payload) {
  try {
    switch (actionId) {
      case "global:search":
        focusSearchForCurrentModule();
        break;

      case "global:new":
        await createNewForCurrentModule();
        break;

      case "dashboard:refresh":
        await refreshModule("dashboard");
        setStatus(t("status.dashboard_refreshed", "Dashboard refreshed"));
        break;

      case "quotes:accept": {
        const id = state.quoteDraft?.id;
        if (!id) { setStatus("Devis: id manquant"); break; }

        await window.api.quotes.setStatus(id, "accepted");

        await refreshModule("quotes").catch(() => {});

        const fresh = await window.api.quotes.get(id);
        if (fresh) state.quoteDraft = fresh;

        renderQuoteDraft();
        setStatus(t("status.quote_accepted", "Devis accepté"));
        break;
      }
      
      case "clients:importCsv": {
        const id = "clientsImportModal";
        bindModalClose(id); // safe
        openModal(id);

  const fileEl = document.getElementById("clImportFile");
  const delimEl = document.getElementById("clImportDelimiter");
  const headEl = document.getElementById("clImportHasHeader");
  const updEl = document.getElementById("clImportUpdateExisting");

  const mapBox = document.getElementById("clImportMapping");
  const prevBox = document.getElementById("clImportPreview");
  const repBox = document.getElementById("clImportReport");
  const analyzeBtn = document.getElementById("clImportAnalyzeBtn");
  const runBtn = document.getElementById("clImportRunBtn");

  // sécurité
  if (!fileEl || !delimEl || !headEl || !updEl || !mapBox || !prevBox || !repBox || !analyzeBtn || !runBtn) {
    setStatus("UI import CSV manquante (clientsImportModal). Vérifie index.html.");
    break;
  }

  // évite cumul handlers si on ré-ouvre le modal
  analyzeBtn.onclick = null;
  runBtn.onclick = null;

  let parsed = null;      // { headers, data, delimiter }
  let mapping = {};       // { fieldKey: headerName }

  const setReport = (msg, isErr = false) => {
    repBox.textContent = (isErr ? "❌ " : "✅ ") + String(msg || "");
  };

  const setPreviewText = (text) => {
    prevBox.textContent = String(text || "");
  };

  const setPreviewJson = (obj) => {
    try {
      prevBox.textContent = JSON.stringify(obj, null, 2);
    } catch {
      prevBox.textContent = String(obj || "");
    }
  };

  const renderMappingUi = (headers) => {
    const guessed = guessMapping(headers);
    // conserve les choix manuels si déjà fait, sinon prend guess
    mapping = { ...guessed, ...(mapping || {}) };

    const rows = CLIENT_FIELDS.map((f) => {
      const label = t(f.labelKey, f.fallback);
      const current = mapping[f.key] || "";

      const opts = [`<option value="">${t("ui.choose", "— choisir —")}</option>`]
        .concat(
          headers.map(
            (h) => `<option value="${esc(h)}" ${h === current ? "selected" : ""}>${esc(h)}</option>`
          )
        )
        .join("");

      return `
        <div style="display:grid;grid-template-columns: 220px 1fr;gap:10px;align-items:center;margin-bottom:10px;">
          <div style="font-weight:800;">${esc(label)}</div>
          <select data-map-field="${esc(f.key)}">${opts}</select>
        </div>
      `;
    }).join("");

    mapBox.innerHTML = rows || "";

    mapBox.querySelectorAll("select[data-map-field]").forEach((sel) => {
      sel.addEventListener("change", () => {
        const field = sel.getAttribute("data-map-field");
        mapping[field] = sel.value || "";
      });
    });
  };

  const buildPayloadFromParsed = () => {
    // parsed.data = array de rows (array de cellules)
    const idxByHeader = new Map(parsed.headers.map((h, i) => [h, i]));

    const take = (row, fieldKey) => {
      const header = mapping[fieldKey];
      if (!header) return "";
      const idx = idxByHeader.get(header);
      return idx == null ? "" : String(row[idx] ?? "").trim();
    };

    return parsed.data.map((row) => ({
      customer_type: (take(row, "customer_type") || "B2C").toUpperCase(),
      name: take(row, "name"),
      email: take(row, "email"),
      phone: take(row, "phone"),
      country: (take(row, "country") || "FR").toUpperCase(),

      vat_subject: (() => {
        const v = take(row, "vat_subject");
        if (v === "") return 1;
        const n = Number(String(v).replace(",", "."));
        return n === 0 ? 0 : 1;
      })(),

      vat_id: take(row, "vat_id"),
      legal_id: take(row, "legal_id"),
      street: take(row, "street"),
      street2: take(row, "street2"),
      postal_code: take(row, "postal_code"),
      city: take(row, "city"),

      payment_term: normalizePaymentTermCode(take(row, "payment_term")),
      payment_days: (() => {
        const v = take(row, "payment_days");
        if (v === "") return null;
        const n = Number(String(v).replace(",", "."));
        return Number.isFinite(n) ? n : null;
      })(),
      payment_text: take(row, "payment_text"),
      quote_validity_days: (() => {
        const v = take(row, "quote_validity_days");
        if (v === "") return null;
        const n = Number(String(v).replace(",", "."));
        return Number.isFinite(n) ? n : null;
      })(),

      notes: take(row, "notes"),
    }));
  };

  // état boutons
  runBtn.disabled = true;

  const analyze = async () => {
    try {
      repBox.textContent = "";
      setPreviewText("");

      const f = fileEl.files?.[0];
      if (!f) {
        setReport(t("clients.import.err_no_file", "Choisis un fichier CSV."), true);
        runBtn.disabled = true;
        return;
      }

      const text = await f.text();
      const delimiter = delimEl.value || "auto";
      const hasHeader = !!headEl.checked;

      // ✅ on utilise TON parseCsv (déjà défini plus haut)
      parsed = parseCsv(text, delimiter, hasHeader);

      if (!parsed.headers.length || !parsed.data.length) {
        setReport(t("clients.import.err_empty", "CSV vide ou illisible."), true);
        runBtn.disabled = true;
        return;
      }

      renderMappingUi(parsed.headers);

      // preview RAW (10 premières lignes)
      const sample = parsed.data.slice(0, 10).map((r) => r.map((c) => String(c ?? "").replace(/\s+/g, " ").trim()));
      setPreviewText(
        [
          `delimiter: ${parsed.delimiter || "?"}`,
          `rows: ${parsed.data.length}`,
          "",
          parsed.headers.join(" | "),
          ...sample.map((r) => r.join(" | ")),
        ].join("\n")
      );

      setReport(t("clients.import.ok_analyzed", "Analyse OK. Vérifie le mapping puis clique Importer."));
      runBtn.disabled = false;
    } catch (e) {
      setReport(e?.message || String(e), true);
      runBtn.disabled = true;
    }
  };

  const runImport = async () => {
    try {
      repBox.textContent = "";

      if (!parsed) {
        setReport(t("clients.import.err_analyze_first", "Clique d’abord sur Analyser."), true);
        return;
      }

      const payload = buildPayloadFromParsed();

      // validation minimale : au moins name OU email
      const valid = payload.filter(
        (c) => String(c.name || "").trim() !== "" || String(c.email || "").trim() !== ""
      );

      if (!valid.length) {
        setReport(t("clients.import.err_no_valid_rows", "Aucune ligne importable (nom/email vides)."), true);
        return;
      }

      setReport(t("clients.import.running", "Import en cours…"));

      const updateExisting = !!updEl.checked;

      if (!window.api?.clients?.importCsv) {
        // fallback batch save
        if (!window.api?.clients?.save) throw new Error("API clients.importCsv / clients.save manquante.");
        let ok = 0, fail = 0;
        for (const c of valid) {
          try {
            await window.api.clients.save(c);
            ok++;
          } catch {
            fail++;
          }
        }
        setReport(`Imported: ${ok} | Failed: ${fail}`);
      } else {
        const res = await window.api.clients.importCsv({ rows: valid, updateExisting });
        repBox.textContent = JSON.stringify(res, null, 2);
      }

      await refreshModule("clients");
    } catch (e) {
      setReport(e?.message || String(e), true);
    }
  };

  // wire buttons (1 seule fois)
  analyzeBtn.onclick = analyze;
  runBtn.onclick = runImport;

  // reset UI on option changes
  fileEl.onchange = () => {
    parsed = null;
    mapping = {};
    mapBox.innerHTML = "";
    setPreviewText("");
    repBox.textContent = "";
    runBtn.disabled = true;
  };
  delimEl.onchange = () => {
    parsed = null;
    setPreviewText("");
    repBox.textContent = "";
    runBtn.disabled = true;
  };
  headEl.onchange = () => {
    parsed = null;
    setPreviewText("");
    repBox.textContent = "";
    runBtn.disabled = true;
  };

  // i18n modal (labels / placeholders)
  applyStaticI18n(document);

  break;
}

// ===================== BEGIN PATCH E-INVOICING / E-REPORTING (ACTIONS) =====================

case "conformity:refresh":
  await refreshModule("conformity");
  setStatus(t("status.conformity_refreshed", "Conformité rafraîchie"));
  break;

case "conformity:sendNow": {
  if (!window.api?.conformity?.sendNow) {
    setStatus("Envoi non branché (IPC conformity:sendNow manquant).");
    break;
  }

  // le backend peut calculer quoi envoyer maintenant (Flux 8/9/10)
  // selon scope/périodicité + données en DB.
  const res = await window.api.conformity.sendNow({
    scope: state.conformity?.scope || "FR",
    periodicity: state.conformity?.periodicity || "M",
  });

  if (res?.queued) {
    // version "merge" (tu l'avais)
    state.conformity.kpis = { ...state.conformity.kpis, ...res.queued };

    // version "numérique / robuste" (tu l'avais aussi)
    state.conformity.kpis = {
      flux8: Number(res.queued.flux8 ?? state.conformity.kpis.flux8 ?? 0),
      flux9: Number(res.queued.flux9 ?? state.conformity.kpis.flux9 ?? 0),
      flux10: Number(res.queued.flux10 ?? state.conformity.kpis.flux10 ?? 0),
    };
  }

  if (res?.next_due) state.conformity.next_due = String(res.next_due || "");

  await refreshModule("conformity");
  setStatus(res?.message || "Envoi déclenché (file d’envoi).");
  break;
}

case "conformity:rebuildPeriod": {
  if (!window.api?.conformity?.rebuildPeriod) {
    setStatus("Recalcul non branché (IPC conformity:rebuildPeriod manquant).");
    break;
  }

  const res = await window.api.conformity.rebuildPeriod({
    scope: state.conformity?.scope || "FR",
    periodicity: state.conformity?.periodicity || "M",
  });

  if (res?.next_due) state.conformity.next_due = String(res.next_due || "");
  if (res?.kpis) state.conformity.kpis = { ...state.conformity.kpis, ...res.kpis };

  await refreshModule("conformity");
  setStatus(res?.message || "Période recalculée");
  break;
}

case "conformity:settings": {
  showPage("conformity"); 
  setStatus(t("conformity.settings.opened", "Paramètres conformité"));
  setTimeout(() => document.getElementById("cf-scope")?.focus(), 0);
  break;
}

case "conformity:openQueue": {
  if (!window.api?.conformity?.openQueue) {
    setStatus("File d’envoi non branchée (IPC conformity:openQueue manquant).");
    break;
  }
  await window.api.conformity.openQueue();
  setStatus("File d’envoi ouverte.");
  break;
}

// ===================== E-INVOICING / E-REPORTING (ACTIONS) =====================

case "payments:refresh":
  await refreshModule("payments");
  setStatus(t("status.payments_refreshed", "Payments refreshed"));
  break;

case "payments:record": {
  const invoiceId = $("p-invoice")?.value || state.selectedInvoiceId;
  if (!invoiceId) throw new Error("Sélectionner une facture.");

  const full = await window.api.invoices.getFull(invoiceId);
  const st = String(full?.invoice?.status || "draft").toLowerCase();
  if (st === "draft") {
    await window.api.invoices.issue(invoiceId);
  }

  const amount = Number($("p-amount")?.value || 0);
  if (!(amount > 0)) throw new Error("Montant > 0 requis.");

  const payload = {
    invoice_id: invoiceId,
    date: $("p-date")?.value || new Date().toISOString().slice(0, 10),
    amount,
    method: $("p-method")?.value || "other",
    reference: $("p-reference")?.value || "",
    notes: $("p-notes")?.value || "",
    currency: "EUR",
  };

  await recordPaymentAutoIssue(payload);

  await refreshModule("payments");
  if (state.currentModule === "dashboard") await refreshModule("dashboard");
  setStatusKey("status.payment_recorded", "Payment recorded");
  break;
}

case "company:save": {
  const keepModule = state.currentModuleKey;
  const payload = companyPayloadFromForm();
  const saved = await window.api.company.save(payload);
  validateCompanyEN16931(saved);
  state.company = saved;
  fillCompanyForm(saved);
  await applyVatForQuote({ silent: true }).catch(() => {});
  await applyVatForInvoice({ silent: true }).catch(() => {});
  if (typeof renderToolbar === "function") renderToolbar(keepModule);
  setStatus(t("status.company_saved", "Company saved"));
  break;
}

case "company:chooseLogo": {
  if (!window.api?.files?.pickImage)
    throw new Error("Fonction fichiers non disponible (files:pickImage).");
  const res = await window.api.files.pickImage();
  if (!res || res.ok === false) return setStatus("Choix logo annulé");
  if (!res.path) throw new Error("Fichier logo invalide (path manquant).");
  await window.api.company.setLogo(res.path);
  state.company = await window.api.company.get();
  fillCompanyForm(state.company);
  setStatus(t("status.logo_saved", "Logo saved"));
  break;
}

case "company:clearLogo":
  await window.api.company.clearLogo();
  state.company = await window.api.company.get();
  fillCompanyForm(state.company);
  setStatus(t("status.logo_cleared", "Logo removed"));
  break;

case "clients:new":
  state.selectedClientId = null;
  fillClientForm(null);
  setStatus(t("status.client_new", "New client"));
  break;

case "clients:save": {
  const payload = clientPayloadFromForm();
  const saved = normalizeClient(await window.api.clients.save(payload));
  validateBuyerEN16931(saved);
  state.selectedClientId = saved.id; 
  await refreshModule("clients");
  setStatus(t("status.client_saved", "Client saved"));
  break;
}

case "clients:delete": {
  const id = $("cl-id")?.value;
  if (!id) return setStatus(t("status.none_client_selected", "No client selected"));
  await window.api.clients.remove(id);
  state.selectedClientId = null;
  await refreshModule("clients");
  setStatus(t("status.client_deleted", "Client deleted"));
  break;
}

case "items:new":
  state.selectedItemId = null;
  fillItemForm(null);
  setStatus(t("status.item_new", "New item"));
  break;

case "items:save": {
  const saved = normalizeItem(await window.api.items.save(itemPayloadFromForm()));
  state.selectedItemId = saved?.id || state.selectedItemId;
  await refreshModule("items");
  setStatus(t("status.item_saved", "Item saved"));
  break;
}

case "items:delete": {
  const id = $("it-id")?.value;
  if (!id) throw new Error("No item selected");
  await window.api.items.remove(id);
  state.selectedItemId = null;
  await refreshModule("items");
  setStatus(t("status.item_deleted", "Item deleted"));
  break;
}

case "quotes:new":
  state.selectedQuoteId = null;
  state.quoteDraft = {
    id: null,
    client_id: "",
    date: new Date().toISOString().slice(0, 10),
    lines: [],
    vat_mode: "AUTO",
    vat_effective: "AUTO",
    validity_days: null,
    valid_until: "",
    payment_text: "",
  };

  if ($("q-lines")) $("q-lines").innerHTML = "";
  renderQuoteDraft();
  setStatus(t("status.quote_new", "New quote"));
  break;

case "quotes:addLine": {
  const aid = $("q-add-article")?.value;
  if (!aid) throw new Error("Choisir un article.");
  const art = normalizeItem(state.items.find((a) => String(a.id) === String(aid)));
  if (!art) throw new Error("Article introuvable.");
  const qty = Number($("q-add-qty")?.value) || 1;

  state.quoteDraft.lines.push({
    article_id: art.id,
    article_ref: art.ref,
    description: art.label || art.name,
    details: art.description || art.details || "",
    quantity: qty,
    unit_price_ht: Number(art.unit_price_ht) || 0,
    tva_percent: Number(art.tva_percent) || 0,
    unit_code: art.unit_code || "C62",
    remise_percent: 0,
    line_type: "standard",
    item_type: art.item_type || "SERVICE",
  });

  await applyVatForQuote({ silent: true }).catch(() => {});
  renderQuoteDraft();
  setStatus(t("status.quote_line_added", "Line added"));
  break;
}

case "quotes:save": {
  const clientId = $("q-client")?.value || null;
  const date = $("q-date")?.value || new Date().toISOString().slice(0, 10);
  if (!clientId) throw new Error("Devis: client obligatoire.");

  state.company = await window.api.company.get();
  validateCompanyEN16931(state.company);

  const buyer = normalizeClient(await window.api.clients.get(clientId));
  validateBuyerEN16931(buyer);

  await applyVatForQuote({ silent: true }).catch(() => {});
  validateLinesEN16931(state.quoteDraft.lines);
  
  refreshQuoteTotals();

  const payload = {
  id: state.quoteDraft.id || undefined,
  client_id: clientId,
  date,
  currency: "EUR",
  vat_mode: state.quoteDraft.vat_mode || "AUTO",

  total_ht: Number(state.quoteDraft.total_ht || 0),
  total_tva: Number(state.quoteDraft.total_tva || 0),
  total_ttc: Number(state.quoteDraft.total_ttc || 0),

  lines: state.quoteDraft.lines,
  validity_days: (() => {
    const v = $("q-validity-days")?.value;
    return v === "" || v == null ? null : Number(v);
  })(),
  valid_until: $("q-valid-until")?.value || "",
  payment_text: $("q-payment-text")?.value || "",
};

  if (!state.quoteDraft.id) {
    const created = await window.api.quotes.create(payload);
    state.selectedQuoteId = created?.id || null;
  } else {
    await window.api.quotes.update({ ...payload, id: state.quoteDraft.id });
    state.selectedQuoteId = state.quoteDraft.id;
  }

  await refreshModule("quotes");
  setStatus(t("status.quote_saved", "Quote saved"));
  break;
}

case "quotes:issue": {
  const qid = state.selectedQuoteId || state.quoteDraft?.id;
  if (!qid) throw new Error("Sélectionner un devis.");
  if (!state.quoteDraft?.id) await handleAction("quotes:save");
  await window.api.quotes.setStatus({ id: qid, status: "sent" });
  await refreshModule("quotes");
  setStatus(t("status.quote_sent", "Quote marked as sent"));
  break;
}

case "quotes:toDepositInvoice": {
  if (!state.quoteDraft?.id) {
    await handleAction("quotes:save");
  }

  const quote = state.quoteDraft && typeof state.quoteDraft === "object"
    ? state.quoteDraft
    : null;

  const qid = String(
    state.selectedQuoteId ||
    quote?.id ||
    quote?.number ||
    ""
  ).trim();

  if (!qid) {
    throw new Error("Sélectionner un devis.");
  }

  if (!window.api?.invoices?.createDeposit) {
    throw new Error("API manquante: invoices.createDeposit");
  }
  if (!window.api?.invoices?.getFull) {
    throw new Error("API manquante: invoices.getFull");
  }

  const mode = $("q-deposit-mode-amount")?.checked ? "amount" : "percent";
  const raw = ($("q-deposit-value")?.value ?? "").toString().trim();
  const value = Number(raw.replace(",", "."));

  if (!(value > 0)) {
    throw new Error(
      mode === "percent"
        ? "Saisir un % > 0."
        : "Saisir un montant TTC > 0."
    );
  }

  if (mode === "percent" && value > 100) {
    throw new Error("Le % doit être <= 100.");
  }

  console.log("[UI] quotes:toDepositInvoice quote =", quote);
  console.log("[UI] quotes:toDepositInvoice qid =", qid);
  console.log("[UI] quotes:toDepositInvoice mode =", mode);
  console.log("[UI] quotes:toDepositInvoice value =", value);

  const res = await window.api.invoices.createDeposit({
    quoteId: qid,
    mode,
    value,
  });

  const id = res?.id || null;
  state.selectedInvoiceId = id;

  if (id) {
    const full = await window.api.invoices.getFull(id);
    state.invoiceDraft = invoiceFullToDraft(full);
  }

  showPage("invoices");
  setStatus("Facture d’acompte créée");
  break;
}

case "quotes:toFinalInvoice":
case "quotes:toInvoice": {
  const qid = state.selectedQuoteId;
  if (!qid) throw new Error("Sélectionner un devis.");
  if (!window.api?.invoices?.createFromQuote) throw new Error("API manquante: invoices.createFromQuote");
  if (!window.api?.invoices?.getFull) throw new Error("API manquante: invoices.getFull");

  const res = await window.api.invoices.createFromQuote(qid);

  const id = res?.id || null;
  state.selectedInvoiceId = id;
  if (id) {
    const full = await window.api.invoices.getFull(id);
    state.invoiceDraft = invoiceFullToDraft(full);
  }

  showPage("invoices");
  setStatus("Facture créée depuis devis");
  break;
}

case "quotes:delete": {
  const id = state.selectedQuoteId || state.quoteDraft?.id;
  if (!id) throw new Error("Sélectionner un devis.");
  await window.api.quotes.remove(id);
  state.selectedQuoteId = null;
  state.quoteDraft = {
    id: null,
    client_id: "",
    date: new Date().toISOString().slice(0, 10),
    lines: [],
    vat_mode: "AUTO",
    vat_effective: "AUTO",
  };
  await refreshModule("quotes");
  setStatus(t("status.quote_deleted", "Quote deleted"));
  break;
}

case "invoices:new":
  state.selectedInvoiceId = null;
  state.invoiceDraft = {
    id: null,
    client_id: "",
    date: new Date().toISOString().slice(0, 10),
    lines: [],
    status: "draft",
    type_code: "380",
    prepaid_amount: 0,
    source_quote_id: null,
    vat_mode: "AUTO",
    vat_effective: "AUTO",
  };
  if ($("i-lines")) $("i-lines").innerHTML = "";
  renderInvoiceDraft();
  setStatus(t("status.invoice_new", "New invoice"));
  break;

case "invoices:addLine": {
  if (state.invoiceDraft?.id && !isDraftInvoice())
    throw new Error("Facture non modifiable : uniquement en brouillon.");
  const aid = $("i-add-article")?.value;
  if (!aid) throw new Error("Choisir un article.");
  const art = normalizeItem(state.items.find((a) => String(a.id) === String(aid)));
  if (!art) throw new Error("Article introuvable.");
  const qty = Number($("i-add-qty")?.value) || 1;

  state.invoiceDraft.lines.push({
    article_id: art.id,
    article_ref: art.ref,
    description: art.label || art.name,
    quantity: qty,
    unit_price_ht: Number(art.unit_price_ht) || 0,
    tva_percent: Number(art.tva_percent) || 0,
    unit_code: art.unit_code || "C62",
    remise_percent: 0,
    line_type: "standard",
    item_type: art.item_type || "SERVICE",
  });

  await applyVatForInvoice({ silent: true }).catch(() => {});
  renderInvoiceDraft();
  setStatus(t("status.invoice_line_added", "Line added"));
  break;
}

case "invoices:save": {
  if (state.invoiceDraft?.id && !isDraftInvoice())
    throw new Error("Enregistrement interdit : facture non brouillon.");

  state.company = await window.api.company.get();
  validateCompanyEN16931(state.company);

  const clientId = $("i-client")?.value || null;
  if (!clientId) throw new Error("Facture: client obligatoire.");

  const buyer = normalizeClient(await window.api.clients.get(clientId));
  validateBuyerEN16931(buyer);

  await applyVatForInvoice({ silent: true }).catch(() => {});
  validateLinesEN16931(state.invoiceDraft.lines);

  const date = $("i-date")?.value || new Date().toISOString().slice(0, 10);
  const totals = computeTotals(state.invoiceDraft.lines);

  const payload = {
    id: state.invoiceDraft.id || undefined,
    client_id: clientId,
    date,
    currency: "EUR",
    type: "final",
    status: "draft",
    prepaid_amount: Number(state.invoiceDraft.prepaid_amount || 0) || 0,
    lines: state.invoiceDraft.lines,
    meta_json: { kind: "final", totals_snapshot: totals },
  };

  if (!state.invoiceDraft.id) {
    const created = await window.api.invoices.create(payload);
    state.selectedInvoiceId = created?.id || null;
  } else {
    await window.api.invoices.update({ ...payload, id: state.invoiceDraft.id });
    state.selectedInvoiceId = state.invoiceDraft.id;
  }

  await refreshModule("invoices");
  setStatus(t("status.invoice_saved", "Invoice saved"));
  break;
}

case "invoices:delete": {
  const id = state.invoiceDraft?.id;
  if (!id) throw new Error("Aucune facture sélectionnée.");
  if (!isDraftInvoice())
    throw new Error("Suppression interdite : seule une facture brouillon peut être supprimée.");
  await window.api.invoices.remove(id);
  state.selectedInvoiceId = null;
  state.invoiceDraft = {
    id: null,
    client_id: "",
    date: new Date().toISOString().slice(0, 10),
    lines: [],
    status: "draft",
    type_code: "380",
    prepaid_amount: 0,
    source_quote_id: null,
    vat_mode: "AUTO",
    vat_effective: "AUTO",
  };
  await refreshModule("invoices");
  setStatus(t("status.invoice_deleted", "Draft invoice deleted"));
  break;
}

case "invoices:issue": {
  const id = state.invoiceDraft?.id;
  if (!id) throw new Error("Sélectionner une facture.");
  if (!isDraftInvoice()) throw new Error("Facture déjà validée/émise.");
  await window.api.invoices.issue(id);
  await refreshModule("invoices");
  setStatus(t("status.invoice_issued", "Invoice issued"));
  break;
}

case "invoices:toCreditNote": {
  const srcId = state.invoiceDraft?.id;
  const st = String(state.invoiceDraft?.status || "draft").toLowerCase();
  if (!srcId) throw new Error("Sélectionner une facture.");
  if (st === "draft") throw new Error("Créer un avoir uniquement sur une facture émise.");
  const res = await window.api.invoices.createCreditNote(srcId);
  const newId = res?.id || res?.invoice_id || null;
  if (!newId) throw new Error("Avoir créé mais id non retourné.");
  state.selectedInvoiceId = newId;
  showPage("invoices");
  setStatus(t("status.creditnote_created", "Credit note (381) created from invoice."));
  break;
}

case "invoices:recordPayment": {
  const id = state.invoiceDraft?.id;
  if (!id) throw new Error("Sélectionner une facture.");

  ensurePaymentModal();

  const amountEl = document.getElementById("payAmount");
  const dateEl = document.getElementById("payDate");
  const methodEl = document.getElementById("payMethod");
  const refEl = document.getElementById("payRef");
  const btn = document.getElementById("payConfirmBtn");

  if (!btn) throw new Error("Bouton paiement manquant");

  btn.onclick = async () => {
    try {
      const amount = Number(String(amountEl.value || "").replace(",", "."));
      const date = String(dateEl.value || "").trim();
      const method = String(methodEl.value || "OTHER").trim().toLowerCase();
      const reference = String(refEl.value || "").trim();

      if (!(amount > 0)) {
        setStatus("Montant invalide");
        return;
      }

      closeModal("paymentModal");

      if (isDraftInvoice()) {
        await handleAction("invoices:save");
        await window.api.invoices.issue(id);
      }

      await window.api.payments.record({
        invoice_id: id,
        date,
        amount,
        currency: "EUR",
        method,
        reference,
        notes: "",
      });

      state.selectedInvoiceId = id;

      await refreshModule("invoices");
      await refreshModule("payments");
      await refreshModule("dashboard");

      setStatus("Paiement enregistré");
    } catch (e) {
      console.error(e);
      setStatus(`Erreur: ${String(e?.message || e)}`);
    }
  };

  openModal("paymentModal");
  amountEl?.focus();
  break;
}

      case "inbound:refresh":
        state.company = state.company || (window.api?.company?.get ? await window.api.company.get() : null);
        await refreshModule("inbound");
        setStatus(t("status.inbound.refreshed", "Inbound list refreshed"));
        break;

      case "inbound:import": {
        if (!window.api?.inbound?.importFile) throw new Error("IPC manquant: inbound:importFile");
        const res = await window.api.inbound.importFile();
        if (res?.canceled) return setStatus(t("status.inbound.import_canceled", "Import cancelled"));
        if (!res?.ok) throw new Error(res?.error || "Import échoué");
        await refreshModule("inbound");
        setStatus(t("status.inbound.import_ok", "Import OK: {name}", { name: (res.filename || res.id || "").trim() }));
        break;
      }

      case "inbound:accept": {
        const id = state.selectedInboundId;
        if (!id) throw new Error("Sélectionner une facture reçue.");
        if (!window.api?.inbound?.accept) throw new Error("IPC manquant: inbound:accept");
        if (!canDecideInbound(state.inboundDoc)) throw new Error("Décision autorisée uniquement si statut = Reçue.");
        await window.api.inbound.accept({ id });
        await refreshModule("inbound");
        setStatus(t("status.inbound.accepted", "Invoice accepted"));
        break;
      }

            case "inbound:reject": {
        const id = state.selectedInboundId;
        if (!id) throw new Error("Sélectionner une facture reçue.");
        if (!window.api?.inbound?.reject) throw new Error("IPC manquant: inbound:reject");
        if (!canDecideInbound(state.inboundDoc)) throw new Error("Décision autorisée uniquement si statut = Reçue.");

        ensureRejectModal();

        const codeSel = document.getElementById("rejectCodeSelect");
        const commentEl = document.getElementById("rejectComment");
        const commentReqEl = document.getElementById("rejectCommentReq");
        const btn = document.getElementById("rejectConfirmBtn");
        if (!codeSel || !commentEl || !btn) throw new Error("UI refus manquante (rejectModal).");

        // Remplit la liste des motifs depuis JSON (via IPC)
        try {
          const xp = await loadXpRejectJson();
          const reasons = Array.isArray(xp?.rejection_reasons)
            ? xp.rejection_reasons
            : Array.isArray(xp?.reasons)
              ? xp.reasons
              : [];

          if (reasons.length) {
            const current = codeSel.value;
            codeSel.innerHTML = `<option value="">${t("ui.choose_reason", "— choisir un motif —")}</option>`;
            for (const r of reasons) {
              const code = String(r.code || r.id || "").toUpperCase();
              const label = String(r.label || r.title || r.text || "").trim();
              if (!code) continue;
              const opt = document.createElement("option");
              opt.value = code;
              opt.textContent = label ? `${code} — ${label}` : code;
              codeSel.appendChild(opt);
            }
            codeSel.value = current || "";
          }
        } catch (e) {
          logXpRejectLoadError(e);
        }

        codeSel.value = "";
        commentEl.value = "";

        function isCommentRequiredForCode(code) {
          return String(code || "").toUpperCase() === "RF99";
        }

        function refreshCommentReqUi() {
          const code = String(codeSel.value || "").toUpperCase();
          const required = isCommentRequiredForCode(code);
          if (commentReqEl) {
            commentReqEl.textContent = required ? "commentaire obligatoire" : "commentaire facultatif";
            commentReqEl.classList.toggle("is-on", required);
          }
        }

        codeSel.onchange = refreshCommentReqUi;
        refreshCommentReqUi();

        btn.onclick = async () => {
          try {
            const rfCode = String(codeSel.value || "").trim().toUpperCase();
            const comment = String(commentEl.value || "").trim();

            if (!rfCode) {
              setStatus(t("err.reject.code_required", "Motif (code RFxx) obligatoire."));
              codeSel.focus();
              return;
            }
            if (isCommentRequiredForCode(rfCode) && !comment) {
              setStatus(t("err.reject.comment_required_rf99", "Commentaire obligatoire pour RF99."));
              commentEl.focus();
              return;
            }

            const kind = String(document.getElementById("rejectKind")?.value || "CREDITOR").toUpperCase();
            const responseCode = `${kind}:${rfCode}`;

            closeModal("rejectModal");
            await window.api.inbound.reject({ id, code: responseCode, reason: comment });

            await refreshModule("inbound");
            setStatus(t("status.inbound.rejected", "Invoice rejected"));
          } catch (e) {
            setStatus(`Erreur: ${e.message}`);
            console.error(e);
          }
        };

        openModal("rejectModal");
        codeSel.focus();
        break;
      }

      case "inbound:dispute": {
        const id = state.selectedInboundId;
        if (!id) throw new Error("Sélectionner une facture reçue.");
        if (!canDecideInbound(state.inboundDoc)) throw new Error("Litige autorisé uniquement si statut = Reçue / Non valide.");

        if (window.api?.inbound?.dispute) {
          await window.api.inbound.dispute({ id });
          await refreshModule("inbound");
          setStatus(t("status.inbound.disputed", "Invoice disputed"));
          break;
        }

        setStatus("Action Dispute non branchée (IPC inbound:dispute manquant).");
        break;
      }

      case "inbound:delete": {
        const id = state.selectedInboundId;
        if (!id) throw new Error("Sélectionner une facture reçue.");
        if (!window.api?.inbound?.delete) throw new Error("IPC manquant: inbound:delete");

        const d = state.inboundDoc ? normalizeInbound(state.inboundDoc) : null;
        const canDelete = d && INBOUND_DELETABLE_STATUSES.has(d.status);

        if (!canDelete) throw new Error("Suppression autorisée uniquement pour : Reçue / Reçue (non valide) / Erreur.");
        confirm(t("confirm.inbound.delete", "Delete this received invoice? (Received / Not valid / Error)"));

        await window.api.inbound.delete({ id });
        state.selectedInboundId = null;
        state.inboundDoc = null;
        await refreshModule("inbound");
        setStatus(t("status.inbound.deleted", "Invoice deleted"));
        break;
      }

      case "inbound:exportXml": {
        const id = state.selectedInboundId;
        if (!id) throw new Error("Sélectionner une facture reçue.");
        if (!window.api?.inbound?.exportXml) throw new Error("IPC manquant: inbound:exportXml");
        const res = await window.api.inbound.exportXml({ id });
        if (res?.canceled) return setStatus(t("status.xmlexport_canceled", "XML export cancelled"));
        if (!res?.ok) throw new Error(res?.error || "Export XML échoué");
        setStatus(`XML exporté: ${res.filePath || ""}`.trim());
        break;
      }

      case "inbound:exportPdf": {
        const id = state.selectedInboundId;
        if (!id) throw new Error("Sélectionner une facture reçue.");
        if (!window.api?.inbound?.exportPdf) throw new Error("IPC manquant: inbound:exportPdf");
        const res = await window.api.inbound.exportPdf({ id, locale: getExportLocale() });
        if (res?.canceled) return setStatus(t("status.pdfexport_canceled", "PDF export cancelled"));
        if (!res?.ok) throw new Error(res?.error || "Export PDF échoué");
        setStatus(`PDF exporté: ${res.filePath || ""}`.trim());
        break;
      }

      case "exports:openSelectedQuote": {
        const id = getSelectedExportQuoteId();
        if (!id) throw new Error("Choisir un devis dans Exports.");
        state.selectedQuoteId = id;
        showPage("quotes");
        break;
      }

      case "exports:openSelectedInvoice": {
        const id = getSelectedExportInvoiceId();
        if (!id) throw new Error("Choisir une facture dans Exports.");
        state.selectedInvoiceId = id;
        showPage("invoices");
        break;
      }

      case "exports:pdfQuote": {
        const quoteId = getSelectedExportQuoteId() || state.quoteDraft?.id || state.selectedQuoteId;
        if (!quoteId) throw new Error("Sélectionner un devis.");

        const locale = getExportLocale();
        const company = await ensureCompanyLoaded();
        const cgvText = pickCgvTextForLocale(company, locale);

        const config = {
          currency: "EUR",
          branding: { showLogo: true, accentColor: "#2563eb" },
          texts: {
            legalNoticeFr: "Dans l'attente de votre validation",
            legalNoticeEn: "Awaiting your approval",
          },

          quote: { includeCgv: true },
      };

        const sellerOverride = { ...(company || {}), cgv_text: cgvText };

        const res = await window.api.quotes.exportPdf(quoteId, locale, config, sellerOverride);

        if (res?.ok) setStatus(`PDF devis exporté: ${res.path}`);
        else if (res?.canceled) setStatus("Export PDF annulé");
        else throw new Error(res?.error || "Export PDF devis échoué");
        break;
      }

      case "exports:pdfInvoice": {
        const invoiceId =
          getSelectedExportInvoiceId() || state.invoiceDraft?.id || state.selectedInvoiceId;
        if (!invoiceId) throw new Error("Sélectionner une facture.");

        const locale = getExportLocale();

        const company = await ensureCompanyLoaded();
        const cgvText = pickCgvTextForLocale(company, locale);

        const config = {
          currency: "EUR",
          branding: { showLogo: true, accentColor: "#2563eb" },
          sellerOverride: { ...(company || {}), cgv_text: cgvText },
        };

        const res = await window.api.invoices.exportPdf(invoiceId, locale, config);

        if (res?.ok) setStatus(`PDF facture exporté: ${res.path}`);
        else if (res?.canceled) setStatus("Export PDF annulé");
        else throw new Error(res?.error || "Export PDF facture échoué");
        break;
      }

      case "exports:mailQuote": {

        const quoteId =
          getSelectedExportQuoteId() ||
          state.quoteDraft?.id ||
          state.selectedQuoteId;

        if (!quoteId)
          throw new Error("Sélectionner un devis.");

        const quote =
          await window.api.quotes.getFull(quoteId);
        console.log("QUOTE FULL =", quote);

        const locale = getExportLocale();

        const company = await ensureCompanyLoaded();

        const cgvText =
          pickCgvTextForLocale(company, locale);

        const config = {
          currency: "EUR",
          branding: {
            showLogo: true,
            accentColor: "#2563eb"
          },
          sellerOverride: {
            ...(company || {}),
            cgv_text: cgvText
          }
        };

        const pdf =
          await window.api.quotes.exportPdf(
            quoteId,
            locale,
            config
          );

        if (!pdf?.ok) {
          throw new Error(
            pdf?.error || "Export PDF impossible"
          );
        }

        const clientId =
          quote?.quote?.client_id;

        if (!clientId) {
          throw new Error(
            "Aucun client associé au devis."
          );
        }

const buyer =
  await window.api.clients.get(clientId);

console.log("CLIENT =", buyer);

        if (!buyer?.email) {
          throw new Error(
            `Le client ${buyer?.name || ""} ne possède aucune adresse email.`
          );
        }

        await window.api.email.send({
          to: buyer.email,

          subject:
      `     Devis ${quote.quote.number}`,

          text:
      `Bonjour,
      
      suite à notre entretien, veuillez trouver votre devis en pièce jointe.
      Nous restons à votre disposition pour tout renseignement complémentaire. 
      
      Cordialement.
      
      Diana,
      
      Service administratif
      D2F Compliant d.o,o
      Radnička 41/10
      11030 Belgrade
      Serbia `,
      
      attachmentPath: pdf.path,
      attachmentName:
        `${quote.quote.number}.pdf`
    });

        setStatus(
         `Devis envoyé à ${buyer.email}`
        );

        break;
      }
      
      case "exports:mailInvoice": {

        const invoiceId =
          getSelectedExportInvoiceId() ||
          state.invoiceDraft?.id ||
          state.selectedInvoiceId;

        if (!invoiceId)
          throw new Error("Sélectionner une facture.");

  const invoice =
    await window.api.invoices.getFull(invoiceId);
  console.log("INVOICE FULL =", invoice);

  const locale = getExportLocale();

  const company = await ensureCompanyLoaded();

  const cgvText =
    pickCgvTextForLocale(company, locale);

  const config = {
    currency: "EUR",
    branding: {
      showLogo: true,
      accentColor: "#2563eb"
    },
    sellerOverride: {
      ...(company || {}),
      cgv_text: cgvText
    }
  };

  const pdf =
    await window.api.invoices.exportPdf(
      invoiceId,
      locale,
      config
    );

  if (!pdf?.ok) {
    throw new Error(
      pdf?.error || "Export PDF impossible"
    );
  }

  const clientId =
  invoice?.invoice?.client_id;

if (!clientId) {
  throw new Error(
    "Aucun client associé à la facture."
  );
}

const buyer =
  await window.api.clients.get(clientId);

console.log("CLIENT =", buyer);

  if (!buyer?.email?.trim()) {
  throw new Error(
    `Le client ${buyer?.name || ""} ne possède aucune adresse email.`
  );
}

  await window.api.email.send({
    to: buyer.email,

    subject:
      `Facture ${invoice.invoice.invoice_number}`,

    text:
      `Bonjour,

      Veuillez trouver votre facture en pièce jointe conformément 
      aux termes de la commade.

      Diana,

      Service administratif
      D2F Compliant d.o,o
      Radnička 41/10
      11030 Belgrade
      Serbia `,

      attachmentPath: pdf.path,

      attachmentName:
        `${invoice.invoice.invoice_number}.pdf`
    });

  setStatus(
    `Facture envoyée à ${buyer.email}`
  );

  break;
}
      
      case "exports:peppolXml": {
        const invoiceId =
          getSelectedExportInvoiceId() || state.invoiceDraft?.id || state.selectedInvoiceId;
        if (!invoiceId) throw new Error("Sélectionner une facture.");
        if (!window.api?.invoices?.exportUbl) throw new Error("API manquante: invoices.exportUbl");

        const profile = getPeppolProfile();

        const curStatus =
          (state.invoiceDraft?.id === invoiceId ? state.invoiceDraft?.status : null) ||
          (state.selectedInvoiceId === invoiceId ? state.selectedInvoiceStatus : null) ||
          null;

        if (String(curStatus || "").toLowerCase() === "draft") {
          setStatus("Facture en brouillon : émission automatique avant export…");
          await window.api.invoices.issue({ id: invoiceId }); // adapte si ta signature diffère
        }

        // 2) Export + validation
        console.log("[UI] exportUbl invoiceId =", invoiceId);
        const res = await window.api.invoices.exportUbl({ id: invoiceId, profile });

        if (!res?.ok) {
          const msg = res?.error || "Validation/Export PEPPOL échoué.";
          const details = res?.details ? JSON.stringify(res.details, null, 2) : "";
          alert("Erreur validation PEPPOL / EN16931:\n\n" + msg + (details ? "\n\nDétails:\n" + details : "")
          );
          console.error("[PEPPOL] exportUbl failed:", res);
          setStatus("❌ UBL invalide — corriger la facture.");
          break;
        }

        const xml = res?.xml || "";
        const filename = res?.filename || "invoice";
        const copied = xml ? await tryCopyToClipboard(xml) : false;

        if (xml) {
          alert("✅ Facture conforme PEPPOL / EN16931\n\n" + filename);
          setStatus(`✅ UBL généré (${filename}). ${copied ? "XML copié." : "Copie indisponible."}`);
        } else {
          setStatus("UBL exporté (pas de XML retourné).");
        }
        break;
      }

      case "exports:peppolPdf":
        setStatus("PDF lisible (PEPPOL): à implémenter.");
        break;

      default:
        setStatus(`Action: ${actionId}`);
        break;
    }
  } catch (e) {
    setStatus(`Erreur: ${e.message}`);
    console.error(e);
  }
}

/* ===================== Conformity AI Agent (local, rule-based) ===================== */

function setStatusKey(key, fallback) {
  try {
    if (typeof t === "function") return setStatus(t(key, fallback || key));
  } catch {}
  return setStatus(fallback || key);
}

function initConformityAiAgent() {
  const chat = document.getElementById("cf-ai-chat");
  const input = document.getElementById("cf-ai-input");
  const sendBtn = document.getElementById("cf-ai-send");
  const startBtn = document.getElementById("cf-ai-start");
  const recommendBtn = document.getElementById("cf-ai-recommend");
  const checkBtn = document.getElementById("cf-ai-check");
  const summaryEl = document.getElementById("cf-ai-summary");

  if (!chat || !input || !sendBtn || !startBtn || !recommendBtn || !checkBtn || !summaryEl) {
    return;
  }

  const ui = {
    scope: () => document.getElementById("cf-scope"),
    per: () => document.getElementById("cf-periodicity"),
    arch: () => document.getElementById("cf-archiving"),
    plat: () => document.getElementById("cf-platform"),
    due: () => document.getElementById("cf-next-due"),
    b2c: () => document.getElementById("cf-emits-b2c"),
    intl: () => document.getElementById("cf-has-international"),
  };

  const help = {
    scope: () => document.getElementById("cf-help-scope"),
    per: () => document.getElementById("cf-help-periodicity"),
    arch: () => document.getElementById("cf-help-archiving"),
    plat: () => document.getElementById("cf-help-platform"),
    b2c: () => document.getElementById("cf-help-b2c"),
    intl: () => document.getElementById("cf-help-intl"),
    nextdue: () => document.getElementById("cf-help-nextdue"),
  };

  const missingBox = document.getElementById("cf-missing-box");
  const missingList = document.getElementById("cf-missing-list");
  const post = (role, text) => {
    const wrap = document.createElement("div");
    wrap.style.margin = "8px 0";
    wrap.style.display = "flex";
    wrap.style.justifyContent = role === "user" ? "flex-end" : "flex-start";
    const bubble = document.createElement("div");
    bubble.style.maxWidth = "85%";
    bubble.style.padding = "10px 12px";
    bubble.style.borderRadius = "14px";
    bubble.style.whiteSpace = "pre-wrap";
    bubble.style.border = "1px solid rgba(255,255,255,.12)";
    bubble.style.background = role === "user" ? "rgba(59,130,246,.18)" : "rgba(255,255,255,.06)";
    bubble.textContent = String(text || "");
    wrap.appendChild(bubble);
    chat.appendChild(wrap);
    chat.scrollTop = chat.scrollHeight;
  };

  const yesNoUnknown = (s) => {
    const v = String(s || "").trim().toLowerCase();
    if (["oui", "o", "yes", "y", "1", "true"].includes(v)) return true;
    if (["non", "n", "no", "0", "false"].includes(v)) return false;
    return null;
  };

  // état “agent”
  const agent = {
    step: 0,
    answers: {
      sellsB2C: null,
      hasInternational: null,
      usesMarketplace: null,
      receivesPaymentsForIntl: null,
      prefersPlatform: null, // "PA"/"OTHER"
    },
  };

  const getCompanySnapshot = async () => {
    // on essaie de récupérer la société pour contextualiser
    let co = null;
    try {
      co = state.company || (window.api?.company?.get ? await window.api.company.get() : null);
      state.company = co || state.company;
    } catch {}
    return co;
  };

  const computeEligibility = () => {
    const s = state.conformity || {};
    
    // e-reporting concerné si B2C ou international
    const emitsB2C = Number(s.emits_b2c || 0) === 1;
    const hasIntl = Number(s.has_international || 0) === 1;

    return {
      emitsB2C,
      hasIntl,
      concerned: emitsB2C || hasIntl,
      why: !emitsB2C && !hasIntl
        ? "Pas de e-reporting si pas de B2C et pas d’international (la France B2B = plutôt e-invoicing)."
        : emitsB2C && !hasIntl
          ? "Concerné e-reporting via B2C (flux 9/10)."
          : !emitsB2C && hasIntl
            ? "Concerné e-reporting via international (flux 8 + paiements)."
            : "Concerné e-reporting via B2C + international.",
    };
  };

  const recommendFields = async () => {
    const co = await getCompanySnapshot();
    const elig = computeEligibility();

    let allowed = ["M"];
    try {
      const vr = co?.vat_regime || state.company?.vat_regime;
      if (typeof allowedPeriodicitiesFromVatRegime === "function") {
        allowed = allowedPeriodicitiesFromVatRegime(vr);
      }
    } catch {}

    const rec = {
      scope: "FR",
      periodicity: allowed[0] || "M",
      archiving: "ON",
      platform: state.conformity?.platform || "",
    };

    if (elig.hasIntl) rec.scope = "INTL";

    // si l’utilisateur a indiqué une préférence plateforme
    if (agent.answers.prefersPlatform) rec.platform = agent.answers.prefersPlatform;

    return { rec, allowed, elig, company: co };
  };

  const applyRecommendationsToUi = async () => {
    const { rec, allowed, elig } = await recommendFields();

    if (ui.scope()) ui.scope().value = rec.scope;
    if (ui.per()) ui.per().value = allowed.includes(rec.periodicity) ? rec.periodicity : (allowed[0] || "M");
    if (ui.arch()) ui.arch().value = rec.archiving;
    if (ui.plat() && rec.platform) ui.plat().value = rec.platform;

    state.conformity.scope = rec.scope;
    state.conformity.periodicity = ui.per()?.value || rec.periodicity;
    state.conformity.archiving = rec.archiving;
    if (rec.platform) state.conformity.platform = rec.platform;

    const payload = { ...state.conformity };
    if (window.api?.conformity?.saveConfig) await window.api.conformity.saveConfig(payload);
    else if (window.api?.company?.setConformityConfig) await window.api.company.setConformityConfig(payload);

    await refreshModule("conformity").catch(() => {});
    post("assistant", `✅ J’ai appliqué des recommandations.\n- Scope: ${rec.scope}\n- Périodicité: ${state.conformity.periodicity}\n- Archivage: ${rec.archiving}\n- Plateforme: ${rec.platform || "—"}`);
    post("assistant", `Statut: ${elig.concerned ? "✅ Concerné e-reporting" : "🟦 Non concerné e-reporting"}\n${elig.why}`);
  };

  const updateHelpTextsAndMissing = async () => {
    const s = state.conformity || {};
    const elig = computeEligibility();
    const co = await getCompanySnapshot();
    const vr = co?.vat_regime || state.company?.vat_regime || "";

    // Aides “quoi remplir”
    if (help.scope()) help.scope().textContent =
      "FR = périmètre France. INTL = si vous avez des opérations hors France (export / services à l’étranger).";

    if (help.per()) help.per().textContent =
      `D = quotidien (cas spécifiques), M = mensuel (souvent), B = bimestriel (selon régime). Régime TVA détecté: ${vr || "—"}`;

    if (help.arch()) help.arch().textContent =
      "ON recommandé: conserve la preuve de calcul/envoi et la piste d’audit.";

    if (help.plat()) help.plat().textContent =
      "Choisis le canal cible: PA (plateforme). Ce champ est déclaratif tant que pas d’intégration technique.";

    if (help.b2c()) help.b2c().textContent =
      "Oui si vius facturez des particuliers (B2C).";

    if (help.intl()) help.intl().textContent =
      "Oui si vous avez des ventes/prestations hors France (export, services à l’étranger, etc.).";

    if (help.nextdue()) help.nextdue().textContent =
      "Info interne: prochaine échéance prévue. Ne remplace pas un calendrier réglementaire.";

    // Vérif complétude minimale “pré-config”
    const missing = [];

    // Concerné => il faut au moins plateforme + periodicité + archivage
    if (elig.concerned) {
      if (!String(s.platform || "").trim()) missing.push("Plateforme (PA/OTHER)");
      if (!String(s.periodicity || "").trim()) missing.push("Périodicité (D/M/B)");
      if (!String(s.archiving || "").trim()) missing.push("Archivage (ON recommandé)");
      // scope utile surtout si international
      if (elig.hasIntl && String(s.scope || "").toUpperCase() !== "INTL") {
        missing.push("Scope (mettre INTL car international = oui)");
      }
    } else {
      // non concerné => on ne force pas plateforme, mais on garde des conseils
      if (!String(s.archiving || "").trim()) missing.push("Archivage (recommandé même si non concerné e-reporting)");
    }

    if (missingBox && missingList) {
      if (missing.length) {
        missingBox.style.display = "block";
        missingList.innerHTML = "• " + missing.join("<br/>• ");
      } else {
        missingBox.style.display = "none";
        missingList.textContent = "";
      }
    }

    // résumé
    const summaryLines = [];
    summaryLines.push(`${elig.concerned ? "✅" : "🟦"} ${elig.concerned ? "Concerné e-reporting" : "Non concerné e-reporting"}`);
    summaryLines.push(elig.why);
    summaryLines.push("");
    summaryLines.push(`Champs actuels: scope=${s.scope || "—"}, periodicity=${s.periodicity || "—"}, archiving=${s.archiving || "—"}, platform=${s.platform || "—"}`);
    if (missing.length) summaryLines.push(`\nÀ compléter: ${missing.join(", ")}`);

    summaryEl.textContent = summaryLines.join("\n");
  };

  // Script “diagnostic” : questions courtes + mapping vers tes champs
  const script = [
    {
      q: "Question 1/5 — Facturez-vous des particuliers (B2C) ? (oui/non)",
      onAnswer: async (txt) => {
        const v = yesNoUnknown(txt);
        agent.answers.sellsB2C = v;
        if (v !== null) {
          state.conformity.emits_b2c = v ? 1 : 0;
          if (ui.b2c()) ui.b2c().value = v ? "1" : "0";
        }
      },
    },
    {
      q: "Question 2/5 — Faites-vous des ventes/prestations hors France (international) ? (oui/non)",
      onAnswer: async (txt) => {
        const v = yesNoUnknown(txt);
        agent.answers.hasInternational = v;
        if (v !== null) {
          state.conformity.has_international = v ? 1 : 0;
          if (ui.intl()) ui.intl().value = v ? "1" : "0";
          if (v && ui.scope()) ui.scope().value = "INTL";
        }
      },
    },
    {
      q: "Question 3/5 — Vous voulez passer par quelle voie ? PA, OTHER (répondre: pa/other)",
      onAnswer: async (txt) => {
        const v = String(txt || "").trim().toUpperCase();
        const ok = ["PA", "OTHER"].includes(v) ? v : null;
        agent.answers.prefersPlatform = ok;
        if (ok) {
          state.conformity.platform = ok;
          if (ui.plat()) ui.plat().value = ok;
        }
      },
    },
    {
      q: "Question 4/5 — Votre périodicité est-elle mensuelle ? (oui = M / non = on laisse selon TVA)",
      onAnswer: async (txt) => {
        const v = yesNoUnknown(txt);
        if (v === true) {
          state.conformity.periodicity = "M";
          if (ui.per()) ui.per().value = "M";
        }
      },
    },
    {
      q: "Question 5/5 — Activer l’archivage (recommandé) ? (oui/non)",
      onAnswer: async (txt) => {
        const v = yesNoUnknown(txt);
        if (v !== null) {
          state.conformity.archiving = v ? "ON" : "OFF";
          if (ui.arch()) ui.arch().value = v ? "ON" : "OFF";
        }
      },
    },
  ];

  const runCheckAndSave = async () => {
    const payload = { ...state.conformity };
    try {
      if (window.api?.conformity?.saveConfig) await window.api.conformity.saveConfig(payload);
      else if (window.api?.company?.setConformityConfig) await window.api.company.setConformityConfig(payload);
    } catch {}
    await refreshModule("conformity").catch(() => {});
    await updateHelpTextsAndMissing().catch(() => {});
  };

  const startDiagnostic = async () => {
    agent.step = 0;
    chat.innerHTML = "";
    post("assistant", "Bonjour 👋 On fait un mini diagnostic réforme (e-reporting). Répondez simplement (oui/non/pa/autre).");
    await updateHelpTextsAndMissing().catch(() => {});
    post("assistant", script[0].q);
    input.focus();
  };

  const handleUserText = async (txt) => {
    const text = String(txt || "").trim();
    if (!text) return;

    post("user", text);

    const cur = script[agent.step];
    if (!cur) {
      post("assistant", "Diagnostic déjà terminé. Vous pouvez cliquer “Recommandations” ou “Vérifier complétude”.");
      return;
    }

    try {
      await cur.onAnswer(text);
      agent.step++;

      await runCheckAndSave();

      if (agent.step < script.length) {
        post("assistant", script[agent.step].q);
      } else {
        const elig = computeEligibility();
        post("assistant", `✅ Diagnostic terminé.\nStatut: ${elig.concerned ? "Concerné e-reporting" : "Non concerné e-reporting"}\n${elig.why}`);
        post("assistant", "Vous pouvez cliquer “Recommandations” pour pré-remplir les champs.");
      }
    } catch (e) {
      post("assistant", `Oups: ${e.message || e}`);
    }
  };

  // wiring boutons
  startBtn.onclick = () => startDiagnostic().catch(console.error);

  recommendBtn.onclick = () => {
    post("assistant", "Je calcule des recommandations à partir de votre société + vos réponses…");
    applyRecommendationsToUi().catch((e) => post("assistant", `Erreur recommandations: ${e.message || e}`));
  };

  checkBtn.onclick = () => {
    updateHelpTextsAndMissing().catch(console.error);
    post("assistant", "✅ Vérification complétude effectuée (voir “Champs à compléter” et le résumé).");
  };

  sendBtn.onclick = () => handleUserText(input.value).finally(() => (input.value = ""));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleUserText(input.value).finally(() => (input.value = ""));
    }
  });

  // auto : maintient aides à jour quand on navigue
  updateHelpTextsAndMissing().catch(() => {});
}

/* ----------------- Init bindings ----------------- */
function init() {
  console.log("init() start");

  try {
    // inbound auto-start (si dispo)
    (async () => {
      try {
        if (window.api?.company?.getInboundConfig && window.api?.inbound) {
          const inbound = await window.api.company.getInboundConfig();

          if (inbound?.sftp?.enabled && window.api.inbound.sftpStart) {
            await window.api.inbound.sftpStart(inbound.sftp);
          }
          if (inbound?.webhook?.enabled && window.api.inbound.webhookStart) {
            await window.api.inbound.webhookStart(inbound.webhook);
          }
        }
      } catch (e) {
        console.error(e);
      }
    })();

    // prépare les modals
    ensureRejectModal();
    ensurePaymentModal();

    initNavigation();
    initConformityAiAgent();

    // data-action buttons
    document.body.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      console.log("CLICK action:", btn.dataset.action);
      const action = btn.dataset.action;
      if (action === "quotes:accept") {
        const id = state.quoteDraft?.id;
        const number = state.quoteDraft?.number;
        return handleAction(action, id ? { id } : number ? { number } : null);
      }

      handleAction(action);
    });

    // view switch
    document.body.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-view]");
      if (!btn) return;
      document.querySelectorAll("[data-view]").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      setView(btn.dataset.view);
    });

    // lists clicks
    $("clientsList")?.addEventListener("click", async (e) => {
      const item = e.target.closest(".list__item");
      if (!item) return;
      state.selectedClientId = item.dataset.id;
      await refreshModule("clients");
    });

    $("itemsList")?.addEventListener("click", async (e) => {
      const item = e.target.closest(".list__item");
      if (!item) return;
      state.selectedItemId = item.dataset.id;
      await refreshModule("items");
    });

    $("quotesList")?.addEventListener("click", async (e) => {
      const item = e.target.closest(".list__item");
      if (!item) return;

      const id = item.dataset.id;
      if (!id) return;

      state.selectedQuoteId = id;

      await refreshModule("quotes");

      try {
        const fresh = await window.api.quotes.get(id);
        if (fresh) {
          state.quoteDraft = fresh;
          renderQuoteDraft(); // badge + champs
        }
      } catch (err) {
        console.error("[quotesList click] get failed", err);
      }
    });

    $("invoicesList")?.addEventListener("click", async (e) => {
      const item = e.target.closest(".list__item");
      if (!item) return;
      state.selectedInvoiceId = item.dataset.id;
      await refreshModule("invoices");
    });

    $("inboundList")?.addEventListener("click", async (e) => {
      const item = e.target.closest(".list__item");
      if (!item) return;
      state.selectedInboundId = item.dataset.id;
      await refreshModule("inbound");
    });

    // searches
    $("clientsSearch")?.addEventListener("input", () => refreshModule("clients").catch(console.error));
    $("itemsSearch")?.addEventListener("input", () => refreshModule("items").catch(console.error));
    $("quotesSearch")?.addEventListener("input", () => refreshModule("quotes").catch(console.error));
    $("invoicesSearch")?.addEventListener("input", () => refreshModule("invoices").catch(console.error));
    $("inboundSearch")?.addEventListener("input", () => refreshModule("inbound").catch(console.error));

    // VAT watchers
    $("q-client")?.addEventListener("change", () => applyVatForQuote().catch(console.error));
    $("i-client")?.addEventListener("change", () => applyVatForInvoice().catch(console.error));
    $("q-vat-mode")?.addEventListener("change", () => applyVatForQuote().catch(console.error));
    $("i-vat-mode")?.addEventListener("change", () => applyVatForInvoice().catch(console.error));

    // ===================== BEGIN PATCH E-INVOICING / E-REPORTING (WATCHERS) =====================
    
    const cfSave = async () => {
    const payload = { ...state.conformity };
    if (window.api?.conformity?.saveConfig) {
      await window.api.conformity.saveConfig(payload);
    }
  };

    document.getElementById("cf-scope")?.addEventListener("change", async (e) => {
      state.conformity.scope = String(e.target.value || "FR").toUpperCase() === "INTL" ? "INTL" : "FR";
      await cfSave().catch(() => {});
      await refreshModule("conformity").catch(() => {});
    });

    document.getElementById("cf-periodicity")?.addEventListener("change", async (e) => {
      state.company = state.company || await window.api.company.get();
      const allowed = allowedPeriodicitiesFromVatRegime(state.company.vat_regime);

      const v = String(e.target.value || "");
      state.conformity.periodicity = allowed.includes(v)
        ? v
        : allowed[0];

      await cfSave().catch(() => {});
      await refreshModule("conformity").catch(() => {});
    });

    document.getElementById("cf-archiving")?.addEventListener("change", async (e) => {
      state.conformity.archiving = String(e.target.value || "ON").toUpperCase() === "OFF" ? "OFF" : "ON";
      await cfSave().catch(() => {});
    });

    document.getElementById("cf-platform")?.addEventListener("change", async (e) => {
      state.conformity.platform = String(e.target.value || "");
      await cfSave().catch(() => {});
    });

    
    document.getElementById("cf-emits-b2c")?.addEventListener("change", async (e) => {
      state.conformity.emits_b2c = String(e.target.value) === "1" ? 1 : 0;
      await cfSave().catch(() => {});
      await refreshModule("conformity").catch(() => {});
    });

    document.getElementById("cf-has-international")?.addEventListener("change", async (e) => {
      state.conformity.has_international = String(e.target.value) === "1" ? 1 : 0;
      await cfSave().catch(() => {});
      await refreshModule("conformity").catch(() => {});
    });

    function getQuoteBaseDate() {
      return $("q-date")?.value || state.quoteDraft.date || new Date().toISOString().slice(0, 10);
    }

    function setQuoteValidityDays(days) {
      state.quoteDraft.validity_days = days;
      const el = $("q-validity-days");
      if (el) el.value = days == null ? "" : String(days);
    }

    function setQuoteValidUntil(iso) {
      state.quoteDraft.valid_until = iso || "";
      const el = $("q-valid-until");
      if (el) el.value = iso || "";
    }

    // 1) jours -> calcule "valable jusqu'au"
    $("q-validity-days")?.addEventListener("input", () => {
      const raw = String($("q-validity-days")?.value ?? "").trim();
      if (raw === "") {
        // si l'utilisateur vide, on vide aussi la date
        setQuoteValidityDays(null);
        setQuoteValidUntil("");
        return;
      }

      const n = Number(raw.replace(",", "."));
      if (!Number.isFinite(n)) return; // ignore saisies invalides
      const days = Math.max(0, Math.floor(n)); // clamp + entier (optionnel)
      setQuoteValidityDays(days);

      const baseDate = getQuoteBaseDate();
      const until = addDaysISO(baseDate, days);
      if (until) setQuoteValidUntil(until);
    });

    // 2) "valable jusqu'au" -> recalcule jours
    $("q-valid-until")?.addEventListener("change", () => {
      const vu = String($("q-valid-until")?.value ?? "").trim();
      if (!vu) {
        setQuoteValidUntil("");
        setQuoteValidityDays(null);
        return;
      }

      setQuoteValidUntil(vu);

      const baseDate = getQuoteBaseDate();
      const diff = diffDaysISO(baseDate, vu);
      if (diff == null) return;

      setQuoteValidityDays(Math.max(0, diff));
    });

    $("q-date")?.addEventListener("change", () => {
      const d = $("q-date")?.value || new Date().toISOString().slice(0, 10);
      state.quoteDraft.date = d;

      const days = state.quoteDraft.validity_days;
      const until = state.quoteDraft.valid_until;

      if (days != null && Number.isFinite(Number(days))) {
        const newUntil = addDaysISO(d, Number(days));
        if (newUntil) setQuoteValidUntil(newUntil);
        return;
      }

      if (until) {
        const diff = diffDaysISO(d, until);
        if (diff != null) setQuoteValidityDays(Math.max(0, diff));
      }
    });

    $("q-payment-text")?.addEventListener("input", () => {
      state.quoteDraft.payment_text = $("q-payment-text")?.value || "";
    });

    // seller country impacts AUTO
    $("co-country")?.addEventListener("input", () => {
      state.company = state.company || {};
      state.company.country = $("co-country")?.value;
      applyVatForQuote({ silent: true }).catch(() => {});
      applyVatForInvoice({ silent: true }).catch(() => {});
    });

    // start
    setStatus(t("ui.loading_dashboard", "Chargement du tableau de bord…"));
    showPage("dashboard");
    setView("split");

    console.log("init() end");
  } catch (e) {
    console.error("init() crashed:", e);
    setStatus(`Erreur init: ${e.message}`);
  }
}

    document.addEventListener("DOMContentLoaded", () => {
  (async () => {
    try {
      await Promise.all([loadI18n(state.lang || getLang()), loadI18n(DEFAULT_LANG)]);
      applyStaticI18n(document);

      await init(); // si init est async, sinon init();
      bindQuotesListClick();
      
      document.getElementById("navModules")?.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-module]");
        if (!btn) return;

        if (btn.getAttribute("data-module") === "conformity") {
          initConformityPage().catch(console.error);
        }
      });

    } catch (e) {
      console.error("INIT FAILED:", e);
      setStatus("Erreur init (voir console)");
    }
  })();
});
