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
      { id: "items:save", i18n: "action.save", fallback: "Enregistrer", variant: "primary" },
      { id: "items:new", i18n: "action.new", fallback: "Nouveau", variant: "secondary" },
      { id: "items:importCsv", i18n: "items.import_csv", fallback: "Importer CSV…", variant: "secondary" },
      { id: "items:delete", i18n: "action.delete", fallback: "Supprimer", variant: "danger" },
    ],
  },

  quotes: {
    title: "Devis",
    desc: "Éditeur devis + transformation en facture.",
    actions: [
      { id: "quotes:save", i18n: "Enregistrer", variant: "primary" },
      { id: "quotes:new", i18n: "Nouveau", variant: "secondary" },
      { id: "quotes:delete", i18n: "Supprimer", variant: "danger" },
      { id: "quotes:importCsv", i18n: "quotes.import_csv_history", fallback: "Importer historique CSV…", variant: "secondary" },
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
      { id: "invoices:importCsv", i18n: "invoices.import_csv_history", fallback: "Importer historique CSV…", variant: "secondary" },
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
  title: "Déclarations",
  desc: "Obligations réglementaires, transmissions et accusés de réception selon le pays.",
  actions: [
    { id: "conformity:refresh", i18n: "Rafraîchir", variant: "secondary" },
    { id: "conformity:sendNow", i18n: "Transmettre les dossiers prêts", variant: "primary" },
    { id: "conformity:openQueue", i18n: "File d’envoi", variant: "ghost" },
    { id: "conformity:rebuildPeriod", i18n: "Préparer la période", variant: "secondary" },
    { id: "conformity:settings", i18n: "Paramètres entreprise", variant: "secondary" },
  ],
},


  audit: {
    title: "PAF / Trace",
    desc: "Journal sécurisé des opérations et preuves de contrôle.",
    actions: [],
  },
};

const WORKFLOW_GUIDES = {
  company: { action: "company:save" },
  dashboard: { action: "dashboard:refresh" },
  clients: { action: "clients:new" },
  items: { action: "items:new" },
  quotes: { action: "quotes:new" },
  invoices: { action: "invoices:new" },
  payments: { action: "payments:refresh" },
  inbound: { action: "inbound:import" },
  exports: { focusId: "ex-invoice" },
  conformity: { action: "conformity:rebuildPeriod" },
  audit: { focusId: "auditBtnRead" },
};

function renderWorkflowCompanion(moduleKey) {
  const guide = WORKFLOW_GUIDES[moduleKey] || WORKFLOW_GUIDES.dashboard;
  const title = document.getElementById("workflowCompanionTitle");
  const summary = document.getElementById("workflowCompanionSummary");
  const steps = document.getElementById("workflowCompanionSteps");
  const result = document.getElementById("workflowCompanionResult");
  const action = document.getElementById("workflowCompanionAction");
  const eyebrow = document.getElementById("workflowCompanionEyebrow");
  const stepsTitle = document.getElementById("workflowCompanionStepsTitle");
  const resultLabel = document.getElementById("workflowCompanionResultLabel");
  if (!title || !summary || !steps || !result || !action) return;

  const prefix = "companion." + moduleKey + ".";
  title.textContent = t(prefix + "title", MODULES[moduleKey]?.title || moduleKey);
  summary.textContent = t(prefix + "summary", MODULES[moduleKey]?.desc || "");
  if (eyebrow) eyebrow.textContent = t("companion.eyebrow", "COMPAGNON D2F");
  if (stepsTitle) stepsTitle.textContent = t("companion.steps", "Étapes conseillées");
  if (resultLabel) resultLabel.textContent = t("companion.result", "Résultat attendu");
  steps.innerHTML = "";
  for (let index = 1; index <= 3; index += 1) {
    const item = document.createElement("li");
    item.textContent = t(prefix + "step" + index, "");
    steps.appendChild(item);
  }
  result.textContent = t(prefix + "expected", "");
  action.textContent = t(prefix + "action", t("companion.start", "Commencer"));
  action.removeAttribute("data-action");
  action.removeAttribute("data-focus-id");
  if (guide.action) action.dataset.action = guide.action;
  if (guide.focusId) action.dataset.focusId = guide.focusId;
  action.hidden = !(guide.action || guide.focusId);
}

function setWorkflowCompanionOpen(open) {
  const panel = document.getElementById("workflowCompanionPanel");
  const toggle = document.getElementById("workflowCompanionToggle");
  if (!panel || !toggle) return;
  panel.hidden = !open;
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  document.body.classList.toggle("is-workflow-companion-open", open);
  if (open) document.getElementById("workflowCompanionClose")?.focus();
}

function initWorkflowCompanion() {
  const toggle = document.getElementById("workflowCompanionToggle");
  const close = document.getElementById("workflowCompanionClose");
  const action = document.getElementById("workflowCompanionAction");
  toggle?.addEventListener("click", () => setWorkflowCompanionOpen(toggle.getAttribute("aria-expanded") !== "true"));
  close?.addEventListener("click", () => setWorkflowCompanionOpen(false));
  action?.addEventListener("click", () => {
    const focusId = action.dataset.focusId;
    if (focusId) {
      const target = document.getElementById(focusId);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus();
    }
    setWorkflowCompanionOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setWorkflowCompanionOpen(false);
  });
  renderWorkflowCompanion(state?.currentModule || "dashboard");
}

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
    allowance_percent: Number(inv.allowance_percent || 0),
    allowance_amount: Number(inv.allowance_amount || 0),
    allowance_reason: inv.allowance_reason || "",
    allowance_reason_code: inv.allowance_reason_code || "95",
    historical_import: Boolean(inv.historical_import),
  };
}

function setButtonDisabled(btn, disabled) {
  if (!btn) return;
  btn.disabled = !!disabled;
  btn.setAttribute("aria-disabled", disabled ? "true" : "false");
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
  langWrap.className = "toolbarLanguage";

  const langLabel = document.createElement("span");
  langLabel.className = "toolbar__langLabel";
  langLabel.textContent = t("toolbar.language", t("toolbar.lang", "Langue"));

  const langSel = document.createElement("select");
  langSel.id = "toolbarLangSelect";
  langSel.className = "toolbarLanguage__select";

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
    updateCountryEInvoicingProfile(state.company || {});

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
    renderWorkflowCompanion(cur);
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

  const actions = [...(cfg.actions || [])];
  if (moduleKey === "quotes") {
    actions.unshift(
      { id: "quotes:accept", i18n: "action.accept", fallback: "Accepter", variant: "primary" },
      { id: "quotes:reject", i18n: "action.reject", fallback: "Refuser", variant: "danger" },
    );
  }

  const directIds = toolbarDirectActionIds(moduleKey);
  const directActions = actions.filter((action) => directIds.includes(action.id));
  const overflowActions = actions.filter((action) => !directIds.includes(action.id));

  for (const action of directActions) {
    elToolbar.appendChild(createToolbarActionButton(action, moduleKey));
  }

  if (overflowActions.length) {
    const overflow = document.createElement("details");
    overflow.className = "toolbarMore";

    const trigger = document.createElement("summary");
    trigger.className = "btn btn--secondary toolbarMore__trigger";
    trigger.setAttribute("aria-label", t("toolbar.more_actions", "Plus d’actions"));
    const triggerIcon = document.createElement("span");
    triggerIcon.className = "toolbarMore__icon";
    triggerIcon.setAttribute("aria-hidden", "true");
    triggerIcon.textContent = "⋯";
    const triggerText = document.createElement("span");
    triggerText.className = "toolbarMore__text";
    triggerText.textContent = t("toolbar.more_actions", "Plus d’actions");
    trigger.appendChild(triggerIcon);
    trigger.appendChild(triggerText);
    overflow.appendChild(trigger);

    const menu = document.createElement("div");
    menu.className = "toolbarMore__menu";
    menu.setAttribute("role", "menu");

    for (const action of overflowActions) {
      const button = createToolbarActionButton(action, moduleKey, true);
      button.setAttribute("role", "menuitem");
      button.addEventListener("click", () => overflow.removeAttribute("open"));
      menu.appendChild(button);
    }

    overflow.appendChild(menu);
    elToolbar.appendChild(overflow);
  }
}

function toolbarDirectActionIds(moduleKey) {
  if (moduleKey === "quotes") {
    if (state.quoteDraft?.historical_import) return ["quotes:new"];
    const hasId = !!state.quoteDraft?.id;
    const status = canonicalQuoteStatus(state.quoteDraft);
    if (hasId && status === "sent") return ["quotes:accept", "quotes:reject"];
    if (hasId && status === "accepted") return ["quotes:toFinalInvoice", "quotes:toInvoice"];
    if (hasId && status === "draft") return ["quotes:save", "quotes:issue"];
    return ["quotes:save", "quotes:new"];
  }

  if (moduleKey === "invoices") {
    if (state.invoiceDraft?.historical_import) return ["invoices:new"];
    if (state.invoiceDraft?.id && isDraftInvoice()) return ["invoices:save", "invoices:issue"];
    if (state.invoiceDraft?.id) return ["invoices:toCreditNote", "invoices:recordPayment"];
    return ["invoices:save", "invoices:new"];
  }

  if (moduleKey === "inbound" && state.selectedInboundId && canDecideInbound(state.inboundDoc)) {
    return ["inbound:accept", "inbound:reject"];
  }

  return {
    company: ["company:save"],
    dashboard: ["dashboard:refresh"],
    payments: ["payments:refresh"],
    clients: ["clients:save", "clients:new"],
    items: ["items:save", "items:new"],
    inbound: ["inbound:refresh", "inbound:import"],
    conformity: ["conformity:rebuildPeriod", "conformity:sendNow"],
  }[moduleKey] || [];
}

function createToolbarActionButton(action, moduleKey, inOverflow = false) {
  const button = document.createElement("button");
  button.className = inOverflow
    ? `toolbarMore__item${action.variant === "danger" ? " toolbarMore__item--danger" : ""}`
    : buttonClass(action.variant);
  button.type = "button";
  button.textContent = resolveActionLabel(action);
  button.dataset.action = action.id;
  setButtonDisabled(button, isToolbarActionDisabled(action.id, moduleKey));
  return button;
}

function isToolbarActionDisabled(actionId, moduleKey) {
  if (moduleKey === "quotes" && state.quoteDraft?.historical_import) return !["quotes:new", "quotes:importCsv"].includes(actionId);
  if (moduleKey === "invoices" && state.invoiceDraft?.historical_import) return !["invoices:new", "invoices:importCsv"].includes(actionId);
  if (moduleKey === "quotes") {
    const hasId = !!state.quoteDraft?.id;
    const quoteState = canonicalQuoteStatus(state.quoteDraft);
    const isDraft = quoteState === "draft";
    const canDecide = hasId && (isDraft || quoteState === "sent");
    const isAccepted = hasId && quoteState === "accepted";
    if (["quotes:accept", "quotes:reject"].includes(actionId)) return !canDecide;
    if (["quotes:delete", "quotes:remove"].includes(actionId)) return !hasId || !isDraft;
    if (["quotes:save", "quotes:update"].includes(actionId)) return hasId && !isDraft;
    if (actionId === "quotes:issue") return hasId && !isDraft;
    if (["quotes:toDepositInvoice", "quotes:toFinalInvoice", "quotes:toInvoice"].includes(actionId)) return !isAccepted;
  }

  if (moduleKey === "invoices") {
    if (actionId === "invoices:delete") return !(state.invoiceDraft?.id && isDraftInvoice());
    if (actionId === "invoices:save") return !!state.invoiceDraft?.id && !isDraftInvoice();
    if (actionId === "invoices:issue") return !(state.invoiceDraft?.id && isDraftInvoice());
    if (actionId === "invoices:toCreditNote") {
      const has = !!state.invoiceDraft?.id;
      return !has || String(state.invoiceDraft?.status || "draft").toLowerCase() === "draft";
    }
    if (actionId === "invoices:recordPayment") return !state.invoiceDraft?.id;
  }

  if (moduleKey === "inbound") {
    if (["inbound:accept", "inbound:reject", "inbound:dispute"].includes(actionId)) {
      return !state.selectedInboundId || !canDecideInbound(state.inboundDoc);
    }
    if (actionId === "inbound:delete") {
      const document = state.inboundDoc ? normalizeInbound(state.inboundDoc) : null;
      return !(state.selectedInboundId && document && INBOUND_DELETABLE_STATUSES.has(document.status));
    }
    if (actionId === "inbound:exportXml") return !state.selectedInboundId || !window.api?.inbound?.exportXml;
    if (actionId === "inbound:exportPdf") return !state.selectedInboundId || !window.api?.inbound?.exportPdf;
  }

  if (moduleKey === "conformity" && actionId === "conformity:sendNow") {
    return !state.regulatoryReport?.configuration?.ready || Number(state.regulatoryReport?.summary?.ready || 0) < 1;
  }

  return false;
}

function showPage(key) {
  for (const p of dom.pages()) p.classList.toggle("is-active", p.dataset.page === key);
  document.querySelectorAll(".nav__item").forEach((b) => b.classList.toggle("is-active", b.dataset.module === key));

  const activeNavItem = document.querySelector(`.nav__item[data-module="${key}"]`);
  if (activeNavItem && window.matchMedia?.("(max-width: 760px)").matches) {
    window.requestAnimationFrame(() => {
      activeNavItem.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    });
  }

  const elTitle = dom.title();
  const elDesc = dom.desc();

  if (elTitle) elTitle.textContent = normalizeLabel(t(`app.title.${key}`, MODULES[key]?.title || key));
  if (elDesc) elDesc.textContent = t(`app.desc.${key}`, MODULES[key]?.desc || "");

  renderToolbar(key);
  state.currentModule = key;
  renderWorkflowCompanion(key);
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
    reporting_periodicity: "M",
    emits_b2c: 0,
    has_international: 0,
    vat_on_collections: 0,
    retail_fiscalization: 0,
    spain_sii: 0,
    spain_mode: "VERIFACTU",
  },
  regulatoryReport: null,
  
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
    due_date: "",
    payment_term: "",
    payment_text: "",
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
  const peppol = normalizeClientPeppol(c.peppol_endpoint_scheme, c.peppol_endpoint_id);

  return {
    ...c,
    vat_subject,
    is_vat_subject: vat_subject,
    postal_code: c.postal_code ?? c.postal ?? "",
    customer_type: (c.customer_type || c.customerType || "B2C").toString().toUpperCase(),
    peppol_endpoint_scheme: peppol.scheme,
    peppol_endpoint_id: peppol.endpointId,

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
  requireFilled("Société: identifiant d’établissement obligatoire", c?.legal_id);
  validateEstablishmentIdentity(c);
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
    const discount = Number(l.remise_percent || 0);
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) throw new Error(`Ligne ${i + 1}: la remise doit être comprise entre 0 et 100 %`);
  }
}
function validateDocumentDiscount(document) {
  const discount = Number(document?.allowance_percent || 0);
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) throw new Error("La remise globale doit être comprise entre 0 et 100 %");
  if (discount > 0 && !String(document?.allowance_reason || "").trim()) document.allowance_reason = t("discount.default_reason", "Remise commerciale");
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

function paymentDaysFromRecord(record) {
  const raw = record?.payment_days ?? record?.paymentDays;
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    const days = Number(raw);
    if (Number.isFinite(days) && days >= 0) return Math.floor(days);
  }
  return defaultPaymentDaysFromTerm(record?.payment_term || record?.paymentTerm);
}

function resolvedInvoiceDueDate(issueDate, invoice = {}, client = {}) {
  const explicit = String(invoice?.due_date || invoice?.dueDate || "").slice(0, 10);
  if (explicit) return explicit;
  const days = paymentDaysFromRecord(invoice) ?? paymentDaysFromRecord(client);
  return days == null ? "" : addDaysISO(issueDate, days);
}

function applyInvoiceClientPaymentDefaults(client, { force = false } = {}) {
  const issueDate = $("i-date")?.value || state.invoiceDraft.date || new Date().toISOString().slice(0, 10);
  const term = normalizePaymentTermCode(client?.payment_term || client?.paymentTerm || "");
  const dueDate = resolvedInvoiceDueDate(issueDate, {}, client || {});
  if (force || !state.invoiceDraft.payment_term) state.invoiceDraft.payment_term = term;
  if (force || !state.invoiceDraft.payment_text) state.invoiceDraft.payment_text = client?.payment_text || client?.paymentText || "";
  if (force || !state.invoiceDraft.due_date) state.invoiceDraft.due_date = dueDate;
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
  if (raw === "historical") return "historical";
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
  const operationalQuotes = quotes.filter((record) => !record.historical_import);
  const operationalInvoices = invoices.filter((record) => !record.historical_import);

  const qInProgress = operationalQuotes.filter((q) => ["draft", "sent"].includes(canonicalQuoteStatus(q))).length;
  const qAccepted = operationalQuotes.filter((q) => canonicalQuoteStatus(q) === "accepted").length;
  const qRefused = operationalQuotes.filter((q) => canonicalQuoteStatus(q) === "rejected").length;

  const receivableSummary = window.D2FReceivables.summarize(operationalInvoices, paymentsAll);
  const issued = receivableSummary.rows.length;
  const paid = receivableSummary.paidCount;
  const credited = receivableSummary.creditedCount;
  const waiting = receivableSummary.waitingCount;
  const ca = computeRecognizedRevenueHT(operationalInvoices);

  const paidByInvoice = new Map();
  let totalPay = 0;

  const byMethodAgg = { card: 0, transfer: 0, cash: 0, check: 0, sepa: 0, other: 0 };

  for (const p of paymentsAll || []) {
    const iid = String(p.invoice_id || "");
    const amt = window.D2FReceivables.paymentSignedAmount(p);
    if (Math.abs(amt) < window.D2FReceivables.EPSILON) continue;

    if (iid) paidByInvoice.set(iid, (paidByInvoice.get(iid) || 0) + amt);

    const m = normalizePayMethod(p.method);
    byMethodAgg[m] = (byMethodAgg[m] || 0) + amt;
    totalPay += amt;
  }

  const depositsIssued = operationalInvoices.filter((i) => invoiceStatus(i) === "issued" && isDepositInvoice(i));

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
    
    invoices: { issued, paid, credited, waiting },
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
      `<div class="totals__row"><span>${t("dash.invoices.credited", "Annulées par avoir")}</span><strong>${inv.credited || 0}</strong></div>` +
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

function computeTotals(lines, allowancePercent = 0) {
  let subtotalHt = 0;
  let subtotalVat = 0;
  for (const l of lines) {
    const t = computeLine(l);
    subtotalHt += t.ht;
    subtotalVat += t.tva;
  }
  subtotalHt = Math.round(subtotalHt * 100) / 100;
  const percent = Math.min(100, Math.max(0, Number(allowancePercent) || 0));
  const factor = 1 - percent / 100;
  const allowanceAmount = Math.round(subtotalHt * (percent / 100) * 100) / 100;
  const ht = Math.round(subtotalHt * factor * 100) / 100;
  const tva = Math.round(subtotalVat * factor * 100) / 100;
  return {
    subtotal_ht: subtotalHt,
    allowance_percent: percent,
    allowance_amount: allowanceAmount,
    total_ht: ht,
    total_tva: tva,
    total_ttc: Math.round((ht + tva) * 100) / 100,
  };
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
  const tpl = "minmax(220px,1fr) 72px 102px 78px 72px 108px 42px";
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

const COUNTRY_EINVOICE_PROFILES = {
  FR: { code: "FR_PA", submitPath: "/invoices", authType: "bearer", authHeader: "", titleKey: "integrations.profile.fr.title", title: "France — Plateforme Agréée (PA)", hintKey: "integrations.profile.fr.hint", hint: "Le SIRET de l’établissement et les identifiants fournis par la PA sont requis.", idKey: "company.identifier.fr", idLabel: "SIRET de l’établissement *", publicKey: "integrations.profile.fr.public_id", publicLabel: "SIRET / identifiant du compte PA", routeKey: "integrations.profile.fr.routing_id", routeLabel: "Identifiant de routage PA", routeEmailKey: "integrations.profile.fr.routing_email", routeEmailLabel: "Adresse de routage (si fournie)", showRoutes: true },
  RS: { code: "RS_SEF", submitPath: "/api/publicApi/sales-invoice/ubl", authType: "apikey", authHeader: "ApiKey", titleKey: "integrations.profile.rs.title", title: "Serbie — Sistem eFaktura (SEF)", hintKey: "integrations.profile.rs.hint", hint: "D2F est en Serbie : le connecteur attendu est SEF via API, avec PIB et clé API SEF.", idKey: "company.identifier.rs", idLabel: "PIB (9 chiffres) *", publicKey: "integrations.profile.rs.public_id", publicLabel: "PIB du compte SEF", routeKey: "integrations.profile.rs.routing_id", routeLabel: "Identifiant SEF complémentaire", routeEmailKey: "integrations.profile.rs.routing_email", routeEmailLabel: "Contact technique SEF", showRoutes: false },
  IT: { code: "IT_SDI", titleKey: "integrations.profile.it.title", title: "Italie — Sistema di Interscambio (SdI)", hintKey: "integrations.profile.it.hint", hint: "La facture XML transite par SdI via un canal ou un prestataire habilité ; renseignez le Codice Destinatario ou la PEC.", idKey: "company.identifier.it", idLabel: "Partita IVA ou Codice Fiscale *", publicKey: "integrations.profile.it.public_id", publicLabel: "Partita IVA du compte SdI", routeKey: "integrations.profile.it.routing_id", routeLabel: "Codice Destinatario", routeEmailKey: "integrations.profile.it.routing_email", routeEmailLabel: "PEC", showRoutes: true },
  ES: { code: "ES_VERIFACTU", titleKey: "integrations.profile.es.title", title: "Espagne — AEAT VERI*FACTU", hintKey: "integrations.profile.es.hint", hint: "VERI*FACTU concerne l’envoi des registres à l’AEAT ; FACe reste un canal distinct pour les factures au secteur public.", idKey: "company.identifier.es", idLabel: "NIF de l’entreprise *", publicKey: "integrations.profile.es.public_id", publicLabel: "NIF du compte AEAT", routeKey: "integrations.profile.es.routing_id", routeLabel: "Mode (VERIFACTU / NO VERIFACTU)", routeEmailKey: "integrations.profile.es.routing_email", routeEmailLabel: "Alias du certificat / prestataire", showRoutes: true },
  DEFAULT: { code: "GENERIC_EN16931", titleKey: "integrations.profile.default.title", title: "Profil EN16931 — connecteur national à qualifier", hintKey: "integrations.profile.default.hint", hint: "Le pays n’a pas encore de profil D2F validé. Aucun statut de conformité nationale ne sera affiché sans qualification du canal.", idKey: "company.identifier.default", idLabel: "Identifiant national de l’établissement *", publicKey: "integrations.public_id", publicLabel: "Identifiant public du compte", routeKey: "integrations.routing_id", routeLabel: "Code de routage", routeEmailKey: "integrations.routing_email", routeEmailLabel: "Adresse de routage", showRoutes: true },
};

function companyCountryCode(value) {
  const country = String(value || "").trim().toUpperCase().slice(0, 2);
  return /^[A-Z]{2}$/.test(country) ? country : "DEFAULT";
}

function companyEInvoiceProfile(value) {
  return COUNTRY_EINVOICE_PROFILES[companyCountryCode(value)] || COUNTRY_EINVOICE_PROFILES.DEFAULT;
}

function validateEstablishmentIdentity(company) {
  const country = companyCountryCode(company?.country);
  const identifier = String(company?.legal_id || "").toUpperCase().replace(/\s+/g, "").replace(/^IT/, "");
  if (country === "FR" && !/^\d{14}$/.test(identifier)) throw new Error(t("company.identifier.fr.error", "Le SIRET de l’établissement doit comporter exactement 14 chiffres."));
  if (country === "RS" && !/^\d{9}$/.test(identifier)) throw new Error(t("company.identifier.rs.error", "Le PIB serbe doit comporter exactement 9 chiffres."));
  if (country === "IT" && !/^(\d{11}|[A-Z0-9]{16})$/.test(identifier)) throw new Error(t("company.identifier.it.error", "Indiquez une Partita IVA de 11 chiffres ou un Codice Fiscale de 16 caractères."));
  if (country === "ES" && !/^[A-Z0-9][A-Z0-9._-]{7,11}$/.test(identifier)) throw new Error(t("company.identifier.es.error", "Le NIF espagnol indiqué n’est pas valide."));
}

function updateCountryEInvoicingProfile(company = state?.company || {}, config = state?.integrationConfigs?.pa || {}) {
  const country = companyCountryCode($("co-country")?.value || company?.country);
  const profile = companyEInvoiceProfile(country);
  if ($("co-legal-id-label")) $("co-legal-id-label").textContent = t(profile.idKey, profile.idLabel);
  if ($("cf-pa-title")) $("cf-pa-title").textContent = t(profile.titleKey, profile.title);
  if ($("cf-pa-hint")) $("cf-pa-hint").textContent = t(profile.hintKey, profile.hint);
  if ($("cf-pa-profile-label")) $("cf-pa-profile-label").textContent = profile.code;
  if ($("cf-pa-public-id-label")) $("cf-pa-public-id-label").textContent = t(profile.publicKey, profile.publicLabel);
  if ($("cf-pa-routing-label")) $("cf-pa-routing-label").textContent = t(profile.routeKey, profile.routeLabel);
  if ($("cf-pa-routing-email-label")) $("cf-pa-routing-email-label").textContent = t(profile.routeEmailKey, profile.routeEmailLabel);
  if ($("cf-pa-routing-row")) $("cf-pa-routing-row").style.display = profile.showRoutes ? "" : "none";
  if ($("cf-pa-submit-path") && !config?.submit_path && (!$("cf-pa-submit-path").value || $("cf-pa-submit-path").value === "/invoices")) $("cf-pa-submit-path").value = profile.submitPath || "/invoices";
  if ($("cf-pa-auth-type") && !config?.auth_type) $("cf-pa-auth-type").value = profile.authType || "bearer";
  if ($("cf-pa-auth-header") && !config?.auth_header) $("cf-pa-auth-header").value = profile.authHeader || "";
  if (config?.country && String(config.country).toUpperCase() !== country && $("cf-pa-status")) {
    integrationStatus("pa", t("integrations.country_mismatch", "Le pays a changé : enregistrez de nouveau le connecteur avant de l’activer."), true);
  }
  return { country, profile };
}

function num(x, def = 0) {
  const v = Number(x);
  return Number.isFinite(v) ? v : def;
}

function jsonStringifySafe(x) {
  try {
    return JSON.stringify(x ?? {});
  } catch {
    return "{}";
  }
}

function applyAccentColor(color, { updateCompany = true } = {}) {
  const allowed = new Set(["#6366f1", "#06b6d4", "#22c55e", "#f97316", "#ec4899"]);
  const selected = allowed.has(String(color || "").toLowerCase()) ? String(color).toLowerCase() : "#6366f1";
  document.documentElement.style.setProperty("--accent", selected);
  document.querySelectorAll(".swatch[data-action^='theme:accent:']").forEach((swatch) => {
    swatch.classList.toggle("is-active", String(swatch.style.getPropertyValue("--sw") || "").toLowerCase() === selected);
  });
  if (updateCompany) {
    const current = state?.company || {};
    const meta = { ...safeJsonParse(current.meta_json, {}), ui_accent: selected };
    state.company = { ...current, meta_json: jsonStringifySafe(meta) };
    if ($("co-meta-json")) $("co-meta-json").value = state.company.meta_json;
  }
  return selected;
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
    country: $("co-country")?.value?.trim().toUpperCase(),
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
  applyAccentColor(meta?.ui_accent || "#6366f1", { updateCompany: false });

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
  updateCountryEInvoicingProfile(c || {});

  const img = $("companyLogoPreview");
  const fallback = $("companyLogoFallback");

  if (img && fallback) {
    const logoSource = c?.logo_data_url || c?.logo_path || "";
    if (logoSource) {
      img.src = /^(data:|https?:)/i.test(logoSource) ? logoSource : `file://${logoSource}`;
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
  validateCompanyEN16931(payload);
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
function setClientPeppolStatus(status, message) {
  const badge = $("cl-peppol-status");
  const messageEl = $("cl-peppol-message");
  const normalized = String(status || "not_checked");
  const labels = {
    verified: t("clients.peppol.verified", "Identifiant trouvé"),
    not_found: t("clients.peppol.not_found", "Non trouvé — PDF possible"),
    error: t("clients.peppol.error", "Annuaire indisponible"),
    not_checked: t("clients.peppol.not_checked", "Non vérifié"),
  };
  if (badge) {
    badge.dataset.directoryStatus = normalized;
    badge.textContent = labels[normalized] || labels.not_checked;
    badge.classList.remove("is-neutral", "is-ready", "is-warning", "is-blocked");
    badge.classList.add(normalized === "verified" ? "is-ready" : normalized === "not_found" || normalized === "error" ? "is-warning" : "is-neutral");
  }
  if (messageEl) messageEl.textContent = message || t("clients.peppol.disclaimer", "L’annuaire aide à identifier le participant ; le prestataire d’accès doit encore confirmer la capacité de livraison.");
}

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
  if ($("cl-peppol-scheme")) $("cl-peppol-scheme").value = c?.peppol_endpoint_scheme || "";
  if ($("cl-peppol-endpoint")) $("cl-peppol-endpoint").value = c?.peppol_endpoint_id || "";
  setClientPeppolStatus(c?.peppol_directory_status || "not_checked", c?.peppol_directory_message || "");

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
  const peppol = normalizeClientPeppol($("cl-peppol-scheme")?.value, $("cl-peppol-endpoint")?.value);
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
    peppol_endpoint_scheme: peppol.scheme,
    peppol_endpoint_id: peppol.endpointId,
    peppol_directory_status: $("cl-peppol-status")?.dataset?.directoryStatus || "not_checked",
    peppol_directory_message: $("cl-peppol-message")?.textContent || "",
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

function normalizeClientPeppol(schemeValue, endpointValue) {
  let scheme = String(schemeValue || "").trim();
  let endpointId = String(endpointValue || "").trim();
  let candidate = endpointId;
  if (/^iso6523-actorid-upis$/i.test(scheme)) candidate = `${scheme}:${endpointId}`;
  if (/^iso6523-actorid-upis:/i.test(candidate)) {
    candidate = candidate.replace(/^iso6523-actorid-upis:{1,2}/i, "");
    scheme = "";
  }
  const parts = candidate.split(":").filter(Boolean);
  if (parts.length > 1 && (/^\d{4}$/.test(parts[0]) || !scheme)) {
    const parsedScheme = parts.shift();
    if (parsedScheme) scheme = parsedScheme;
    endpointId = parts.join(":");
  }
  return { scheme, endpointId };
}

function renderClientList(container, rows, selectedId) {
  if (!container) return;
  container.innerHTML = "";
  if (!rows.length) return renderDocumentListEmpty(container);
  for (const client of rows) {
    const peppol = normalizeClientPeppol(client.peppol_endpoint_scheme, client.peppol_endpoint_id);
    const status = String(client.peppol_directory_status || "not_checked").toLowerCase();
    const statusLabel = status === "verified"
      ? t("clients.peppol.verified", "Identifiant trouvé")
      : status === "not_found"
        ? t("clients.peppol.not_found", "Non trouvé — PDF possible")
        : status === "error"
          ? t("clients.peppol.error", "Annuaire indisponible")
          : t("clients.peppol.not_checked", "Non vérifié");
    const identifier = client.vat_id || client.legal_id || t("clients.list.no_identifier", "Identifiant fiscal non renseigné");
    const endpoint = peppol.scheme && peppol.endpointId
      ? `${peppol.scheme}:${peppol.endpointId}`
      : t("clients.list.no_endpoint", "Adresse électronique absente");
    const isSelected = String(client.id || "") === String(selectedId || "");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.id = client.id;
    button.className = `list__item clientListItem clientListItem--${status}${isSelected ? " is-selected" : ""}`;
    button.setAttribute("aria-pressed", isSelected ? "true" : "false");
    button.setAttribute("aria-label", `${client.name || "—"}, ${client.customer_type || "B2C"}, ${client.country || "—"}, ${statusLabel}`);
    button.innerHTML = `
      <div class="clientListItem__head">
        <strong>${esc(client.name || "—")}</strong>
        <span class="clientListBadge">${esc(client.customer_type || "B2C")}</span>
      </div>
      <div class="clientListItem__identity"><span>${esc(String(client.country || "—").toUpperCase())}</span><span>${esc(identifier)}</span></div>
      <div class="clientListItem__route">
        <span class="clientListPeppol clientListPeppol--${esc(status)}">${esc(statusLabel)}</span>
        <span class="clientListEndpoint" title="${esc(endpoint)}">${esc(endpoint)}</span>
      </div>`;
    container.appendChild(button);
  }
}

function documentListLocale() {
  return {
    fr: "fr-FR",
    en: "en-GB",
    sr: "sr-Latn-RS",
    es: "es-ES",
    it: "it-IT",
  }[state.lang || getLang()] || "fr-FR";
}

function formatDocumentListDate(value) {
  const iso = String(value || "").slice(0, 10);
  if (!iso) return "—";
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(documentListLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function formatDocumentListMoney(value, currency = "EUR") {
  const amount = Number(value || 0);
  const code = String(currency || "EUR").trim().toUpperCase() || "EUR";
  try {
    return new Intl.NumberFormat(documentListLocale(), {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(amount) ? amount : 0);
  } catch {
    return `${money(amount)} ${code}`;
  }
}

function setDocumentListCount(id, count) {
  const element = $(id);
  if (!element) return;
  element.textContent = String(count || 0);
  element.setAttribute("aria-label", t("documents.count", "{count} document(s)", { count: count || 0 }));
}

function renderDocumentListEmpty(container) {
  container.innerHTML = `<div class="documentListEmpty">${esc(t("documents.no_results", "Aucun document ne correspond à la recherche."))}</div>`;
}

function createDocumentListButton({ row, selectedId, number, client, status, tone, date, total, remaining = null }) {
  const button = document.createElement("button");
  const isSelected = String(row.id) === String(selectedId || "");
  button.className = `list__item documentListItem documentListItem--${tone || "neutral"}${isSelected ? " is-selected" : ""}`;
  button.type = "button";
  button.dataset.id = row.id;
  button.setAttribute("aria-pressed", isSelected ? "true" : "false");
  button.setAttribute(
    "aria-label",
    t("documents.open_aria", "Ouvrir {number}, {client}, {status}, total {total}", {
      number,
      client,
      status,
      total,
    })
  );

  const remainingMarkup = remaining === null
    ? ""
    : `<div class="documentListMetric documentListMetric--remaining">
        <span>${esc(t("payments.col.remaining", "Reste"))}</span>
        <strong>${esc(remaining)}</strong>
      </div>`;

  button.innerHTML = `
    <div class="documentListTop">
      <strong class="documentListNumber">${esc(number)}</strong>
      <span class="documentStatus documentStatus--${esc(tone || "neutral")}">${esc(status)}</span>
    </div>
    <div class="documentListClient" title="${esc(client)}">${esc(client)}</div>
    <div class="documentListMetrics${remaining === null ? " documentListMetrics--two" : ""}">
      <div class="documentListMetric">
        <span>${esc(t("common.date", "Date"))}</span>
        <strong>${esc(date)}</strong>
      </div>
      <div class="documentListMetric documentListMetric--amount">
        <span>${esc(t("payments.col.total", "Total"))}</span>
        <strong>${esc(total)}</strong>
      </div>
      ${remainingMarkup}
    </div>
  `;
  return button;
}

function renderQuoteDocumentList(container, rows, selectedId) {
  if (!container) return;
  container.innerHTML = "";
  if (!rows.length) return renderDocumentListEmpty(container);

  const toneByStatus = {
    draft: "draft",
    sent: "issued",
    accepted: "paid",
    rejected: "rejected",
    cancelled: "credited",
  };

  for (const quote of rows) {
    const quoteState = canonicalQuoteStatus(quote);
    container.appendChild(createDocumentListButton({
      row: quote,
      selectedId,
      number: String(quote.number || quote.id || "—"),
      client: String(quote.client_name || "—"),
      status: quote.historical_import ? t("history.status", "Historique (lecture seule)") : t(`quotes.status.${quoteState}`, quoteState),
      tone: quote.historical_import ? "neutral" : toneByStatus[quoteState] || "neutral",
      date: formatDocumentListDate(quote.date),
      total: formatDocumentListMoney(quote.total_ttc, quote.currency),
    }));
  }
}

function renderInvoiceDocumentList(container, rows, selectedId, payments, statusSource = rows) {
  if (!container) return;
  container.innerHTML = "";
  if (!rows.length) return renderDocumentListEmpty(container);

  const receivableRows = window.D2FReceivables?.buildReceivableRows
    ? window.D2FReceivables.buildReceivableRows(statusSource, payments || [])
    : [];
  const receivableByInvoice = new Map(
    receivableRows.map((entry) => [String(entry.invoice?.id || ""), entry])
  );

  for (const invoice of rows) {
    const status = invoiceStatus(invoice);
    const kind = invoiceKind(invoice);
    const receivable = receivableByInvoice.get(String(invoice.id || ""));
    let tone = status === "draft" ? "draft" : "issued";
    let label = status === "draft"
      ? t("payments.invoice_status.draft", "Brouillon")
      : t("payments.invoice_status.issued", "Émise");
    let remaining = null;

    if (invoice.historical_import) {
      tone = "neutral";
      label = t("history.status", "Historique (lecture seule)");
    } else if (kind === "credit_note") {
      tone = "credited";
      label = t("documents.credit_note_issued", "Avoir émis");
    } else if (receivable) {
      tone = receivable.paymentStatus || "unpaid";
      label = t(`payments.status.${tone}`, tone);
      remaining = formatDocumentListMoney(receivable.remaining, invoice.currency);
    }

    container.appendChild(createDocumentListButton({
      row: invoice,
      selectedId,
      number: String(invoice.invoice_number || invoice.id || "—"),
      client: String(invoice.client_name || "—"),
      status: label,
      tone,
      date: formatDocumentListDate(invoice.date),
      total: formatDocumentListMoney(invoice.total_ttc, invoice.currency),
      remaining,
    }));
  }
}

function focusDocumentEditorOnMobile(moduleKey) {
  if (!window.matchMedia?.("(max-width: 760px)").matches) return;
  const editor = document.querySelector(`.page[data-page="${moduleKey}"] .split > .panel:last-child`);
  if (!editor) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.requestAnimationFrame(() => {
    editor.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  });
}

function decorateQuoteList() {
  const container = $("quotesList");
  if (!container) return;
  for (const quote of state.quotes || []) {
    const item = Array.from(container.querySelectorAll(".list__item")).find((node) => String(node.dataset.id) === String(quote.id));
    if (!item) continue;
    const status = canonicalQuoteStatus(quote);
    item.classList.toggle("list__item--rejected", status === "rejected");
    if (status === "rejected") item.dataset.statusWatermark = t("quotes.status.rejected", "Refusé");
    else delete item.dataset.statusWatermark;
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

function cfNormalizeConfig(cfg = {}) {
  return {
    ...cfg,
    reporting_periodicity: ["M", "Q"].includes(String(cfg.reporting_periodicity || cfg.periodicity || "M").toUpperCase())
      ? String(cfg.reporting_periodicity || cfg.periodicity || "M").toUpperCase()
      : "M",
    emits_b2c: String(cfg.emits_b2c ?? cfg.emitsB2c ?? 0) === "1" ? 1 : 0,
    has_international: String(cfg.has_international ?? cfg.hasInternational ?? 0) === "1" ? 1 : 0,
    vat_on_collections: String(cfg.vat_on_collections ?? cfg.cash_vat ?? 0) === "1" ? 1 : 0,
    retail_fiscalization: String(cfg.retail_fiscalization ?? cfg.fiscal_device ?? 0) === "1" ? 1 : 0,
    spain_sii: String(cfg.spain_sii ?? 0) === "1" ? 1 : 0,
    spain_mode: String(cfg.spain_mode || "VERIFACTU").toUpperCase() === "NO_VERIFACTU" ? "NO_VERIFACTU" : "VERIFACTU",
  };
}

const REPORTING_PROFILE_UI = {
  FR: { code: "FR-PA", title: "France — Facturation électronique et e-reporting", titleKey: "reporting.profile.fr.title", summaryKey: "reporting.profile.fr.summary", summary: "Flux de facturation structurée et données de transactions ou d’encaissements remis à une Plateforme Agréée." },
  RS: { code: "RS-SEF", title: "Serbie — SEF, TVA électronique et fiscalisation", titleKey: "reporting.profile.rs.title", summaryKey: "reporting.profile.rs.summary", summary: "Factures SEF, écritures TVA électroniques et tickets transmis par un dispositif fiscal agréé distinct." },
  IT: { code: "IT-SDI", title: "Italie — SdI et transmissions fiscales", titleKey: "reporting.profile.it.title", summaryKey: "reporting.profile.it.summary", summary: "Factures via SdI, corrispettivi telematici et opérations transfrontalières selon le profil italien." },
  ES: { code: "ES-AEAT", title: "Espagne — AEAT, VERI*FACTU et SII", titleKey: "reporting.profile.es.title", summaryKey: "reporting.profile.es.summary", summary: "Registres de facturation VERI*FACTU ou sécurisés, et livres SII lorsque l’entreprise y est soumise." },
  DEFAULT: { code: "EN16931", title: "Déclarations nationales à qualifier", titleKey: "reporting.profile.default.title", summaryKey: "reporting.profile.default.summary", summary: "Aucun profil de déclaration validé n’est disponible pour le pays déclaré." },
};

function reportingProfileUi(countryValue) {
  const country = companyCountryCode(countryValue);
  return { country, ...(REPORTING_PROFILE_UI[country] || REPORTING_PROFILE_UI.DEFAULT) };
}

const integrationFields = {
  pa: {
    provider: "cf-pa-provider-name", base: "cf-pa-base-url", auth: "cf-pa-auth-type", secret: "cf-pa-secret",
    authHeader: "cf-pa-auth-header",
    health: "cf-pa-health-path", submit: "cf-pa-submit-path", environment: "cf-pa-environment", publicId: "cf-pa-public-id",
    routingId: "cf-pa-routing-id", routingEmail: "cf-pa-routing-email", reportingSubmit: "cf-pa-reporting-submit-path",
    reportingEnabled: "cf-pa-reporting-enabled", reportingQualified: "cf-pa-reporting-qualified",
    enabled: "cf-pa-enabled", status: "cf-pa-status", save: "cf-pa-save", test: "cf-pa-test",
  },
  archive: {
    provider: "cf-archive-provider-name", base: "cf-archive-base-url", auth: "cf-archive-auth-type", secret: "cf-archive-secret",
    submit: "cf-archive-submit-path", retention: "cf-archive-retention", enabled: "cf-archive-enabled", status: "cf-archive-status", save: "cf-archive-save", test: "cf-archive-test",
  },
};

function integrationStatus(type, text, isError = false) {
  const el = $(integrationFields[type]?.status);
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? "#dc2626" : "";
}

function integrationPayload(type) {
  const ids = integrationFields[type];
  const jurisdiction = type === "pa" ? updateCountryEInvoicingProfile() : null;
  return {
    type,
    provider_name: $(ids.provider)?.value?.trim() || "",
    base_url: $(ids.base)?.value?.trim() || "",
    auth_type: $(ids.auth)?.value || "bearer",
    auth_header: ids.authHeader ? ($(ids.authHeader)?.value?.trim() || "") : undefined,
    secret: $(ids.secret)?.value || "",
    health_path: ids.health ? ($(ids.health)?.value?.trim() || "/health") : "/health",
    submit_path: $(ids.submit)?.value?.trim() || (type === "archive" ? "/archives" : "/invoices"),
    retention_years: ids.retention ? Number($(ids.retention)?.value || 10) : undefined,
    country: jurisdiction?.country,
    channel_profile: jurisdiction?.profile?.code,
    environment: ids.environment ? ($(ids.environment)?.value || "sandbox") : undefined,
    public_identifier: ids.publicId ? ($(ids.publicId)?.value?.trim() || "") : undefined,
    routing_id: ids.routingId ? ($(ids.routingId)?.value?.trim() || "") : undefined,
    routing_email: ids.routingEmail ? ($(ids.routingEmail)?.value?.trim() || "") : undefined,
    reporting_submit_path: ids.reportingSubmit ? ($(ids.reportingSubmit)?.value?.trim() || "") : undefined,
    reporting_enabled: ids.reportingEnabled ? !!$(ids.reportingEnabled)?.checked : undefined,
    reporting_adapter_qualified: ids.reportingQualified ? !!$(ids.reportingQualified)?.checked : undefined,
    reporting_adapter_contract: ids.reportingEnabled ? "D2F_REGULATORY_BATCH_V1" : undefined,
    enabled: !!$(ids.enabled)?.checked,
  };
}

async function loadIntegrationForm(type) {
  const ids = integrationFields[type];
  if (!ids || !window.api?.connections?.get) return;
  try {
    const cfg = await window.api.connections.get({ type });
    if ($(ids.provider)) $(ids.provider).value = cfg?.provider_name || "";
    if ($(ids.base)) $(ids.base).value = cfg?.base_url || "";
    if ($(ids.auth)) $(ids.auth).value = cfg?.auth_type || "bearer";
    if ($(ids.authHeader)) $(ids.authHeader).value = cfg?.auth_header || "";
    if ($(ids.health)) $(ids.health).value = cfg?.health_path || "/health";
    if ($(ids.submit)) $(ids.submit).value = cfg?.submit_path || (type === "archive" ? "/archives" : "/invoices");
    if ($(ids.retention)) $(ids.retention).value = String(cfg?.retention_years || 10);
    if ($(ids.environment)) $(ids.environment).value = cfg?.environment || "sandbox";
    if ($(ids.publicId)) $(ids.publicId).value = cfg?.public_identifier || "";
    if ($(ids.routingId)) $(ids.routingId).value = cfg?.routing_id || "";
    if ($(ids.routingEmail)) $(ids.routingEmail).value = cfg?.routing_email || "";
    if ($(ids.reportingSubmit)) $(ids.reportingSubmit).value = cfg?.reporting_submit_path || "";
    if ($(ids.reportingEnabled)) $(ids.reportingEnabled).checked = !!cfg?.reporting_enabled;
    if ($(ids.reportingQualified)) $(ids.reportingQualified).checked = !!cfg?.reporting_adapter_qualified;
    if ($(ids.enabled)) $(ids.enabled).checked = !!cfg?.enabled;
    if ($(ids.secret)) $(ids.secret).value = "";
    state.integrationConfigs = { ...(state.integrationConfigs || {}), [type]: cfg || {} };
    const jurisdiction = type === "pa" ? updateCountryEInvoicingProfile(state.company || {}, cfg || {}) : null;
    const countryMismatch = type === "pa" && cfg?.country && String(cfg.country).toUpperCase() !== jurisdiction?.country;
    integrationStatus(type, countryMismatch
      ? t("integrations.country_mismatch", "Le pays a changé : enregistrez de nouveau le connecteur avant de l’activer.")
      : cfg?.last_test_status === "ok"
      ? t("integrations.technical_test_ok", "Connexion technique testée avec succès le {date}", { date: String(cfg.last_tested_at || "").slice(0, 16).replace("T", " ") || "—" })
      : cfg?.configured
        ? t("integrations.configured_test_required", "Configuration enregistrée — test technique encore requis")
        : t("integrations.not_configured", "Non configuré"));
  } catch (error) {
    integrationStatus(type, t("integrations.load_error", "Impossible de charger le connecteur : {msg}", { msg: error.message }), true);
  }
}

async function saveIntegrationForm(type) {
  integrationStatus(type, t("integrations.saving", "Enregistrement…"));
  const saved = await window.api.connections.save(integrationPayload(type));
  state.integrationConfigs = { ...(state.integrationConfigs || {}), [type]: saved || {} };
  if ($(integrationFields[type].secret)) $(integrationFields[type].secret).value = "";
  integrationStatus(type, saved?.configured ? t("integrations.saved", "Connecteur enregistré et secret chiffré") : t("integrations.saved_no_secret", "Configuration enregistrée — secret encore manquant"));
  return saved;
}

async function testIntegrationForm(type) {
  integrationStatus(type, t("integrations.testing", "Test de connexion…"));
  try {
    const result = await window.api.connections.test({ type });
    integrationStatus(type, t("integrations.test_ok", "Connexion technique réussie ({status}) — la recette métier reste requise", { status: result?.status || "OK" }));
  } catch (error) {
    integrationStatus(type, t("integrations.test_failed", "Échec du test : {msg}", { msg: error.message }), true);
  }
}

let integrationsBound = false;
function bindIntegrationForms() {
  if (integrationsBound) return;
  integrationsBound = true;
  for (const type of Object.keys(integrationFields)) {
    const ids = integrationFields[type];
    $(ids.save)?.addEventListener("click", () => saveIntegrationForm(type).catch((error) => integrationStatus(type, error.message, true)));
    $(ids.test)?.addEventListener("click", () => testIntegrationForm(type));
  }
  $("co-reporting-save")?.addEventListener("click", () => cfSaveCompanyReportingConfig().catch((error) => {
    if ($("co-reporting-status")) $("co-reporting-status").textContent = error.message;
  }));
}

async function cfLoadToForm() {
  bindIntegrationForms();
  if (!state.company && window.api?.company?.get) state.company = await window.api.company.get();
  await Promise.all([loadIntegrationForm("pa"), loadIntegrationForm("archive")]);
  return cfLoadCompanyReportingConfig();
}

async function cfLoadCompanyReportingConfig() {
  const raw = window.api?.conformity?.getConfig ? await window.api.conformity.getConfig() : {};
  const cfg = cfNormalizeConfig(raw || {});
  state.conformity = cfg;
  const profile = reportingProfileUi(state.company?.country);
  if ($("co-reporting-profile")) $("co-reporting-profile").textContent = profile.code;
  if ($("co-reporting-hint")) $("co-reporting-hint").textContent = t(`reporting.settings.${profile.country.toLowerCase()}.hint`, t("reporting.settings.hint", "Ces choix déterminent les obligations affichées."));
  if ($("co-reporting-periodicity")) $("co-reporting-periodicity").value = cfg.reporting_periodicity;
  if ($("co-reporting-cash-vat")) $("co-reporting-cash-vat").value = String(cfg.vat_on_collections);
  if ($("co-reporting-b2c")) $("co-reporting-b2c").value = String(cfg.emits_b2c);
  if ($("co-reporting-international")) $("co-reporting-international").value = String(cfg.has_international);
  if ($("co-reporting-fiscal-device")) $("co-reporting-fiscal-device").checked = !!cfg.retail_fiscalization;
  if ($("co-reporting-es-sii")) $("co-reporting-es-sii").value = String(cfg.spain_sii);
  if ($("co-reporting-es-mode")) $("co-reporting-es-mode").value = cfg.spain_mode;
  $("co-reporting-rs-fields")?.classList.toggle("is-visible", profile.country === "RS");
  $("co-reporting-es-fields")?.classList.toggle("is-visible", profile.country === "ES");
  return cfg;
}

function cfCompanyReportingPayload() {
  return cfNormalizeConfig({
    ...state.conformity,
    reporting_periodicity: $("co-reporting-periodicity")?.value || "M",
    vat_on_collections: $("co-reporting-cash-vat")?.value || "0",
    emits_b2c: $("co-reporting-b2c")?.value || "0",
    has_international: $("co-reporting-international")?.value || "0",
    retail_fiscalization: $("co-reporting-fiscal-device")?.checked ? 1 : 0,
    spain_sii: $("co-reporting-es-sii")?.value || "0",
    spain_mode: $("co-reporting-es-mode")?.value || "VERIFACTU",
  });
}

async function cfSaveCompanyReportingConfig() {
  if (!window.api?.conformity?.saveConfig) throw new Error(t("reporting.settings.unavailable", "Enregistrement indisponible"));
  const payload = cfCompanyReportingPayload();
  await window.api.conformity.saveConfig(payload);
  state.conformity = payload;
  if ($("co-reporting-status")) $("co-reporting-status").textContent = t("reporting.settings.saved", "Paramètres réglementaires enregistrés");
  return payload;
}

function cfDefaultReportingPeriod() {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (date) => date.toISOString().slice(0, 10);
  return { start: iso(new Date(now.getFullYear(), now.getMonth(), 1)), end: iso(end) };
}

function cfReportingPeriod() {
  const fallback = cfDefaultReportingPeriod();
  if ($("cf-period-start") && !$("cf-period-start").value) $("cf-period-start").value = fallback.start;
  if ($("cf-period-end") && !$("cf-period-end").value) $("cf-period-end").value = fallback.end;
  return { periodStart: $("cf-period-start")?.value || fallback.start, periodEnd: $("cf-period-end")?.value || fallback.end };
}

function cfReportingStateLabel(value) {
  const stateValue = String(value || "review").toLowerCase();
  return t(`reporting.state.${stateValue}`, ({ ready: "Prêt", review: "À contrôler", external: "Système externe", sent: "Transmis", error: "Erreur", not_applicable: "Non applicable" })[stateValue] || stateValue);
}

function cfObligationActionLabel(value) {
  const status = String(value || "review").toLowerCase();
  const fallback = ({ review: "Contrôler →", ready: "Ouvrir →", external: "Voir la procédure →", not_applicable: "Comprendre →" })[status] || "Ouvrir →";
  return t(`reporting.obligation.action.${status}`, fallback);
}

function cfReportingCandidates(item = {}) {
  if (Array.isArray(item.candidates)) return item.candidates;
  return (Array.isArray(item.candidate_ids) ? item.candidate_ids : []).map((id) => ({ id, source_id: id, kind: "record", reference: id }));
}

function cfCandidateKindLabel(kind) {
  const value = String(kind || "record").toLowerCase();
  return t(`reporting.review.kind.${value}`, ({ invoice: "Facture client", payment: "Paiement", inbound: "Facture fournisseur", record: "Dossier" })[value] || "Dossier");
}

function cfCandidateOpenLabel(kind) {
  const value = String(kind || "record").toLowerCase();
  return t(`reporting.review.open_${value}`, ({ invoice: "Ouvrir la facture", payment: "Ouvrir le paiement", inbound: "Ouvrir la facture fournisseur", record: "Ouvrir le dossier" })[value] || "Ouvrir le dossier");
}

function cfReportingGuidance(item = {}) {
  const status = String(item.state || "review").toLowerCase();
  if (status === "ready") return `<p>${cfEscape(t("reporting.review.ready", "Les dossiers et la connexion sont prêts. Ouvrez-les pour un dernier contrôle, puis transmettez les dossiers prêts."))}</p>`;
  if (status === "external") return `<p>${cfEscape(t("reporting.review.external", "Cette obligation est traitée dans un système externe. Ouvrez les dossiers pour rapprochement, puis contrôlez l’accusé dans le portail concerné."))}</p>`;
  if (status === "not_applicable") return `<p>${cfEscape(t("reporting.review.not_applicable", "Aucune action n’est attendue pour cette période avec les paramètres actuels."))}</p>`;
  return `<h3>${cfEscape(t("reporting.review.what_to_do", "Ce que vous devez faire"))}</h3><ol>
    <li>${cfEscape(t("reporting.review.step.open_documents", "Ouvrez chaque dossier ci-dessous et vérifiez le document source."))}</li>
    <li>${cfEscape(t("reporting.review.step.configure", "Configurez puis testez le connecteur national et son adaptateur réglementaire."))}</li>
    <li>${cfEscape(t("reporting.review.step.rebuild", "Revenez dans Déclarations et cliquez sur Préparer la période : les dossiers conformes passeront à Prêt."))}</li>
  </ol>`;
}

function cfCloseReportingDialog() {
  const dialog = $("cf-review-dialog");
  if (dialog?.open) dialog.close();
}

function cfRenderReviewDialog(item = {}) {
  const dialog = $("cf-review-dialog");
  if (!dialog) return;
  const id = String(item.id || "generic");
  const status = String(item.state || "review").toLowerCase();
  const candidates = cfReportingCandidates(item);
  state.reportingSelectedObligationId = id;
  const stateEl = $("cf-review-state");
  if (stateEl) {
    stateEl.className = `reportingState is-${status}`;
    stateEl.textContent = cfReportingStateLabel(status);
  }
  if ($("cf-review-title")) $("cf-review-title").textContent = t(`reporting.obligation.${id}.title`, item.title || id);
  if ($("cf-review-description")) $("cf-review-description").textContent = t(`reporting.obligation.${id}.description`, item.description || "");
  if ($("cf-review-guidance")) $("cf-review-guidance").innerHTML = cfReportingGuidance(item);
  if ($("cf-review-candidates")) {
    $("cf-review-candidates").innerHTML = `<h3>${cfEscape(t("reporting.review.candidates_title", "Dossiers concernés"))} <span>${candidates.length}</span></h3>${candidates.length ? candidates.map((candidate, index) => {
      const kind = String(candidate.kind || "record").toLowerCase();
      const details = [candidate.date, candidate.counterparty, candidate.country, candidate.method].filter(Boolean).join(" · ");
      const amount = candidate.amount === undefined || candidate.amount === null ? "" : `${money(candidate.amount)} ${candidate.currency || "EUR"}`;
      const canOpen = ["invoice", "payment", "inbound"].includes(kind) && Boolean(candidate.source_id || candidate.invoice_id || candidate.id);
      return `<article class="reportingReviewCandidate">
        <div class="reportingReviewCandidate__body"><span>${cfEscape(cfCandidateKindLabel(kind))}</span><strong>${cfEscape(candidate.reference || candidate.id || "—")}</strong><small>${cfEscape(details || "—")}</small></div>
        ${amount ? `<div class="reportingReviewCandidate__amount">${cfEscape(amount)}</div>` : ""}
        <button type="button" class="btn btn--secondary" data-reporting-candidate-id="${cfEscape(candidate.id || candidate.source_id || String(index))}" data-reporting-candidate-index="${index}" ${canOpen ? "" : "disabled"}>${cfEscape(cfCandidateOpenLabel(kind))}</button>
      </article>`;
    }).join("") : `<div class="reportingEmpty">${cfEscape(t("reporting.review.empty", "Aucun dossier source n’est associé à cette obligation pour la période."))}</div>`}`;
  }
  if (!dialog.open) dialog.showModal();
}

function cfOpenCompanyReportingSettings() {
  cfCloseReportingDialog();
  showPage("company");
  setTimeout(() => {
    const reportingCard = $("company-reporting-card");
    const connectorCard = $("company-einvoice-card");
    if (reportingCard) reportingCard.open = true;
    if (connectorCard) {
      connectorCard.open = true;
      connectorCard.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setStatus(t("reporting.review.settings_opened", "Paramètres du connecteur réglementaire ouverts."));
  }, 120);
}

function cfOpenReportingCandidate(candidate = {}) {
  const kind = String(candidate.kind || "record").toLowerCase();
  const sourceId = String(candidate.source_id || candidate.invoice_id || candidate.id || "");
  if (!sourceId) {
    setStatus(t("reporting.review.source_unavailable", "Le document source n’est pas disponible dans cet écran."));
    return;
  }
  cfCloseReportingDialog();
  if (kind === "invoice") {
    state.selectedInvoiceId = sourceId;
    showPage("invoices");
    return;
  }
  if (kind === "payment") {
    state.payments.selectedInvoiceId = sourceId;
    state.selectedInvoiceId = sourceId;
    showPage("payments");
    return;
  }
  if (kind === "inbound") {
    state.selectedInboundId = sourceId;
    showPage("inbound");
    return;
  }
  setStatus(t("reporting.review.source_unavailable", "Le document source n’est pas disponible dans cet écran."));
}

function cfApplyReportingFilter(filter) {
  const selected = String(filter || "").toLowerCase();
  state.reportingActiveFilter = selected;
  document.querySelectorAll("[data-reporting-filter]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.reportingFilter === selected)));
  document.querySelectorAll("[data-reporting-obligation-state]").forEach((element) => {
    const status = String(element.dataset.reportingObligationState || "review");
    element.hidden = selected === "review" ? !["review", "external"].includes(status) : selected === "sent" || selected === "error" ? false : status !== selected;
  });
  document.querySelectorAll("[data-reporting-transmission-status]").forEach((element) => {
    element.hidden = ["sent", "error"].includes(selected) && element.dataset.reportingTransmissionStatus !== selected;
  });
  const target = ["sent", "error"].includes(selected) ? $("cf-transmissions") : $("cf-obligations");
  target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  setStatus(t(["sent", "error"].includes(selected) ? "reporting.review.transmissions_shown" : "reporting.review.filter_applied", ["sent", "error"].includes(selected) ? "Historique des transmissions filtré." : "Obligations filtrées."));
}

function cfRenderOperationalReport(payload = {}) {
  const profile = payload.profile || reportingProfileUi(state.company?.country);
  const summary = payload.summary || {};
  const obligations = Array.isArray(payload.obligations) ? payload.obligations : [];
  const transmissions = Array.isArray(payload.transmissions) ? payload.transmissions : [];
  const country = String(profile.country || state.company?.country || "—").toUpperCase();
  if ($("cf-country-badge")) $("cf-country-badge").textContent = country;
  if ($("cf-profile-name")) $("cf-profile-name").textContent = t(profile.titleKey || `reporting.profile.${country.toLowerCase()}.title`, profile.title || "—");
  if ($("cf-profile-summary")) $("cf-profile-summary").textContent = t(profile.summaryKey || `reporting.profile.${country.toLowerCase()}.summary`, profile.summary || "—");
  if ($("cf-kpi-ready")) $("cf-kpi-ready").textContent = String(summary.ready || 0);
  if ($("cf-kpi-review")) $("cf-kpi-review").textContent = String(summary.review || 0);
  if ($("cf-kpi-sent")) $("cf-kpi-sent").textContent = String(summary.sent || 0);
  if ($("cf-kpi-error")) $("cf-kpi-error").textContent = String(summary.error || 0);

  const configuration = payload.configuration || {};
  const configurationEl = $("cf-configuration-status");
  if (configurationEl) {
    configurationEl.classList.toggle("is-ready", !!configuration.ready);
    configurationEl.classList.toggle("is-blocked", !configuration.ready);
    configurationEl.textContent = configuration.ready
      ? t("reporting.configuration.ready", "Connecteur et adaptateur métier validés : les dossiers prêts peuvent être transmis.")
      : t("reporting.configuration.blocked", "Préparation disponible. Transmission bloquée tant que le connecteur national et son adaptateur métier ne sont pas validés.");
  }

  const obligationsEl = $("cf-obligations");
  if (obligationsEl) {
    obligationsEl.innerHTML = obligations.length ? obligations.map((item) => {
      const id = String(item.id || "generic");
      const status = String(item.state || "review").toLowerCase();
      return `<button type="button" class="reportingObligation" data-obligation-id="${cfEscape(id)}" data-reporting-obligation-state="${cfEscape(status)}">
        <div><div class="reportingObligation__title">${cfEscape(t(`reporting.obligation.${id}.title`, item.title || id))}</div><div class="reportingObligation__description">${cfEscape(t(`reporting.obligation.${id}.description`, item.description || ""))}</div></div>
        <div class="reportingObligation__count">${Number(item.count || 0)}</div>
        <div class="reportingObligation__footer"><span class="reportingState is-${cfEscape(status)}">${cfEscape(cfReportingStateLabel(status))}</span><span class="hint">${cfEscape(t("reporting.candidates", "{count} dossier(s) candidat(s)", { count: Number(item.count || 0) }))}</span><span class="reportingObligation__action">${cfEscape(cfObligationActionLabel(status))}</span></div>
      </button>`;
    }).join("") : `<div class="reportingEmpty">${cfEscape(t("reporting.obligations.empty", "Aucune obligation calculée pour cette période."))}</div>`;
  }

  const transmissionsEl = $("cf-transmissions");
  if (transmissionsEl) {
    transmissionsEl.innerHTML = transmissions.length ? transmissions.slice(0, 30).map((item) => {
      const status = String(item.status || "submitted").toLowerCase();
      const date = String(item.created_at || "").slice(0, 16).replace("T", " ") || "—";
      const reference = item.document_number || item.remote_id || item.id || "—";
      const transmissionStatus = ["error", "rejected"].includes(status) ? "error" : "sent";
      return `<article class="reportingTransmission" data-reporting-transmission-status="${transmissionStatus}"><div><div class="reportingTransmission__title">${cfEscape(reference)}</div><div class="reportingTransmission__meta">${cfEscape(date)} · ${cfEscape(item.channel || profile.code || country)}</div></div><span class="reportingState is-${cfEscape(transmissionStatus)}">${cfEscape(cfReportingStateLabel(transmissionStatus))}</span></article>`;
    }).join("") : `<div class="reportingEmpty">${cfEscape(t("reporting.transmissions.empty", "Aucun envoi réglementaire."))}</div>`;
  }
  if (state.reportingActiveFilter) cfApplyReportingFilter(state.reportingActiveFilter);
  if (state.currentModule === "conformity") renderToolbar("conformity");
}

async function cfLoadOperationalReport() {
  if (!state.company && window.api?.company?.get) state.company = await window.api.company.get();
  const period = cfReportingPeriod();
  const payload = await window.api.conformity.rebuildPeriod(period);
  state.regulatoryReport = payload;
  cfRenderOperationalReport(payload);
  return payload;
}

const CF_EVIDENCE_LABELS = {
  process_documentation: ["conformity.evidence.category.process", "Procédure et contrôles internes"],
  order_contract: ["conformity.evidence.category.order", "Devis, commande ou contrat"],
  delivery_service_proof: ["conformity.evidence.category.delivery", "Livraison ou preuve de prestation"],
  invoice_tax: ["conformity.evidence.category.invoice", "Facture et données fiscales"],
  payment_bank: ["conformity.evidence.category.payment", "Paiement ou extrait bancaire"],
  control_report: ["conformity.evidence.category.control", "Contrôle, rapprochement ou anomalie"],
  correction_credit_note: ["conformity.evidence.category.credit", "Correction ou avoir"],
  tax_return: ["conformity.evidence.category.tax", "Déclaration fiscale"],
  other: ["conformity.evidence.category.other", "Autre justificatif"],
};

function cfEvidenceLabel(category) {
  const [key, fallback] = CF_EVIDENCE_LABELS[category] || CF_EVIDENCE_LABELS.other;
  return t(key, fallback);
}

function cfEscape(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function cfFileSize(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}

function cfEvidenceStatus(message, isError = false) {
  const element = $("cf-evidence-status");
  if (!element) return;
  element.textContent = message || "";
  element.style.color = isError ? "#dc2626" : "";
}

function cfRenderEvidence(payload = {}) {
  const profile = payload.profile || {};
  const documents = Array.isArray(payload.documents) ? payload.documents : [];
  const covered = new Set(Array.isArray(payload.coveredCategories) ? payload.coveredCategories : []);
  const profileKey = String(profile.code || "GENERIC_AUDIT_TRAIL").toLowerCase();
  if ($("cf-evidence-profile")) $("cf-evidence-profile").textContent = t(`conformity.evidence.profile.${profileKey}.label`, profile.label || profile.code || "—");
  if ($("cf-evidence-explanation")) $("cf-evidence-explanation").textContent = t(`conformity.evidence.profile.${profileKey}.explanation`, profile.explanation || "—");

  const checklist = $("cf-evidence-checklist");
  if (checklist) {
    checklist.innerHTML = (profile.checklist || []).map((category) => {
      const complete = covered.has(category);
      return `<span class="complianceChecklist__item ${complete ? "is-covered" : "is-missing"}"><span>${complete ? "✓" : "○"}</span>${cfEscape(cfEvidenceLabel(category))}</span>`;
    }).join("");
  }

  const list = $("cf-evidence-list");
  if (!list) return;
  if (!documents.length) {
    list.innerHTML = `<div class="complianceEvidenceEmpty">${cfEscape(t("conformity.evidence.empty", "Aucune pièce déposée. Commencez par la procédure de facturation, puis reliez les justificatifs aux factures."))}</div>`;
    return;
  }
  list.innerHTML = documents.map((document) => {
    const isVoided = document.status === "voided";
    const isArchived = document.archive_status === "archived";
    const related = document.related_document ? `${t("conformity.evidence.related_short", "Réf.")} ${document.related_document}` : t("conformity.evidence.unlinked", "Sans référence liée");
    return `<article class="complianceEvidenceItem ${isVoided ? "is-voided" : ""}" data-evidence-id="${cfEscape(document.id)}">
      <div class="complianceEvidenceItem__name">
        <strong>${cfEscape(document.filename)}</strong>
        <small>${cfEscape(document.description || related)}</small>
        <span class="complianceEvidenceItem__hash" title="SHA-256 ${cfEscape(document.sha256)}">SHA-256 ${cfEscape(document.sha256)}</span>
      </div>
      <div>
        <span class="complianceEvidenceBadge">${cfEscape(cfEvidenceLabel(document.category))}</span>
        <span class="complianceEvidenceItem__meta">${cfEscape(document.document_date || "—")} · ${cfEscape(cfFileSize(document.size))}</span>
      </div>
      <div class="complianceEvidenceItem__badges">
        <span class="complianceEvidenceBadge is-sealed">${cfEscape(t("conformity.evidence.sealed", "Empreinte scellée"))}</span>
        ${isArchived ? `<span class="complianceEvidenceBadge is-archived">${cfEscape(t("conformity.evidence.archived", "Versée au SAE"))}</span>` : ""}
        ${isVoided ? `<span class="complianceEvidenceBadge">${cfEscape(t("conformity.evidence.voided", "Annulée — conservée"))}</span>` : ""}
      </div>
      <div class="complianceEvidenceItem__actions">
        <button class="btn btn--secondary" type="button" data-evidence-action="download">${cfEscape(t("conformity.evidence.download", "Télécharger"))}</button>
        <button class="btn btn--ghost" type="button" data-evidence-action="archive" ${isArchived || isVoided ? "disabled" : ""}>${cfEscape(isArchived ? t("conformity.evidence.archived", "Versée au SAE") : t("conformity.evidence.archive", "Verser au SAE"))}</button>
        <button class="btn btn--ghost" type="button" data-evidence-action="void" ${isVoided ? "disabled" : ""}>${cfEscape(t("conformity.evidence.void", "Annuler"))}</button>
      </div>
    </article>`;
  }).join("");
}

async function cfLoadEvidence() {
  if (!window.api?.conformity?.listEvidence || !$("cf-evidence-list")) return;
  const payload = await window.api.conformity.listEvidence();
  cfRenderEvidence(payload || {});
  const activeCount = (payload?.documents || []).filter((document) => document.status !== "voided").length;
  cfEvidenceStatus(t("conformity.evidence.count", "{count} pièce(s) active(s), chacune tracée par SHA-256.", { count: activeCount }));
  return payload;
}

let cfEvidenceBound = false;
function bindComplianceEvidence() {
  if (cfEvidenceBound) return;
  cfEvidenceBound = true;
  if ($("cf-evidence-date") && !$("cf-evidence-date").value) $("cf-evidence-date").value = new Date().toISOString().slice(0, 10);

  $("cf-evidence-add")?.addEventListener("click", async () => {
    try {
      cfEvidenceStatus(t("conformity.evidence.selecting", "Sélection de la pièce…"));
      const selected = await window.api.files.pickEvidence();
      if (!selected || selected.canceled) return cfEvidenceStatus("");
      cfEvidenceStatus(t("conformity.evidence.uploading", "Dépôt sécurisé et calcul de l'empreinte…"));
      await window.api.conformity.uploadEvidence({
        ...selected,
        category: $("cf-evidence-category")?.value || "other",
        related_document: $("cf-evidence-related")?.value || "",
        document_date: $("cf-evidence-date")?.value || new Date().toISOString().slice(0, 10),
        description: $("cf-evidence-description")?.value || "",
      });
      if ($("cf-evidence-description")) $("cf-evidence-description").value = "";
      cfEvidenceStatus(t("conformity.evidence.uploaded", "Pièce déposée, empreinte calculée et opération inscrite dans l'audit."));
      await cfLoadEvidence();
    } catch (error) {
      cfEvidenceStatus(error.message || String(error), true);
    }
  });

  $("cf-evidence-export")?.addEventListener("click", async () => {
    try {
      cfEvidenceStatus(t("conformity.evidence.exporting", "Préparation du bordereau de contrôle…"));
      await window.api.conformity.exportEvidenceManifest();
      cfEvidenceStatus(t("conformity.evidence.exported", "Bordereau exporté avec l'inventaire et les empreintes."));
    } catch (error) {
      cfEvidenceStatus(error.message || String(error), true);
    }
  });
  $("cf-evidence-refresh")?.addEventListener("click", () => cfLoadEvidence().catch((error) => cfEvidenceStatus(error.message, true)));

  $("cf-evidence-list")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-evidence-action]");
    const item = button?.closest("[data-evidence-id]");
    if (!button || !item) return;
    const id = item.dataset.evidenceId;
    const action = button.dataset.evidenceAction;
    button.disabled = true;
    try {
      if (action === "download") {
        cfEvidenceStatus(t("conformity.evidence.verifying", "Vérification de l'empreinte avant téléchargement…"));
        await window.api.conformity.downloadEvidence({ id });
        cfEvidenceStatus(t("conformity.evidence.integrity_ok", "Empreinte vérifiée : le fichier est intact."));
      } else if (action === "archive") {
        cfEvidenceStatus(t("conformity.evidence.archiving", "Versement de la pièce au SAE configuré…"));
        await window.api.conformity.archiveEvidence({ id });
        cfEvidenceStatus(t("conformity.evidence.archive_ok", "Pièce versée au SAE ; le reçu est conservé dans les transmissions."));
        await cfLoadEvidence();
      } else if (action === "void") {
        if (!confirm(t("conformity.evidence.void_confirm", "Annuler cette pièce ? Elle restera conservée avec son empreinte et l'annulation sera auditée."))) return;
        await window.api.conformity.deleteEvidence({ id });
        cfEvidenceStatus(t("conformity.evidence.void_ok", "Pièce annulée mais conservée pour assurer la traçabilité."));
        await cfLoadEvidence();
      }
    } catch (error) {
      cfEvidenceStatus(error.message || String(error), true);
    } finally {
      button.disabled = false;
    }
  });
}

let __cf_saveTimer = null;
function cfScheduleSave() {
  clearTimeout(__cf_saveTimer);
  __cf_saveTimer = setTimeout(() => cfSaveCompanyReportingConfig().catch((error) => {
    if ($("co-reporting-status")) $("co-reporting-status").textContent = error.message;
  }), 250);
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
  if (__cf_inited) return;
  __cf_inited = true;
  ["cf-period-start", "cf-period-end"].forEach((id) => $(id)?.addEventListener("change", () => refreshModule("conformity").catch(console.error)));
  document.querySelector(".reportingKpis")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reporting-filter]");
    if (button) cfApplyReportingFilter(button.dataset.reportingFilter);
  });
  $("cf-obligations")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-obligation-id]");
    if (!button) return;
    const item = (state.regulatoryReport?.obligations || []).find((entry) => String(entry.id) === String(button.dataset.obligationId));
    if (item) cfRenderReviewDialog(item);
  });
  $("cf-review-candidates")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reporting-candidate-index]");
    if (!button) return;
    const item = (state.regulatoryReport?.obligations || []).find((entry) => String(entry.id) === String(state.reportingSelectedObligationId));
    const candidate = cfReportingCandidates(item)[Number(button.dataset.reportingCandidateIndex)];
    if (candidate) cfOpenReportingCandidate(candidate);
  });
  document.querySelectorAll("[data-reporting-dialog-close]").forEach((button) => button.addEventListener("click", cfCloseReportingDialog));
  document.querySelector("[data-reporting-dialog-settings]")?.addEventListener("click", cfOpenCompanyReportingSettings);
  $("cf-review-dialog")?.addEventListener("click", (event) => {
    if (event.target === $("cf-review-dialog")) cfCloseReportingDialog();
  });
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


const DOCUMENT_CSV_ALIASES = {
  number: ["number", "numero", "document_number", "invoice_number", "quote_number", "reference", "ref", "facture", "devis"],
  date: ["date", "document_date", "invoice_date", "quote_date", "date_document"],
  client_name: ["client", "client_name", "nom_client", "customer", "customer_name", "acheteur"],
  total_ttc: ["total_ttc", "ttc", "montant_ttc", "total", "amount", "montant"],
  total_ht: ["total_ht", "ht", "montant_ht", "subtotal_ht", "net"],
  total_tva: ["total_tva", "tva", "montant_tva", "vat", "vat_amount"],
  due_date: ["due_date", "date_echeance", "echeance", "payment_due_date"],
  valid_until: ["valid_until", "date_validite", "validite"],
  currency: ["currency", "devise", "monnaie"],
  description: ["description", "objet", "libelle", "designation"],
};

function normalizedCsvHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function documentCsvColumn(headers, field) {
  const aliases = DOCUMENT_CSV_ALIASES[field] || [];
  return headers.findIndex((header) => aliases.includes(normalizedCsvHeader(header)));
}

function documentCsvMoney(value) {
  let raw = String(value == null ? "" : value).trim().replace(/[\s\u00a0€$£]/g, "");
  if (!raw) return 0;
  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  if (comma > dot) raw = raw.replace(/\./g, "").replace(",", ".");
  else if (dot > comma && comma >= 0) raw = raw.replace(/,/g, "");
  else if (comma >= 0) raw = raw.replace(",", ".");
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : NaN;
}

function documentCsvDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (!match) return "";
  return match[3] + "-" + String(match[2]).padStart(2, "0") + "-" + String(match[1]).padStart(2, "0");
}

function documentRowsFromCsv(parsed, entity, fileName) {
  const required = ["number", "date", "client_name", "total_ttc"];
  const indexes = Object.fromEntries(Object.keys(DOCUMENT_CSV_ALIASES).map((field) => [field, documentCsvColumn(parsed.headers, field)]));
  const missing = required.filter((field) => indexes[field] < 0);
  if (missing.length) {
    const labels = { number: "numéro", date: "date", client_name: "client", total_ttc: "total TTC" };
    throw new Error(t("import.csv_missing_columns", "Colonnes CSV obligatoires manquantes : {columns}").replace("{columns}", missing.map((field) => labels[field]).join(", ")));
  }
  const cell = (row, field) => indexes[field] < 0 ? "" : String(row[indexes[field]] == null ? "" : row[indexes[field]]).trim();
  const rows = [];
  const rejected = [];
  parsed.data.forEach((row, rowIndex) => {
    const number = cell(row, "number");
    const date = documentCsvDate(cell(row, "date"));
    const clientName = cell(row, "client_name");
    const totalTtc = documentCsvMoney(cell(row, "total_ttc"));
    const totalVatRaw = cell(row, "total_tva");
    const totalVat = totalVatRaw ? documentCsvMoney(totalVatRaw) : 0;
    const totalHtRaw = cell(row, "total_ht");
    const totalHt = totalHtRaw ? documentCsvMoney(totalHtRaw) : totalTtc - totalVat;
    if (!number || !date || !clientName || !Number.isFinite(totalTtc) || !Number.isFinite(totalHt) || !Number.isFinite(totalVat)) {
      rejected.push(rowIndex + 2);
      return;
    }
    const base = {
      date,
      client_name: clientName,
      currency: (cell(row, "currency") || "EUR").toUpperCase().slice(0, 3),
      status: "historical",
      historical_import: true,
      source_csv_name: fileName,
      imported_at: new Date().toISOString(),
      subtotal_ht: totalHt,
      total_ht: totalHt,
      total_tva: totalVat,
      total_ttc: totalTtc,
      lines: [],
      description: cell(row, "description"),
    };
    rows.push(entity === "quotes"
      ? { ...base, number, valid_until: documentCsvDate(cell(row, "valid_until")) }
      : { ...base, invoice_number: number, due_date: documentCsvDate(cell(row, "due_date")), type: "final", amount_due: totalTtc });
  });
  return { rows, rejected };
}

async function importItemsCsvFile() {
  const selected = await window.api.files.pickCsv();
  if (!selected || selected.canceled) return;
  const parsed = parseCsv(selected.text || "", "auto", true);
  const aliases = {
    ref: ["ref", "reference", "sku", "code"],
    name: ["name", "nom", "label", "libelle", "designation"],
    unit_price_ht: ["unit_price_ht", "prix_ht", "prix_unitaire_ht", "price"],
    tva_percent: ["tva_percent", "tva", "vat", "vat_rate"],
    item_type: ["item_type", "type", "nature"],
  };
  const index = Object.fromEntries(Object.entries(aliases).map(([field, names]) => [field, parsed.headers.findIndex((header) => names.includes(normalizedCsvHeader(header)))]));
  if (index.ref < 0 || index.name < 0 || index.unit_price_ht < 0) throw new Error("Colonnes obligatoires : référence, nom, prix HT.");
  const value = (row, field) => index[field] < 0 ? "" : String(row[index[field]] == null ? "" : row[index[field]]).trim();
  const rows = parsed.data.map((row) => ({
    ref: value(row, "ref"),
    name: value(row, "name"),
    unit_price_ht: documentCsvMoney(value(row, "unit_price_ht")),
    tva_percent: value(row, "tva_percent") ? documentCsvMoney(value(row, "tva_percent")) : 20,
    item_type: (value(row, "item_type") || "SERVICE").toUpperCase() === "GOODS" ? "GOODS" : "SERVICE",
    unit_code: "C62",
    active: 1,
  })).filter((row) => row.ref && row.name && Number.isFinite(row.unit_price_ht));
  if (!rows.length) throw new Error(t("import.csv_no_rows", "Le fichier CSV ne contient aucune ligne exploitable."));
  const result = await window.api.items.importCsv({ rows, fileName: selected.name || selected.filename || "" });
  await refreshModule("items");
  setStatus((result?.imported || 0) + " article(s) importé(s) ; " + (result?.skipped || 0) + " doublon(s) ignoré(s).");
}

function openDocumentCsvImport(entity) {
  const modalId = "documentCsvImportModal";
  const fileInput = $("documentCsvImportFile");
  const dropzone = $("documentCsvDropzone");
  const fileName = $("documentCsvFileName");
  const preview = $("documentCsvPreview");
  const report = $("documentCsvReport");
  const analyzeButton = $("documentCsvAnalyzeBtn");
  const runButton = $("documentCsvRunBtn");
  if (![fileInput, dropzone, fileName, preview, report, analyzeButton, runButton].every(Boolean)) throw new Error("Interface d’import CSV indisponible.");
  let selectedFile = null;
  let importRows = [];
  const entityLabel = entity === "quotes" ? "devis" : "factures";
  $("documentCsvImportTitle").textContent = entity === "quotes" ? "Importer des devis historiques CSV" : "Importer des factures historiques CSV";
  $("documentCsvDropzoneTitle").textContent = "Cliquez pour choisir un fichier CSV";
  $("documentCsvDropzoneHint").textContent = "ou déposez-le ici · 10 Mo maximum";
  $("documentCsvExpectedTitle").textContent = "Colonnes reconnues";
  $("documentCsvExpectedColumns").textContent = "numéro, date, client, total TTC · HT, TVA, échéance et devise sont optionnels";
  $("documentCsvPreviewTitle").textContent = "Prévisualisation";
  $("documentCsvReportTitle").textContent = "Rapport";
  analyzeButton.textContent = "Analyser";
  runButton.textContent = "Importer";

  const resetAnalysis = () => {
    importRows = [];
    preview.textContent = "";
    report.textContent = "";
    runButton.disabled = true;
  };
  const selectFile = (file) => {
    resetAnalysis();
    selectedFile = file || null;
    if (!selectedFile) { fileName.textContent = ""; return; }
    if (!/\.csv$/i.test(selectedFile.name) && !/csv|text/i.test(selectedFile.type || "")) {
      selectedFile = null;
      fileName.textContent = "";
      report.textContent = "❌ Utilisez un fichier CSV.";
      return;
    }
    if (selectedFile.size > 10 * 1024 * 1024) {
      selectedFile = null;
      fileName.textContent = "";
      report.textContent = "❌ Le fichier dépasse la taille maximale de 10 Mo.";
      return;
    }
    fileName.textContent = selectedFile.name + " · " + Math.max(1, Math.round(selectedFile.size / 1024)) + " Ko";
  };

  fileInput.value = "";
  selectFile(null);
  dropzone.onclick = () => fileInput.click();
  fileInput.onchange = () => selectFile(fileInput.files && fileInput.files[0]);
  dropzone.ondragover = (event) => { event.preventDefault(); dropzone.classList.add("is-dragging"); };
  dropzone.ondragleave = () => dropzone.classList.remove("is-dragging");
  dropzone.ondrop = (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-dragging");
    selectFile(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]);
  };
  analyzeButton.onclick = async () => {
    try {
      if (!selectedFile) throw new Error("Choisissez ou déposez d’abord un fichier CSV.");
      const parsed = parseCsv(await selectedFile.text(), "auto", true);
      const prepared = documentRowsFromCsv(parsed, entity, selectedFile.name);
      importRows = prepared.rows;
      if (!importRows.length) throw new Error(t("import.csv_no_rows", "Le fichier CSV ne contient aucune ligne exploitable."));
      preview.textContent = [
        importRows.length + " " + entityLabel + " prêt(s) à importer",
        prepared.rejected.length ? prepared.rejected.length + " ligne(s) ignorée(s) : " + prepared.rejected.join(", ") : "Toutes les lignes sont valides.",
        "",
        ...importRows.slice(0, 8).map((row) => (row.number || row.invoice_number) + " · " + row.date + " · " + row.client_name + " · " + Number(row.total_ttc).toFixed(2) + " " + row.currency),
        ...(importRows.length > 8 ? ["… et " + (importRows.length - 8) + " autre(s)"] : []),
      ].join("\n");
      report.textContent = "✅ Analyse terminée. Vérifiez les " + importRows.length + " ligne(s), puis cliquez sur Importer.";
      runButton.textContent = "Importer " + importRows.length;
      runButton.disabled = false;
    } catch (error) {
      importRows = [];
      runButton.disabled = true;
      report.textContent = "❌ " + (error && error.message ? error.message : String(error));
    }
  };
  runButton.onclick = async () => {
    try {
      if (!importRows.length) throw new Error("Analysez d’abord le fichier CSV.");
      runButton.disabled = true;
      report.textContent = "Import en cours…";
      const result = await window.api[entity].importCsv({ rows: importRows, fileName: selectedFile ? selectedFile.name : "" });
      const imported = Number(result && result.imported || 0);
      const skipped = Number(result && result.skipped || 0);
      report.textContent = "✅ " + imported + " ligne(s) importée(s) ; " + skipped + " doublon(s) ignoré(s).";
      await refreshModule(entity);
      setStatus(imported + " " + entityLabel + " historique(s) importé(s).");
    } catch (error) {
      report.textContent = "❌ " + (error && error.message ? error.message : String(error));
      runButton.disabled = false;
    }
  };
  bindModalClose(modalId);
  openModal(modalId);
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
        <div class="totals__row"><span>${t("dash.invoices.credited", "Annulées par avoir")}</span><strong>${Number(i.credited || 0)}</strong></div>
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
function paymentStatusText(status) {
  return t(`payments.status.${status}`, status);
}

function renderPaymentOverview(invoices, payments) {
  const kpisEl = document.getElementById("p-paymentKpis");
  const summaryEl = document.getElementById("p-invoiceSummary");
  const statusFilter = String(document.getElementById("p-payment-status")?.value || "all");
  const overview = window.D2FReceivables.summarize(invoices, payments);
  const rows = overview.rows;

  if (kpisEl) {
    const kpis = [
      [t("payments.overview.total_paid", "Total encaissé"), `${money(overview.totalPaid)} €`],
      [t("payments.overview.operations", "Paiements enregistrés"), String(overview.operations)],
      [t("payments.overview.paid_invoices", "Factures payées"), `${overview.paidCount} / ${overview.activeRows.length}`],
      [t("payments.overview.outstanding", "Reste à encaisser"), `${money(overview.outstanding)} €`],
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
          <div class="paymentsTable__amount">${t("payments.col.credited", "Avoirs")}</div>
          <div class="paymentsTable__amount">${t("payments.col.paid", "Encaissé")}</div>
          <div class="paymentsTable__amount">${t("payments.col.remaining", "Reste")}</div>
        </div>
        ${filtered.map((row) => {
          const invoice = row.invoice || {};
          const invoiceId = String(invoice.id || "");
          return `
            <div class="paymentsTable__row">
              <div data-label="${esc(t("payments.col.invoice", "Facture"))}"><button class="paymentInvoiceButton" type="button" data-payment-invoice="${esc(invoiceId)}">${esc(invoice.invoice_number || invoice.number || invoiceId)}</button></div>
              <div class="paymentsTable__muted" data-label="${esc(t("payments.col.client", "Client"))}" title="${esc(invoice.client_name || "")}">${esc(invoice.client_name || "—")}</div>
              <div data-label="${esc(t("payments.col.status", "Statut"))}"><span class="paymentStatus paymentStatus--${row.paymentStatus}">${esc(paymentStatusText(row.paymentStatus))}</span></div>
              <div class="paymentsTable__amount" data-label="${esc(t("payments.col.total", "Total"))}">${money(row.grossDue)} €</div>
              <div class="paymentsTable__amount" data-label="${esc(t("payments.col.credited", "Avoirs"))}" title="${esc(row.creditNumbers.join(", "))}">${row.credited > 0 ? `-${money(row.credited)} €` : "—"}</div>
              <div class="paymentsTable__amount" data-label="${esc(t("payments.col.paid", "Encaissé"))}">${money(row.paid)} €</div>
              <div class="paymentsTable__amount" data-label="${esc(t("payments.col.remaining", "Reste"))}">${money(row.remaining)} €</div>
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
              <div data-label="${esc(t("pay.col.date", "Date"))}">${esc(String(payment?.date || payment?.payment_date || "—"))}</div>
              <div data-label="${esc(t("payments.col.invoice", "Facture"))}">${esc(linkedInvoice.invoice_number || linkedInvoice.number || "—")}</div>
              <div class="paymentsTable__muted" data-label="${esc(t("payments.col.client", "Client"))}" title="${esc(linkedInvoice.client_name || "")}">${esc(linkedInvoice.client_name || "—")}</div>
              <div data-label="${esc(t("pay.col.method", "Moyen"))}">${esc(methodLabels[method] || method)}</div>
              <div class="paymentsTable__muted" data-label="${esc(t("pay.col.reference", "Référence / notes"))}" title="${esc(reference)}">${esc(reference || "—")}</div>
              <div class="paymentsTable__amount" data-label="${esc(t("pay.col.amount", "Montant"))}">${money(Number(payment?.amount || 0))} ${esc(String(payment?.currency || "EUR").toUpperCase())}</div>
              <div class="paymentsTable__amount" data-label="${esc(t("pay.col.action", "Action"))}"><button type="button" class="paymentDeleteButton" data-paydel="${esc(paymentId)}" ${paymentId ? "" : "disabled"}>${t("action.delete", "Supprimer")}</button></div>
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

      <div class="t-right" data-label="${esc(t("lines.qty", "Qté"))}">
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

      <div class="t-right" data-label="${esc(t("lines.unit_price_ht", "PU HT"))}">
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

      <div class="t-right" data-label="${esc(t("lines.discount_percent", "Remise %"))}">
        <input
          class="cell-input"
          data-k="remise_percent"
          data-i="${idx}"
          type="number"
          min="0"
          max="100"
          step="0.01"
          value="${Number(l.remise_percent || 0)}"
          ${readOnly ? "disabled" : ""}
        >
      </div>

      <div class="t-right" data-label="${esc(t("lines.vat_percent", "TVA%"))}">
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

      <div class="t-right" data-label="${esc(t("lines.line_total_ht", "Total HT"))}">
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
      const numeric = Number(raw);
      safeLines[i][k] = k === "remise_percent" ? Math.min(100, Math.max(0, numeric || 0)) : numeric;

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

  const t_ = computeTotals(state.quoteDraft.lines, state.quoteDraft.allowance_percent);

  state.quoteDraft.subtotal_ht = Number(t_.subtotal_ht || 0);
  state.quoteDraft.allowance_percent = Number(t_.allowance_percent || 0);
  state.quoteDraft.allowance_amount = Number(t_.allowance_amount || 0);
  state.quoteDraft.total_ht = Number(t_.total_ht || 0);
  state.quoteDraft.total_tva = Number(t_.total_tva || 0);
  state.quoteDraft.total_ttc = Number(t_.total_ttc || 0);

  if ($("q-subtotal-ht")) $("q-subtotal-ht").textContent = money(t_.subtotal_ht);
  if ($("q-discount-amount")) $("q-discount-amount").textContent = money(t_.allowance_amount);
  if ($("q-total-ht")) $("q-total-ht").textContent = money(t_.total_ht);
  if ($("q-total-tva")) $("q-total-tva").textContent = money(t_.total_tva);
  if ($("q-total-ttc")) $("q-total-ttc").textContent = money(t_.total_ttc);
}

function refreshInvoiceTotals() {
  if (!state.invoiceDraft) state.invoiceDraft = { lines: [] };
  if (!Array.isArray(state.invoiceDraft.lines)) state.invoiceDraft.lines = [];
  const t_ = computeTotals(state.invoiceDraft.lines, state.invoiceDraft.allowance_percent);
  state.invoiceDraft.subtotal_ht = Number(t_.subtotal_ht || 0);
  state.invoiceDraft.allowance_percent = Number(t_.allowance_percent || 0);
  state.invoiceDraft.allowance_amount = Number(t_.allowance_amount || 0);
  state.invoiceDraft.total_ht = Number(t_.total_ht || 0);
  state.invoiceDraft.total_tva = Number(t_.total_tva || 0);
  state.invoiceDraft.total_ttc = Number(t_.total_ttc || 0);
  if ($("i-subtotal-ht")) $("i-subtotal-ht").textContent = money(t_.subtotal_ht);
  if ($("i-discount-amount")) $("i-discount-amount").textContent = money(t_.allowance_amount);
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
  const quoteHistorical = Boolean(state.quoteDraft.historical_import);
  if ($("q-discount-percent")) {
    $("q-discount-percent").value = String(Number(state.quoteDraft.allowance_percent || 0));
    $("q-discount-percent").disabled = quoteHistorical;
    $("q-discount-percent").oninput = (event) => {
      state.quoteDraft.allowance_percent = Math.min(100, Math.max(0, Number(event.target.value) || 0));
      refreshQuoteTotals();
    };
  }
  if ($("q-discount-reason")) {
    $("q-discount-reason").value = state.quoteDraft.allowance_reason || "";
    $("q-discount-reason").disabled = quoteHistorical;
    $("q-discount-reason").oninput = (event) => { state.quoteDraft.allowance_reason = event.target.value; };
  }
  for (const id of ["q-date", "q-client", "q-vat-mode", "q-validity-days", "q-valid-until", "q-payment-text"]) {
    if ($(id)) $(id).disabled = quoteHistorical;
  }

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
    },
    quoteHistorical
  );

  refreshQuoteTotals();
  applyLinesGridLayout("quotes");

  const badge = document.getElementById("q-status-badge");
  if (!badge) {
    console.warn("[renderQuoteDraft] q-status-badge introuvable dans le DOM");
    return;
  }

  const st = String(state.quoteDraft?.status || "draft").toLowerCase();

  const label = t(`quotes.status.${st}`, st);

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

  const lifecycleHint = document.getElementById("q-lifecycle-hint");
  if (lifecycleHint) {
    const lifecycleKey = state.quoteDraft?.id ? st : "new";
    lifecycleHint.textContent = t(`quotes.lifecycle.${lifecycleKey}`, "");
  }

  if (state.currentModule === "quotes") renderToolbar("quotes");

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
  const readOnly = Boolean(state.invoiceDraft?.id && !isDraftInvoice());
  if ($("i-id")) $("i-id").value = state.invoiceDraft.id || "";
  if ($("i-date")) $("i-date").value = state.invoiceDraft.date || new Date().toISOString().slice(0, 10);
  if ($("i-client")) $("i-client").value = state.invoiceDraft.client_id || $("i-client")?.value || "";
  if ($("i-due-date")) {
    $("i-due-date").value = state.invoiceDraft.due_date || "";
    $("i-due-date").disabled = readOnly;
  }
  if ($("i-payment-term")) $("i-payment-term").value = paymentTermLabel(state.invoiceDraft.payment_term) || state.invoiceDraft.payment_term || "";
  if ($("i-payment-text")) {
    $("i-payment-text").value = state.invoiceDraft.payment_text || "";
    $("i-payment-text").disabled = readOnly;
  }

  if ($("i-vat-mode")) $("i-vat-mode").value = state.invoiceDraft.vat_mode || getVatModeFromUi("i");
  setVatEffectiveToUi("i", state.invoiceDraft.vat_effective || "AUTO");
  if ($("i-discount-percent")) {
    $("i-discount-percent").value = String(Number(state.invoiceDraft.allowance_percent || 0));
    $("i-discount-percent").disabled = readOnly;
    $("i-discount-percent").oninput = (event) => {
      state.invoiceDraft.allowance_percent = Math.min(100, Math.max(0, Number(event.target.value) || 0));
      refreshInvoiceTotals();
    };
  }
  if ($("i-discount-reason")) {
    $("i-discount-reason").value = state.invoiceDraft.allowance_reason || "";
    $("i-discount-reason").disabled = readOnly;
    $("i-discount-reason").oninput = (event) => { state.invoiceDraft.allowance_reason = event.target.value; };
  }
  for (const id of ["i-date", "i-client", "i-vat-mode"]) if ($(id)) $(id).disabled = readOnly;

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
  refreshExportReadiness().catch((error) => console.warn("[compliance] preflight", error));
}

function localizedComplianceMessage(issue) {
  const key = `compliance.issue.${String(issue?.code || "").toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
  return t(key, issue?.message || issue?.code || "");
}

async function refreshExportReadiness() {
  const invoiceId = getSelectedExportInvoiceId();
  const badge = $("ex-compliance-badge");
  const profileEl = $("ex-compliance-profile");
  const list = $("ex-compliance-list");
  const sendButton = document.querySelector('[data-action="exports:peppolSend"]');
  if (!badge || !profileEl || !list) return;
  badge.classList.remove("is-neutral", "is-ready", "is-warning", "is-blocked");
  if (!invoiceId) {
    badge.classList.add("is-neutral");
    badge.textContent = t("exports.readiness.pending", "À vérifier");
    profileEl.textContent = t("exports.readiness.select", "Sélectionnez une facture pour vérifier le profil du pays.");
    list.innerHTML = "";
    setButtonDisabled(sendButton, true);
    return;
  }
  badge.classList.add("is-neutral");
  badge.textContent = t("exports.readiness.checking", "Contrôle…");
  setButtonDisabled(sendButton, true);
  try {
    const result = await window.api.conformity.invoicePreflight({ id: invoiceId, mode: "national" });
    const profileKey = `integrations.profile.${String(result?.sellerCountry || "default").toLowerCase()}.title`;
    profileEl.textContent = t(profileKey, result?.profile?.label || result?.profile?.nationalChannel || "EN16931");
    const issues = [...(result?.errors || []), ...(result?.warnings || [])];
    list.innerHTML = "";
    for (const issue of issues) {
      const li = document.createElement("li");
      li.textContent = localizedComplianceMessage(issue);
      list.appendChild(li);
    }
    const readiness = result?.readiness || (result?.ok ? "ready" : "blocked");
    badge.classList.remove("is-neutral");
    badge.classList.add(`is-${readiness}`);
    badge.textContent = t(`exports.readiness.${readiness}`, readiness === "ready" ? "Prêt" : readiness === "warning" ? "À confirmer" : "Bloqué");
    setButtonDisabled(sendButton, !result?.ok);
    sendButton?.setAttribute("title", result?.ok ? t("exports.readiness.send_ready", "Contrôles obligatoires réussis") : t("exports.readiness.send_blocked", "Corrigez les informations listées avant transmission"));
  } catch (error) {
    badge.classList.remove("is-neutral");
    badge.classList.add("is-blocked");
    badge.textContent = t("exports.readiness.blocked", "Bloqué");
    profileEl.textContent = error?.message || t("exports.readiness.error", "Contrôle indisponible");
    list.innerHTML = "";
    setButtonDisabled(sendButton, true);
  }
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
    bindIntegrationForms();
    bindComplianceEvidence();
    await Promise.all([loadIntegrationForm("pa"), loadIntegrationForm("archive"), cfLoadCompanyReportingConfig(), cfLoadEvidence()]);
    return;
  }

  if (moduleKey === "dashboard") {
    await computeAndRenderDashboard();
    return;
  }

  // ===================== BEGIN PATCH E-INVOICING / E-REPORTING (REFRESH MODULE) =====================
if (moduleKey === "conformity") {
  await initConformityPage();
  await cfLoadOperationalReport();
  return;
}

  if (moduleKey === "clients") {
    const q = $("clientsSearch")?.value || "";
    state.clients = (await window.api.clients.list({ q })).map(normalizeClient);
    setDocumentListCount("clientsListCount", state.clients.length);
    renderClientList($("clientsList"), state.clients, state.selectedClientId);

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

    setDocumentListCount("quotesListCount", state.quotes.length);
    renderQuoteDocumentList($("quotesList"), state.quotes, state.selectedQuoteId);
    decorateQuoteList();

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
      allowance_percent: Number(full.quote.allowance_percent || 0),
      allowance_amount: Number(full.quote.allowance_amount || 0),
      allowance_reason: full.quote.allowance_reason || "",
      allowance_reason_code: full.quote.allowance_reason_code || "95",
      historical_import: Boolean(full.quote.historical_import),
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
    const invoiceStatusSource = q.trim()
      ? (await window.api.invoices.list({ q: "" })).map(normalizeInvoice)
      : state.invoices;

    try {
      state.payments.all = (await window.api.payments.listAll({})) || [];
    } catch (error) {
      console.warn("[invoices] payment overview unavailable", error);
      state.payments.all = [];
    }
    setDocumentListCount("invoicesListCount", state.invoices.length);
    renderInvoiceDocumentList(
      $("invoicesList"),
      state.invoices,
      state.selectedInvoiceId,
      state.payments.all,
      invoiceStatusSource
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

    const invoiceClient = state.clients.find((client) => String(client.id || "") === String(full.invoice.client_id || "")) || {};
    state.invoiceDraft = {
      id: full.invoice.id,
      client_id: full.invoice.client_id || "",
      date: full.invoice.date,
      due_date: resolvedInvoiceDueDate(full.invoice.date, full.invoice, invoiceClient),
      payment_term: full.invoice.payment_term || full.invoice.paymentTerm || invoiceClient.payment_term || "",
      payment_text: full.invoice.payment_text || full.invoice.paymentText || invoiceClient.payment_text || "",
      status: full.invoice.status || "draft",
      type_code: full.invoice.type_code || full.invoice.invoice_type_code || "380",
      prepaid_amount: Number(full.invoice.prepaid_amount || 0) || 0,
      source_quote_id: full.invoice.source_quote_id || null,
      vat_mode: full.invoice.vat_mode || "AUTO",
      vat_effective: "AUTO",
      allowance_percent: Number(full.invoice.allowance_percent || 0),
      allowance_amount: Number(full.invoice.allowance_amount || 0),
      allowance_reason: full.invoice.allowance_reason || "",
      allowance_reason_code: full.invoice.allowance_reason_code || "95",
      historical_import: Boolean(full.invoice.historical_import),
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
  state.payments.all = (await window.api.payments.listAll({})) || [];

  const sel = $("p-invoice");
  const cur = String(sel?.value || state.payments.selectedInvoiceId || "").trim();
  const payableInvoices = window.D2FReceivables
    .buildReceivableRows(state.invoices || [], state.payments.all || [])
    .filter((row) => row.remaining > window.D2FReceivables.EPSILON);

  setSelectOptions(
    $("p-invoice"),
    payableInvoices.map((row) => ({
      id: row.invoice.id,
      label: `${row.invoice.invoice_number || row.invoice.id} — ${row.invoice.client_name || "—"} • ${money(row.remaining)} € ${t("payments.col.remaining", "reste")}`,
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

      case "theme:accent:indigo":
      case "theme:accent:cyan":
      case "theme:accent:green":
      case "theme:accent:orange":
      case "theme:accent:pink": {
        const colors = {
          "theme:accent:indigo": "#6366f1",
          "theme:accent:cyan": "#06b6d4",
          "theme:accent:green": "#22c55e",
          "theme:accent:orange": "#f97316",
          "theme:accent:pink": "#ec4899",
        };
        applyAccentColor(colors[actionId]);
        setStatus(t("status.theme_accent_selected", "Couleur d’interface sélectionnée — enregistrez la fiche Entreprise."));
        break;
      }

      case "quotes:accept": {
        const id = state.quoteDraft?.id;
        if (!id) { setStatus("Devis: id manquant"); break; }
        if (!["draft", "sent"].includes(canonicalQuoteStatus(state.quoteDraft))) {
          throw new Error(t("err.quote.decision_not_allowed", "Ce devis a déjà reçu une décision définitive."));
        }

        const updated = await window.api.quotes.setStatus({ id, status: "accepted" });
        state.quoteDraft = { ...state.quoteDraft, ...(updated || {}), status: "accepted" };
        renderQuoteDraft();

        await refreshModule("quotes");
        setStatus(t("status.quote_accepted", "Devis accepté"));
        break;
      }

      case "quotes:reject": {
        const id = state.quoteDraft?.id;
        if (!id) throw new Error(t("err.quote.select_quote", "Sélectionnez un devis."));
        if (!["draft", "sent"].includes(canonicalQuoteStatus(state.quoteDraft))) {
          throw new Error(t("err.quote.decision_not_allowed", "Ce devis a déjà reçu une décision définitive."));
        }

        const updated = await window.api.quotes.setStatus({ id, status: "rejected" });
        state.quoteDraft = { ...state.quoteDraft, ...(updated || {}), status: "rejected" };
        renderQuoteDraft();
        await refreshModule("quotes");
        setStatus(t("status.quote_rejected", "Devis refusé"));
        break;
      }
      
      case "items:importCsv":
        await importItemsCsvFile();
        break;

      case "quotes:importCsv":
        openDocumentCsvImport("quotes");
        break;

      case "invoices:importCsv":
        openDocumentCsvImport("invoices");
        break;

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

  const res = await window.api.conformity.sendNow(cfReportingPeriod());
  await refreshModule("conformity");
  setStatus(res?.message || t("reporting.send.started", "Transmission réglementaire remise au connecteur."));
  break;
}

case "conformity:rebuildPeriod": {
  if (!window.api?.conformity?.rebuildPeriod) {
    setStatus("Recalcul non branché (IPC conformity:rebuildPeriod manquant).");
    break;
  }

  const res = await window.api.conformity.rebuildPeriod(cfReportingPeriod());
  state.regulatoryReport = res;
  cfRenderOperationalReport(res);
  setStatus(res?.message || t("reporting.period.prepared", "Période préparée"));
  break;
}

case "conformity:settings": {
  cfOpenCompanyReportingSettings();
  break;
}

case "conformity:openQueue": {
  if (!window.api?.conformity?.openQueue) {
    setStatus("File d’envoi non branchée (IPC conformity:openQueue manquant).");
    break;
  }
  const transmissions = await window.api.conformity.openQueue();
  state.regulatoryReport = { ...(state.regulatoryReport || {}), transmissions: Array.isArray(transmissions) ? transmissions : [] };
  cfRenderOperationalReport(state.regulatoryReport || {});
  setStatus(t("reporting.transmissions.refreshed", "Accusés de réception actualisés."));
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

  const receivable = window.D2FReceivables
    .buildReceivableRows(state.invoices || [], state.payments.all || [])
    .find((row) => String(row.invoice?.id || "") === String(invoiceId));
  if (!receivable || receivable.remaining <= window.D2FReceivables.EPSILON) {
    throw new Error(t("payments.error.no_balance", "Cette facture ne présente plus de solde à encaisser."));
  }

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
  validateCompanyEN16931(payload);
  const saved = await window.api.company.save(payload);
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
  validateBuyerEN16931(payload);
  const saved = normalizeClient(await window.api.clients.save(payload));
  state.selectedClientId = saved.id; 
  await refreshModule("clients");
  setStatus(t("status.client_saved", "Client saved"));
  break;
}

case "clients:lookupPeppol": {
  const payload = clientPayloadFromForm();
  validateBuyerEN16931(payload);
  setClientPeppolStatus("not_checked", t("clients.peppol.searching", "Recherche dans l’annuaire officiel PEPPOL…"));
  try {
    const request = {
      country: payload.country,
      name: payload.name,
      legalId: payload.legal_id,
      vatId: payload.vat_id,
      scheme: payload.peppol_endpoint_scheme,
      endpointId: payload.peppol_endpoint_id,
      query: payload.peppol_endpoint_id || payload.legal_id || payload.vat_id || payload.name,
    };
    const result = window.api.directory?.lookupPeppol
      ? await window.api.directory.lookupPeppol(request)
      : await window.api.invoke("directory:lookupPeppol", request);
    const matches = Array.isArray(result?.results) ? result.results : [];
    if (!matches.length) {
      const message = t("clients.peppol.not_found_help", "Aucun participant trouvé. Vous pouvez enregistrer la fiche et produire un PDF, mais l’export structuré restera bloqué tant que l’adresse électronique n’est pas renseignée.");
      setClientPeppolStatus("not_found", message);
      const saved = normalizeClient(await window.api.clients.save({
        ...clientPayloadFromForm(),
        peppol_directory_status: "not_found",
        peppol_directory_message: message,
        peppol_directory_source: result?.source || "Peppol Directory",
        peppol_directory_checked_at: new Date().toISOString(),
      }));
      state.selectedClientId = saved.id;
      await refreshModule("clients");
      setStatus(t("clients.peppol.not_found_saved", "Client enregistré — participant PEPPOL non trouvé"));
      break;
    }
    const country = String(payload.country || "").toUpperCase();
    const legalId = String(payload.legal_id || payload.vat_id || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
    const best = matches.find((item) => String(item.country || "").toUpperCase() === country && String(item.endpointId || "").replace(/[^A-Z0-9]/gi, "").toUpperCase().includes(legalId))
      || matches.find((item) => String(item.country || "").toUpperCase() === country)
      || matches[0];
    const normalizedEndpoint = normalizeClientPeppol(best.scheme, best.endpointId);
    if ($("cl-peppol-scheme")) $("cl-peppol-scheme").value = normalizedEndpoint.scheme;
    if ($("cl-peppol-endpoint")) $("cl-peppol-endpoint").value = normalizedEndpoint.endpointId;
    const message = t("clients.peppol.found_help", "Participant trouvé : {name} ({scheme}:{id}). Confirmez la capacité de réception avec votre prestataire avant l’envoi.", { name: best.name || payload.name, scheme: normalizedEndpoint.scheme, id: normalizedEndpoint.endpointId });
    setClientPeppolStatus("verified", message);
    const saved = normalizeClient(await window.api.clients.save({
      ...clientPayloadFromForm(),
      peppol_endpoint_scheme: normalizedEndpoint.scheme,
      peppol_endpoint_id: normalizedEndpoint.endpointId,
      peppol_directory_status: "verified",
      peppol_directory_message: message,
      peppol_directory_source: result?.source || "Peppol Directory",
      peppol_directory_checked_at: new Date().toISOString(),
      peppol_participant_name: best.name || payload.name,
      peppol_participant_country: best.country || payload.country,
    }));
    state.selectedClientId = saved.id;
    await refreshModule("clients");
    setStatus(t("clients.peppol.verified_saved", "Identifiant PEPPOL vérifié et enregistré dans la fiche client"));
  } catch (error) {
    setClientPeppolStatus("error", error?.message || t("clients.peppol.error", "Annuaire indisponible"));
    throw error;
  }
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
    allowance_percent: 0,
    allowance_amount: 0,
    allowance_reason: "",
    allowance_reason_code: "95",
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
  if (state.quoteDraft?.id && canonicalQuoteStatus(state.quoteDraft) !== "draft") {
    throw new Error(t("err.quote.only_draft_editable", "Seul un devis brouillon peut être modifié."));
  }

  state.company = await window.api.company.get();
  validateCompanyEN16931(state.company);

  const buyer = normalizeClient(await window.api.clients.get(clientId));
  validateBuyerEN16931(buyer);

  await applyVatForQuote({ silent: true }).catch(() => {});
  validateLinesEN16931(state.quoteDraft.lines);
  validateDocumentDiscount(state.quoteDraft);
  
  refreshQuoteTotals();

  const payload = {
  id: state.quoteDraft.id || undefined,
  client_id: clientId,
  date,
  currency: "EUR",
  status: "draft",
  vat_mode: state.quoteDraft.vat_mode || "AUTO",
  subtotal_ht: Number(state.quoteDraft.subtotal_ht || 0),
  allowance_percent: Number(state.quoteDraft.allowance_percent || 0),
  allowance_amount: Number(state.quoteDraft.allowance_amount || 0),
  allowance_reason: state.quoteDraft.allowance_reason || "Remise commerciale",
  allowance_reason_code: "95",

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
  if (state.quoteDraft?.id && canonicalQuoteStatus(state.quoteDraft) !== "draft") {
    throw new Error(t("err.quote.only_draft_can_be_sent", "Seul un devis brouillon peut être validé et envoyé."));
  }
  if (!state.quoteDraft?.id) await handleAction("quotes:save");
  const qid = state.selectedQuoteId || state.quoteDraft?.id;
  if (!qid) throw new Error(t("err.quote.select_quote", "Sélectionnez un devis."));
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
  if (canonicalQuoteStatus(quote) !== "accepted") {
    throw new Error(t("err.quote.must_be_accepted_for_invoice", "Le devis doit être accepté avant de créer une facture."));
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
  if (canonicalQuoteStatus(state.quoteDraft) !== "accepted") {
    throw new Error(t("err.quote.must_be_accepted_for_invoice", "Le devis doit être accepté avant de créer une facture."));
  }
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
  if (canonicalQuoteStatus(state.quoteDraft) !== "draft") {
    throw new Error(t("err.quote.only_draft_deletable", "Seul un devis brouillon peut être supprimé."));
  }
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
    due_date: "",
    payment_term: "",
    payment_text: "",
    lines: [],
    status: "draft",
    type_code: "380",
    prepaid_amount: 0,
    source_quote_id: null,
    vat_mode: "AUTO",
    vat_effective: "AUTO",
    allowance_percent: 0,
    allowance_amount: 0,
    allowance_reason: "",
    allowance_reason_code: "95",
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
  validateDocumentDiscount(state.invoiceDraft);

  const date = $("i-date")?.value || new Date().toISOString().slice(0, 10);
  const totals = computeTotals(state.invoiceDraft.lines, state.invoiceDraft.allowance_percent);

  const payload = {
    id: state.invoiceDraft.id || undefined,
    client_id: clientId,
    date,
    due_date: $("i-due-date")?.value || state.invoiceDraft.due_date || "",
    payment_term: state.invoiceDraft.payment_term || buyer.payment_term || "",
    payment_text: $("i-payment-text")?.value || state.invoiceDraft.payment_text || "",
    currency: "EUR",
    type: "final",
    status: "draft",
    prepaid_amount: Number(state.invoiceDraft.prepaid_amount || 0) || 0,
    subtotal_ht: Number(totals.subtotal_ht || 0),
    allowance_percent: Number(state.invoiceDraft.allowance_percent || 0),
    allowance_amount: Number(totals.allowance_amount || 0),
    allowance_reason: state.invoiceDraft.allowance_reason || "Remise commerciale",
    allowance_reason_code: "95",
    total_ht: Number(totals.total_ht || 0),
    total_tva: Number(totals.total_tva || 0),
    total_ttc: Number(totals.total_ttc || 0),
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
    due_date: "",
    payment_term: "",
    payment_text: "",
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
  const dueDate = $("i-due-date")?.value || state.invoiceDraft.due_date || "";
  if (!dueDate) throw new Error(t("invoices.error.due_date_required", "L’échéance est obligatoire avant l’émission de la facture."));
  await handleAction("invoices:save");
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
        const dueDate = $("i-due-date")?.value || state.invoiceDraft.due_date || "";
        if (!dueDate) throw new Error(t("invoices.error.due_date_required", "L’échéance est obligatoire avant l’émission de la facture."));
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
        if (!quoteId) throw new Error(t("err.exports.select_quote", "Sélectionner un devis."));

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

        if (res?.ok) setStatus(t("exports.pdf_quote_ready", "PDF du devis téléchargé : {name}", { name: res.path }));
        else if (res?.canceled) setStatus(t("status.pdfexport_canceled", "Export PDF annulé"));
        else throw new Error(res?.error || t("err.exports.pdf_quote_failed", "Export PDF devis échoué"));
        break;
      }

      case "exports:pdfInvoice": {
        const invoiceId =
          getSelectedExportInvoiceId() || state.invoiceDraft?.id || state.selectedInvoiceId;
        if (!invoiceId) throw new Error(t("err.exports.select_invoice", "Sélectionner une facture."));

        const locale = getExportLocale();

        const company = await ensureCompanyLoaded();
        const cgvText = pickCgvTextForLocale(company, locale);

        const config = {
          currency: "EUR",
          branding: { showLogo: true, accentColor: "#2563eb" },
          sellerOverride: { ...(company || {}), cgv_text: cgvText },
        };

        const res = await window.api.invoices.exportPdf(invoiceId, locale, config);

        if (res?.ok) setStatus(t("exports.pdf_invoice_ready", "PDF de la facture téléchargé : {name}", { name: res.path }));
        else if (res?.canceled) setStatus(t("status.pdfexport_canceled", "Export PDF annulé"));
        else throw new Error(res?.error || t("err.exports.pdf_invoice_failed", "Export PDF facture échoué"));
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

        const mailResult = await window.api.email.send({
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

        setStatus(mailResult?.mode === "mailto"
          ? t("exports.email_prepared", "E-mail préparé pour {email} — ajoutez le PDF téléchargé en pièce jointe.", { email: buyer.email })
          : t("exports.quote_sent", "Devis envoyé à {email}", { email: buyer.email }));

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

  const mailResult = await window.api.email.send({
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

  setStatus(mailResult?.mode === "mailto"
    ? t("exports.email_prepared", "E-mail préparé pour {email} — ajoutez le PDF téléchargé en pièce jointe.", { email: buyer.email })
    : t("exports.invoice_sent", "Facture envoyée à {email}", { email: buyer.email }));

  break;
}
      
      case "exports:peppolSend": {
        const invoiceId = getSelectedExportInvoiceId() || state.invoiceDraft?.id || state.selectedInvoiceId;
        if (!invoiceId) throw new Error(t("err.exports.select_invoice", "Sélectionner une facture."));
        const result = await window.api.connections.sendInvoice({ id: invoiceId });
        setStatus(t("exports.pa_sent", "Facture transmise à {provider} — statut : {status}", { provider: result?.provider || "PA", status: result?.status || "submitted" }));
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
    const v = String(s || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (["oui", "o", "yes", "y", "si", "s", "da", "d", "1", "true"].includes(v)) return true;
    if (["non", "n", "no", "ne", "0", "false"].includes(v)) return false;
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
        ? t("conformity.eligibility.none")
        : emitsB2C && !hasIntl
          ? t("conformity.eligibility.b2c_only")
          : !emitsB2C && hasIntl
            ? t("conformity.eligibility.intl_only")
            : t("conformity.eligibility.b2c_and_intl"),
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
    post("assistant", t("conformity.ai.recommendations_applied", "✅ Recommandations appliquées.\n- Scope: {scope}\n- Périodicité: {periodicity}\n- Archivage: {archiving}\n- Plateforme: {platform}", {
      scope: rec.scope,
      periodicity: state.conformity.periodicity,
      archiving: rec.archiving,
      platform: rec.platform || "—",
    }));
    post("assistant", `${elig.concerned ? t("conformity.ai.concerned") : t("conformity.ai.not_concerned")}\n${elig.why}`);
  };

  const updateHelpTextsAndMissing = async () => {
    const s = state.conformity || {};
    const elig = computeEligibility();
    const co = await getCompanySnapshot();
    const vr = co?.vat_regime || state.company?.vat_regime || "";

    // Aides “quoi remplir”
    if (help.scope()) help.scope().textContent = t("conformity.help.scope_fr");

    if (help.per()) help.per().textContent = `${t("conformity.help.periodicity_fr")} ${t("conformity.ai.vat_regime", "Régime TVA : {regime}", { regime: vr || "—" })}`;

    if (help.arch()) help.arch().textContent = t("conformity.help.archiving");

    if (help.plat()) help.plat().textContent = t("conformity.help.platform_fr");

    if (help.b2c()) help.b2c().textContent = t("conformity.help.b2c");

    if (help.intl()) help.intl().textContent = t("conformity.help.intl");

    if (help.nextdue()) help.nextdue().textContent = t("conformity.help.next_due");

    // Vérif complétude minimale “pré-config”
    const missing = [];

    // Concerné => il faut au moins plateforme + periodicité + archivage
    if (elig.concerned) {
      if (!String(s.platform || "").trim()) missing.push(t("conformity.ai.missing_platform"));
      if (!String(s.periodicity || "").trim()) missing.push(t("conformity.ai.missing_periodicity"));
      if (!String(s.archiving || "").trim()) missing.push(t("conformity.ai.missing_archiving"));
      // scope utile surtout si international
      if (elig.hasIntl && String(s.scope || "").toUpperCase() !== "INTL") {
        missing.push(t("conformity.ai.missing_scope_intl"));
      }
    } else {
      // non concerné => on ne force pas plateforme, mais on garde des conseils
      if (!String(s.archiving || "").trim()) missing.push(t("conformity.ai.missing_archiving_advised"));
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
    summaryLines.push(elig.concerned ? t("conformity.ai.concerned") : t("conformity.ai.not_concerned"));
    summaryLines.push(elig.why);
    summaryLines.push("");
    summaryLines.push(t("conformity.ai.current_fields", "Champs actuels : scope={scope}, periodicity={periodicity}, archiving={archiving}, platform={platform}", {
      scope: s.scope || "—",
      periodicity: s.periodicity || "—",
      archiving: s.archiving || "—",
      platform: s.platform || "—",
    }));
    if (missing.length) summaryLines.push(`\n${t("conformity.ai.to_complete")}: ${missing.join(", ")}`);

    summaryEl.textContent = summaryLines.join("\n");
  };

  // Script “diagnostic” : questions courtes + mapping vers tes champs
  const script = [
    {
      q: () => t("conformity.ai.q_b2c"),
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
      q: () => t("conformity.ai.q_intl"),
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
      q: () => t("conformity.ai.q_platform"),
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
      q: () => t("conformity.ai.q_monthly"),
      onAnswer: async (txt) => {
        const v = yesNoUnknown(txt);
        if (v === true) {
          state.conformity.periodicity = "M";
          if (ui.per()) ui.per().value = "M";
        }
      },
    },
    {
      q: () => t("conformity.ai.q_archive"),
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
    post("assistant", t("conformity.ai.welcome"));
    await updateHelpTextsAndMissing().catch(() => {});
    post("assistant", script[0].q());
    input.focus();
  };

  const handleUserText = async (txt) => {
    const text = String(txt || "").trim();
    if (!text) return;

    post("user", text);

    const cur = script[agent.step];
    if (!cur) {
      post("assistant", t("conformity.ai.already_finished"));
      return;
    }

    try {
      await cur.onAnswer(text);
      agent.step++;

      await runCheckAndSave();

      if (agent.step < script.length) {
        post("assistant", script[agent.step].q());
      } else {
        const elig = computeEligibility();
        post("assistant", `${t("conformity.ai.finished")}\n${elig.concerned ? t("conformity.ai.concerned") : t("conformity.ai.not_concerned")}\n${elig.why}`);
        post("assistant", t("conformity.ai.can_recommend"));
      }
    } catch (e) {
      post("assistant", t("conformity.ai.error", "Erreur : {msg}", { msg: e.message || e }));
    }
  };

  // wiring boutons
  startBtn.onclick = () => startDiagnostic().catch(console.error);

  recommendBtn.onclick = () => {
    post("assistant", t("conformity.ai.calculating"));
    applyRecommendationsToUi().catch((e) => post("assistant", t("conformity.ai.error", "Erreur : {msg}", { msg: e.message || e })));
  };

  checkBtn.onclick = () => {
    updateHelpTextsAndMissing().catch(console.error);
    post("assistant", t("conformity.ai.check_done"));
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
    initWorkflowCompanion();
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
      focusDocumentEditorOnMobile("quotes");
    });

    $("invoicesList")?.addEventListener("click", async (e) => {
      const item = e.target.closest(".list__item");
      if (!item) return;
      state.selectedInvoiceId = item.dataset.id;
      await refreshModule("invoices");
      focusDocumentEditorOnMobile("invoices");
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
    $("ex-invoice")?.addEventListener("change", () => refreshExportReadiness().catch(console.error));
    ["cl-peppol-scheme", "cl-peppol-endpoint"].forEach((id) => {
      $(id)?.addEventListener("input", () => setClientPeppolStatus("not_checked", t("clients.peppol.changed", "Identifiant modifié : relancez la recherche avant un envoi structuré.")));
    });

    // VAT watchers
    $("q-client")?.addEventListener("change", () => applyVatForQuote().catch(console.error));
    $("i-client")?.addEventListener("change", async () => {
      const client = normalizeClient(await getBuyerForInvoice());
      state.invoiceDraft.client_id = $("i-client")?.value || "";
      applyInvoiceClientPaymentDefaults(client, { force: true });
      renderInvoiceDraft();
      await applyVatForInvoice().catch(console.error);
    });
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

    $("i-date")?.addEventListener("change", async () => {
      state.invoiceDraft.date = $("i-date")?.value || new Date().toISOString().slice(0, 10);
      const client = normalizeClient(await getBuyerForInvoice());
      state.invoiceDraft.due_date = resolvedInvoiceDueDate(state.invoiceDraft.date, {}, client || {});
      renderInvoiceDraft();
    });
    $("i-due-date")?.addEventListener("change", () => {
      state.invoiceDraft.due_date = $("i-due-date")?.value || "";
    });
    $("i-payment-text")?.addEventListener("input", () => {
      state.invoiceDraft.payment_text = $("i-payment-text")?.value || "";
    });

    // seller country impacts AUTO
    $("co-country")?.addEventListener("input", () => {
      state.company = state.company || {};
      state.company.country = $("co-country")?.value?.trim().toUpperCase();
      updateCountryEInvoicingProfile(state.company);
      cfLoadCompanyReportingConfig().catch(() => {});
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
