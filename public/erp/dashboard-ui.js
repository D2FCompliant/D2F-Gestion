/* dashboard-ui.js */
"use strict";

/* -------------------------------------------------------
   i18n (compatible fallback)
------------------------------------------------------- */
const I18N_FALLBACK = Object.freeze({
  fr: {
    "dashboard.loading": "Chargement…",
    "dashboard.error": "Erreur",
    "dashboard.visuals": "Visuels",
    "dashboard.noMetrics": "Les métriques avancées ne sont pas disponibles. Les KPIs restent OK.",
    "dashboard.title": "Dashboard",
    "dashboard.targetVsRevenueTitle": "Objectif annuel vs CA réalisé (HT)",
    "dashboard.targetVsRevenueHint": "Suivi {year} — CA reconnu (factures finales émises – avoirs).",
    "dashboard.target": "objectif",
    "dashboard.targetUndefined": "objectif non défini",
    "dashboard.remaining": "reste",
    "dashboard.depositsTitle": "Acomptes encaissés vs attente (TTC)",
    "dashboard.paid": "encaissé",
    "dashboard.issued": "Émis",
    "dashboard.waiting": "En attente",
    "dashboard.cashMonthlyTitle": "Encaissements (YTD) — par mois",
    "dashboard.max": "max",
    "dashboard.month": "mois",
    "dashboard.recognizedMonthlyTitle": "CA reconnu (YTD) — par mois",
    "dashboard.recognizedMonthlyNotAvailable":
      "Non disponible via dashboard:metrics (utilise dashboard:get pour le total YTD).",
    "kpi.quotes.draft": "Brouillons",
    "kpi.quotes.sent": "Envoyés",
    "kpi.quotes.accepted": "Acceptés",
    "kpi.quotes.rejected": "Refusés",
    "kpi.invoices.issued": "Émises",
    "kpi.invoices.paid": "Payées",
    "kpi.invoices.credited": "Annulées par avoir",
    "kpi.invoices.waiting": "En attente",
  },
  en: {
    "dashboard.loading": "Loading…",
    "dashboard.error": "Error",
    "dashboard.visuals": "Visuals",
    "dashboard.noMetrics": "Advanced metrics are not available yet. KPIs are still OK.",
    "dashboard.title": "Dashboard",
    "dashboard.targetVsRevenueTitle": "Annual target vs achieved revenue (excl. VAT)",
    "dashboard.targetVsRevenueHint": "Tracking {year} — recognized revenue (final invoices issued – credit notes).",
    "dashboard.target": "target",
    "dashboard.targetUndefined": "target not defined",
    "dashboard.remaining": "remaining",
    "dashboard.depositsTitle": "Deposits paid vs pending (incl. VAT)",
    "dashboard.paid": "paid",
    "dashboard.issued": "Issued",
    "dashboard.waiting": "Pending",
    "dashboard.cashMonthlyTitle": "Cash in (YTD) — per month",
    "dashboard.max": "max",
    "dashboard.month": "month",
    "dashboard.recognizedMonthlyTitle": "Recognized revenue (YTD) — per month",
    "dashboard.recognizedMonthlyNotAvailable":
      "Not available via dashboard:metrics (use dashboard:get for YTD total).",
    "kpi.quotes.draft": "Draft",
    "kpi.quotes.sent": "Sent",
    "kpi.quotes.accepted": "Accepted",
    "kpi.quotes.rejected": "Rejected",
    "kpi.invoices.issued": "Issued",
    "kpi.invoices.paid": "Paid",
    "kpi.invoices.credited": "Cancelled by credit note",
    "kpi.invoices.waiting": "Pending",
  },
});

const MANAGEMENT_COPY = Object.freeze({
  fr: {
    management: "Pilotage de l’entreprise", cash: "Encaissements depuis janvier", outstanding: "À encaisser", overdue: "En retard",
    conversion: "Taux de transformation", overdueInvoices: "facture(s) échue(s)", missingDueDate: "sans échéance", decidedQuotes: "devis décidés",
    supportAdmin: "File de traitement des tickets clients", supportCustomer: "Mes demandes D2F", supportLeadAdmin: "Suivez, attribuez, répondez et clôturez les demandes depuis l’interface D2F.",
    supportLeadCustomer: "Suivez les réponses de D2F sans quitter votre tableau de bord.", newTicket: "Ouvrir un ticket",
    filterActive: "En cours", filterClosed: "Clôturés", filterAll: "Tous", ticketDisplay: "Afficher les tickets", noClosedTickets: "Aucun ticket clôturé.", statusClosed: "Clôturé",
    noTickets: "Aucun ticket actif.", noClientTickets: "Aucun ticket client à traiter.", open: "Ouvrir", viewQueue: "Voir toute la file", handle: "Traiter",
    statusOpen: "Nouveau", statusProgress: "En cours", statusWaiting: "En attente client", statusResolved: "Résolu", priorityUrgent: "Urgent", priorityHigh: "Haute", priorityNormal: "Normale", priorityLow: "Faible",
    requester: "Demandeur", updated: "Dernière activité", due30: "Échéances à 30 jours", invoices: "Voir les factures", quotes: "Voir les devis",
  },
  en: {
    management: "Company management", cash: "Cash received since January", outstanding: "Outstanding", overdue: "Overdue",
    conversion: "Quote conversion", overdueInvoices: "overdue invoice(s)", missingDueDate: "without a due date", decidedQuotes: "decided quotes",
    supportAdmin: "Customer ticket processing queue", supportCustomer: "My D2F requests", supportLeadAdmin: "Track, assign, reply to and close customer requests from D2F.",
    supportLeadCustomer: "Track D2F replies without leaving your dashboard.", newTicket: "Open a ticket",
    filterActive: "Active", filterClosed: "Closed", filterAll: "All", ticketDisplay: "Display tickets", noClosedTickets: "No closed ticket.", statusClosed: "Closed",
    noTickets: "No active ticket.", noClientTickets: "No customer ticket to process.", open: "Open", viewQueue: "View full queue", handle: "Process",
    statusOpen: "New", statusProgress: "In progress", statusWaiting: "Waiting for customer", statusResolved: "Resolved", priorityUrgent: "Urgent", priorityHigh: "High", priorityNormal: "Normal", priorityLow: "Low",
    requester: "Requester", updated: "Last activity", due30: "Due within 30 days", invoices: "View invoices", quotes: "View quotes",
  },
  sr: {
    management: "Upravljanje preduzećem", cash: "Naplaćeno od januara", outstanding: "Za naplatu", overdue: "Dospelo",
    conversion: "Konverzija ponuda", overdueInvoices: "dospelih faktura", missingDueDate: "bez roka plaćanja", decidedQuotes: "odlučenih ponuda",
    supportAdmin: "Red za obradu klijentskih tiketa", supportCustomer: "Moji D2F zahtevi", supportLeadAdmin: "Pratite, dodelite, odgovorite i zatvorite zahteve iz D2F-a.",
    supportLeadCustomer: "Pratite odgovore D2F-a na kontrolnoj tabli.", newTicket: "Otvori tiket",
    filterActive: "Aktivni", filterClosed: "Zatvoreni", filterAll: "Svi", ticketDisplay: "Prikaži tikete", noClosedTickets: "Nema zatvorenih tiketa.", statusClosed: "Zatvoren",
    noTickets: "Nema aktivnih tiketa.", noClientTickets: "Nema klijentskih tiketa za obradu.", open: "Otvori", viewQueue: "Prikaži ceo red", handle: "Obradi",
    statusOpen: "Nov", statusProgress: "U radu", statusWaiting: "Čeka klijenta", statusResolved: "Rešen", priorityUrgent: "Hitan", priorityHigh: "Visok", priorityNormal: "Normalan", priorityLow: "Nizak",
    requester: "Podnosilac", updated: "Poslednja aktivnost", due30: "Dospelo za 30 dana", invoices: "Vidi fakture", quotes: "Vidi ponude",
  },
  it: {
    management: "Gestione aziendale", cash: "Incassi da gennaio", outstanding: "Da incassare", overdue: "Scaduto",
    conversion: "Conversione preventivi", overdueInvoices: "fatture scadute", missingDueDate: "senza scadenza", decidedQuotes: "preventivi decisi",
    supportAdmin: "Coda di gestione dei ticket clienti", supportCustomer: "Le mie richieste D2F", supportLeadAdmin: "Seguite, assegnate, rispondete e chiudete le richieste da D2F.",
    supportLeadCustomer: "Seguite le risposte D2F dalla dashboard.", newTicket: "Apri un ticket",
    filterActive: "In corso", filterClosed: "Chiusi", filterAll: "Tutti", ticketDisplay: "Mostra ticket", noClosedTickets: "Nessun ticket chiuso.", statusClosed: "Chiuso",
    noTickets: "Nessun ticket attivo.", noClientTickets: "Nessun ticket cliente da gestire.", open: "Apri", viewQueue: "Vedi tutta la coda", handle: "Gestisci",
    statusOpen: "Nuovo", statusProgress: "In corso", statusWaiting: "In attesa cliente", statusResolved: "Risolto", priorityUrgent: "Urgente", priorityHigh: "Alta", priorityNormal: "Normale", priorityLow: "Bassa",
    requester: "Richiedente", updated: "Ultima attività", due30: "Scadenze entro 30 giorni", invoices: "Vedi fatture", quotes: "Vedi preventivi",
  },
  es: {
    management: "Gestión de la empresa", cash: "Cobros desde enero", outstanding: "Pendiente de cobro", overdue: "Vencido",
    conversion: "Conversión de presupuestos", overdueInvoices: "facturas vencidas", missingDueDate: "sin vencimiento", decidedQuotes: "presupuestos decididos",
    supportAdmin: "Cola de gestión de tickets de clientes", supportCustomer: "Mis solicitudes D2F", supportLeadAdmin: "Siga, asigne, responda y cierre solicitudes desde D2F.",
    supportLeadCustomer: "Siga las respuestas de D2F desde el panel.", newTicket: "Abrir un ticket",
    filterActive: "En curso", filterClosed: "Cerrados", filterAll: "Todos", ticketDisplay: "Mostrar tickets", noClosedTickets: "No hay tickets cerrados.", statusClosed: "Cerrado",
    noTickets: "No hay tickets activos.", noClientTickets: "No hay tickets de clientes por tratar.", open: "Abrir", viewQueue: "Ver toda la cola", handle: "Tratar",
    statusOpen: "Nuevo", statusProgress: "En curso", statusWaiting: "Esperando cliente", statusResolved: "Resuelto", priorityUrgent: "Urgente", priorityHigh: "Alta", priorityNormal: "Normal", priorityLow: "Baja",
    requester: "Solicitante", updated: "Última actividad", due30: "Vencimientos en 30 días", invoices: "Ver facturas", quotes: "Ver presupuestos",
  },
});

function getLocale() {
  const langEl = document.documentElement?.getAttribute("lang");
  const raw = (langEl || window?.state?.locale || window?.state?.lang || "fr").toString().toLowerCase();
  const locale = raw.slice(0, 2);
  return ["fr", "en", "sr", "es", "it"].includes(locale) ? locale : "fr";
}

function t(key, fallback = "") {
  try {
    if (typeof window.__d2fT === "function") return String(window.__d2fT(key, fallback) ?? fallback);
    if (window.i18n && typeof window.i18n.t === "function") return String(window.i18n.t(key) ?? fallback);
  } catch {}
  const loc = getLocale();
  return String(I18N_FALLBACK[loc]?.[key] ?? fallback ?? key);
}

function mt(key) {
  return String(MANAGEMENT_COPY[getLocale()]?.[key] || MANAGEMENT_COPY.fr[key] || key);
}

function tf(key, vars = {}, fallback = "") {
  let s = t(key, fallback);
  for (const [k, v] of Object.entries(vars || {})) {
    s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

/* -------------------------------------------------------
   Helpers
------------------------------------------------------- */
function n(v, def = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : def;
}
function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
function fmtEUR(x) {
  try {
    const numberLocale = { fr: "fr-FR", en: "en-GB", sr: "sr-Latn-RS", es: "es-ES", it: "it-IT" }[getLocale()] || "fr-FR";
    return new Intl.NumberFormat(numberLocale, {
      style: "currency",
      currency: "EUR",
    }).format(n(x, 0));
  } catch {
    return `${n(x, 0).toFixed(2)} €`;
  }
}
function fmtInt(x) {
  const numberLocale = { fr: "fr-FR", en: "en-GB", sr: "sr-Latn-RS", es: "es-ES", it: "it-IT" }[getLocale()] || "fr-FR";
  return new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 0 }).format(n(x, 0));
}
function fmtTicketDate(value) {
  if (!value) return "—";
  try {
    const numberLocale = { fr: "fr-FR", en: "en-GB", sr: "sr-Latn-RS", es: "es-ES", it: "it-IT" }[getLocale()] || "fr-FR";
    return new Intl.DateTimeFormat(numberLocale, {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}
function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* -------------------------------------------------------
   DOM wiring
------------------------------------------------------- */
function q(sel, root = document) {
  return root.querySelector(sel);
}
function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
function isDashboardActive() {
  const page = q('.page[data-page="dashboard"]');
  if (!page) return false;
  return page.classList.contains("is-active") && isVisible(page);
}

/* -------------------------------------------------------
   Mini charts (SVG)
------------------------------------------------------- */
function svgDonut({ pct = 0.5, size = 116, stroke = 14, color = "#6366f1", bg = "rgba(11,18,32,.10)" } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = clamp(pct, 0, 1) * c;

  return `
  <svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Donut">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${bg}" stroke-width="${stroke}" />
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
      stroke="${color}" stroke-width="${stroke}"
      stroke-linecap="round"
      stroke-dasharray="${dash} ${c - dash}"
      transform="rotate(-90 ${size / 2} ${size / 2})" />
  </svg>`;
}

function svgBars({ values = [], height = 72, color = "#06b6d4", label = "" } = {}) {
  const v = values.map((x) => n(x, 0));
  const max = Math.max(0, ...v);
  const min = Math.min(0, ...v);
  const span = Math.max(1, max - min);
  const baseline = Math.round((max / span) * height);
  const w = 8;
  const gap = 6;
  const totalW = v.length * w + (v.length - 1) * gap;
  const viewW = Math.max(totalW, 1);

  const bars = v
    .map((val, i) => {
      const valueY = Math.round(((max - val) / span) * height);
      const h = val === 0 ? 2 : Math.max(2, Math.abs(valueY - baseline));
      const x = i * (w + gap);
      const y = val >= 0 ? baseline - h : baseline;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${color}" opacity="${val !== 0 ? 1 : 0.25}"></rect>`;
    })
    .join("");

  return `
  <svg class="bars" viewBox="0 0 ${viewW} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">
    <line x1="0" x2="${viewW}" y1="${baseline}" y2="${baseline}" stroke="currentColor" opacity=".12" />
    ${bars}
  </svg>`;
}

function progressBar({ pct = 0, labelLeft = "", labelRight = "" } = {}) {
  const p = clamp(pct, 0, 1);
  return `
    <div class="progress">
      <div class="progress__bar" style="width:${(p * 100).toFixed(1)}%"></div>
    </div>
    <div class="progress__meta">
      <span>${esc(labelLeft)}</span>
      <span>${esc(labelRight)}</span>
    </div>
  `;
}

/* -------------------------------------------------------
   Fetching
------------------------------------------------------- */
async function fetchDashboardGet() {
  if (!window?.api?.dashboard?.get) return null;
  try {
    const r = await window.api.dashboard.get({});
    return r && r.ok ? r : null;
  } catch (e) {
    console.warn("[dashboard] get failed", e);
    return null;
  }
}

async function fetchDashboardMetrics() {
  if (!window?.api?.dashboard?.metrics) return null;
  const year = new Date().getFullYear();
  try {
    const r = await window.api.dashboard.metrics({ year });
    return r && r.ok ? r : null;
  } catch (e) {
    console.warn("[dashboard] metrics failed", e);
    return null;
  }
}

async function fetchSupportDashboard() {
  try {
    const response = await fetch("/auth/support", { credentials: "same-origin" });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) return null;
    return payload.result || null;
  } catch (error) {
    console.warn("[dashboard] support failed", error);
    return null;
  }
}

async function fetchDashboardData() {
  const [legacy, metrics, support] = await Promise.all([fetchDashboardGet(), fetchDashboardMetrics(), fetchSupportDashboard()]);
  if (!legacy && !metrics) return { ok: false, error: "No dashboard data" };
  return { ok: true, legacy, metrics, support };
}

/* -------------------------------------------------------
   DOM slots
------------------------------------------------------- */
function ensureDashboardVisualSlots() {
  const page = q('.page[data-page="dashboard"]');
  if (!page) return null;

  let visuals = q("#dashVisuals", page);
  if (!visuals) {
    const grid = q(".grid2", page);
    visuals = document.createElement("div");
    visuals.id = "dashVisuals";
    visuals.className = "dashVisuals";
    if (grid?.firstElementChild) grid.insertBefore(visuals, grid.firstElementChild);
    else page.appendChild(visuals);
  }
  return visuals;
}

/* -------------------------------------------------------
   Legacy rendering (existing IDs)
------------------------------------------------------- */
function renderLegacy(data) {
  const ca = q("#dash-ca-recognized");
  const depIssued = q("#dash-deposits-issued");
  const depPaid = q("#dash-deposits-paid");
  const depWait = q("#dash-deposits-waiting");

  if (ca) ca.textContent = fmtEUR(data?.ca_recognized_ht || 0);
  if (depIssued) depIssued.textContent = fmtEUR(data?.deposits?.issued_ttc || 0);
  if (depPaid) depPaid.textContent = fmtEUR(data?.deposits?.paid_ttc || 0);
  if (depWait) depWait.textContent = fmtEUR(data?.deposits?.waiting_ttc || 0);

  const qBox = q("#dashQuotesKpis");
  if (qBox) {
    const qs = data?.quotes?.counts || data?.quotes || {};
    qBox.innerHTML = `
      <div class="kpiGrid">
        <div class="kpi"><div class="kpi__label">${esc(t("kpi.quotes.draft", "Brouillons"))}</div><div class="kpi__value">${fmtInt(qs.draft)}</div></div>
        <div class="kpi"><div class="kpi__label">${esc(t("kpi.quotes.sent", "Envoyés"))}</div><div class="kpi__value">${fmtInt(qs.sent)}</div></div>
        <div class="kpi"><div class="kpi__label">${esc(t("kpi.quotes.accepted", "Acceptés"))}</div><div class="kpi__value">${fmtInt(qs.accepted)}</div></div>
        <div class="kpi"><div class="kpi__label">${esc(t("kpi.quotes.rejected", "Refusés"))}</div><div class="kpi__value">${fmtInt(qs.rejected)}</div></div>
      </div>
    `;
  }

  const iBox = q("#dashInvoicesKpis");
  if (iBox) {
    const inv = data?.invoices || {};
    iBox.innerHTML = `
      <div class="kpiGrid">
        <div class="kpi"><div class="kpi__label">${esc(t("kpi.invoices.issued", "Émises"))}</div><div class="kpi__value">${fmtInt(inv.issued)}</div></div>
        <div class="kpi"><div class="kpi__label">${esc(t("kpi.invoices.paid", "Payées"))}</div><div class="kpi__value">${fmtInt(inv.paid)}</div></div>
        <div class="kpi"><div class="kpi__label">${esc(t("kpi.invoices.credited", "Annulées par avoir"))}</div><div class="kpi__value">${fmtInt(inv.credited)}</div></div>
        <div class="kpi"><div class="kpi__label">${esc(t("kpi.invoices.waiting", "En attente"))}</div><div class="kpi__value">${fmtInt(inv.waiting)}</div></div>
      </div>
    `;
  }

  const pBox = q("#dashPaymentsKpis");
  if (pBox) pBox.innerHTML = `<div class="bigMoney">${fmtEUR(data?.payments?.total || 0)}</div>`;

  const pmBox = q("#dashPaymentsByMethod");
  if (pmBox) {
    const arr = Array.isArray(data?.payments?.by_method) ? data.payments.by_method : [];
    if (!arr.length) {
      pmBox.innerHTML = `<div class="hint">—</div>`;
    } else {
      pmBox.innerHTML = `
        <div class="miniList">
          ${arr
            .map(
              (x) => `
            <div class="miniList__row">
              <span class="miniList__label">${esc(t(`pay.method.${String(x.method || "other").toLowerCase()}`, String(x.method || "other")))}</span>
              <strong class="miniList__value">${fmtEUR(x.total)}</strong>
            </div>`
            )
            .join("")}
        </div>
      `;
    }
  }
}

/* -------------------------------------------------------
   Visuals rendering (metrics format)
------------------------------------------------------- */
let _supportTicketFilter = "active";

function renderVisuals({ legacy, metrics, support }) {
  const visuals = ensureDashboardVisualSlots();
  if (!visuals) return;

  // Le cockpit de gestion et le suivi Support doivent rester disponibles même
  // si l’ERP historique ne fournit pas encore les séries avancées.
  metrics = metrics || {};

  const titleYear = metrics?.year || new Date().getFullYear();

  const annualTargetHt = n(metrics?.target?.annual_target_ht, 0);
  const caRecognizedHt = n(metrics?.ytd?.recognized?.ca_recognized_ht_ytd, n(legacy?.ca_recognized_ht, 0));
  const pctTarget = annualTargetHt > 0 ? caRecognizedHt / annualTargetHt : 0;

  const depIssued = n(legacy?.deposits?.issued_ttc, 0);
  const depPaid = n(legacy?.deposits?.paid_ttc, 0);
  const depWait = n(legacy?.deposits?.waiting_ttc, Math.max(0, depIssued - depPaid));
  const pctDep = depIssued > 0 ? depPaid / depIssued : 0;

  const cashMonthly = Array.isArray(metrics?.series?.cash_monthly) ? metrics.series.cash_monthly : [];
  const months = cashMonthly.map((r) => String(r.ym || ""));
  const cashSeries = cashMonthly.map((r) => n(r.cash_total, 0));
  const cashRows = cashMonthly.filter((row) => Math.abs(n(row.cash_total, 0)) > .001);
  const latestCashMonth = cashRows.length ? String(cashRows[cashRows.length - 1].ym || "") : "—";

  const recognizedMonthly = Array.isArray(metrics?.series?.recognized_ht_monthly) ? metrics.series.recognized_ht_monthly : [];
  const recognizedSeries = recognizedMonthly.map((row) => n(row.recognized_ht, 0));
  const revenueRows = recognizedMonthly.filter((row) => Math.abs(n(row.recognized_ht, 0)) > .001);
  const latestRevenueMonth = revenueRows.length ? String(revenueRows[revenueRows.length - 1].ym || "") : "—";
  const cashYtd = n(metrics?.ytd?.cash?.cash_total_ytd, 0);
  const outstanding = n(legacy?.receivables?.outstanding_ttc, 0);
  const overdue = n(legacy?.receivables?.overdue_ttc, 0);
  const overdueCount = n(legacy?.receivables?.overdue_count, 0);
  const missingDueCount = n(legacy?.receivables?.missing_due_count, 0);
  const missingDueAmount = n(legacy?.receivables?.missing_due_ttc, 0);
  const due30 = n(legacy?.receivables?.due_30_ttc, 0);
  const quoteConversion = n(legacy?.quotes?.conversion_rate, 0);
  const decidedQuotes = n(legacy?.quotes?.decision_count, n(legacy?.quotes?.counts?.accepted, 0) + n(legacy?.quotes?.counts?.rejected, 0));
  const allTickets = Array.isArray(support?.tickets) ? support.tickets : [];
  const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
  const statusOrder = { open: 0, in_progress: 1, waiting_customer: 2, resolved: 3, closed: 4 };
  const supportTickets = [...allTickets].sort((left, right) => {
    const closedDifference = Number(String(left.status || "") === "closed") - Number(String(right.status || "") === "closed");
    if (closedDifference) return closedDifference;
    const priority = n(priorityOrder[String(left.priority || "normal")], 9) - n(priorityOrder[String(right.priority || "normal")], 9);
    if (priority) return priority;
    const status = n(statusOrder[String(left.status || "open")], 9) - n(statusOrder[String(right.status || "open")], 9);
    if (status) return status;
    return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
  });
  const openTickets = supportTickets.filter((ticket) => String(ticket.status || "") !== "closed");
  const closedTickets = supportTickets.filter((ticket) => String(ticket.status || "") === "closed");
  const filteredTickets = _supportTicketFilter === "closed" ? closedTickets : _supportTicketFilter === "all" ? supportTickets : openTickets;
  const supportCounts = {
    open: openTickets.filter((ticket) => String(ticket.status || "") === "open").length,
    progress: openTickets.filter((ticket) => String(ticket.status || "") === "in_progress").length,
    waiting: openTickets.filter((ticket) => String(ticket.status || "") === "waiting_customer").length,
    urgent: openTickets.filter((ticket) => String(ticket.priority || "") === "urgent").length,
  };
  const statusLabels = { open: mt("statusOpen"), in_progress: mt("statusProgress"), waiting_customer: mt("statusWaiting"), resolved: mt("statusResolved"), closed: mt("statusClosed") };
  const priorityLabels = { urgent: mt("priorityUrgent"), high: mt("priorityHigh"), normal: mt("priorityNormal"), low: mt("priorityLow") };
  const supportSummary = support?.isAdmin ? `<div class="dashSupportSummary" aria-label="${esc(mt("supportAdmin"))}"><div><span>${esc(mt("statusOpen"))}</span><strong>${fmtInt(supportCounts.open)}</strong></div><div><span>${esc(mt("statusProgress"))}</span><strong>${fmtInt(supportCounts.progress)}</strong></div><div><span>${esc(mt("statusWaiting"))}</span><strong>${fmtInt(supportCounts.waiting)}</strong></div><div class="is-urgent"><span>${esc(mt("priorityUrgent"))}</span><strong>${fmtInt(supportCounts.urgent)}</strong></div></div>` : "";
  const supportFilters = `<div class="dashSupportFilters" aria-label="${esc(mt("ticketDisplay"))}">${["active", "closed", "all"].map((filter) => `<button type="button" data-support-filter="${filter}" class="${_supportTicketFilter === filter ? "is-active" : ""}">${esc(mt(`filter${filter[0].toUpperCase()}${filter.slice(1)}`))}<span>${fmtInt(filter === "active" ? openTickets.length : filter === "closed" ? closedTickets.length : supportTickets.length)}</span></button>`).join("")}</div>`;
  const visibleTickets = filteredTickets.slice(0, support?.isAdmin ? 8 : 6);
  const ticketRows = visibleTickets.map((ticket) => {
    const priority = ["urgent", "high", "normal", "low"].includes(String(ticket.priority)) ? String(ticket.priority) : "normal";
    const status = ["open", "in_progress", "waiting_customer", "resolved", "closed"].includes(String(ticket.status)) ? String(ticket.status) : "open";
    return '<button class="dashTicket priority-' + esc(priority) + '" type="button" data-support-ticket="' + esc(ticket.id) + '">'
      + '<span class="dashTicket__identity"><strong>' + esc(ticket.number) + '</strong><small>' + esc(ticket.companyName || "") + '</small></span>'
      + '<span class="dashTicket__subject"><b>' + esc(ticket.subject) + '</b><small>' + esc(mt("requester")) + ' : ' + esc(ticket.requesterName || ticket.contactEmail || "—") + '</small></span>'
      + '<span class="dashTicket__badges"><em class="priority-' + esc(priority) + '">' + esc(priorityLabels[priority]) + '</em><small class="status-' + esc(status) + '">' + esc(statusLabels[status]) + '</small></span>'
      + '<time><small>' + esc(mt("updated")) + '</small>' + esc(fmtTicketDate(ticket.updatedAt)) + '</time>'
      + '<span class="dashTicket__action">' + esc(support?.isAdmin ? mt("handle") : mt("open")) + '<b aria-hidden="true">→</b></span>'
      + '</button>';
  }).join("");

  visuals.innerHTML = `
    <div class="card dashHero card--accent">
      <div class="dashHero__top">
        <div>
          <div class="card__title">${esc(t("dashboard.targetVsRevenueTitle", "Objectif annuel vs CA réalisé (HT)"))}</div>
          <div class="hint">${esc(tf("dashboard.targetVsRevenueHint", { year: titleYear }, `Suivi ${titleYear} — CA reconnu (factures finales émises – avoirs).`))}</div>
        </div>
        <div class="dashHero__money">
          <div class="dashHero__moneyMain">${fmtEUR(caRecognizedHt)}</div>
          <div class="dashHero__moneySub">${esc(t("dashboard.target", "objectif"))}: <strong>${fmtEUR(annualTargetHt)}</strong></div>
        </div>
      </div>

      <div class="dashHero__progress">
        ${progressBar({
          pct: pctTarget,
          labelLeft: `${(clamp(pctTarget, 0, 1) * 100).toFixed(0)}%`,
          labelRight:
            annualTargetHt > 0
              ? `${t("dashboard.remaining", "reste")}: ${fmtEUR(Math.max(0, annualTargetHt - caRecognizedHt))}`
              : t("dashboard.targetUndefined", "objectif non défini"),
        })}
      </div>

      <div class="dashHero__row">
        <div class="dashPanel">
          <div class="dashPanel__title">${esc(t("dashboard.depositsTitle", "Acomptes encaissés vs attente (TTC)"))}</div>
          <div class="dashPanel__content">
            <div class="dashDonut">
              ${svgDonut({ pct: pctDep, color: "var(--accent2)" })}
              <div class="dashDonut__center">
                <div class="dashDonut__pct">${(clamp(pctDep, 0, 1) * 100).toFixed(0)}%</div>
                <div class="dashDonut__sub">${esc(t("dashboard.paid", "encaissé"))}</div>
              </div>
            </div>

            <div class="dashStats">
              <div class="dashStat">
                <div class="dashStat__label">${esc(t("dashboard.issued", "Émis"))}</div>
                <div class="dashStat__value">${fmtEUR(depIssued)}</div>
              </div>
              <div class="dashStat">
                <div class="dashStat__label">${esc(t("dashboard.paid", "Encaissé"))}</div>
                <div class="dashStat__value">${fmtEUR(depPaid)}</div>
              </div>
              <div class="dashStat">
                <div class="dashStat__label">${esc(t("dashboard.waiting", "En attente"))}</div>
                <div class="dashStat__value">${fmtEUR(depWait)}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="dashPanel">
          <div class="dashPanel__title">${esc(t("dashboard.cashMonthlyTitle", "Encaissements (YTD) — par mois"))}</div>
          <div class="dashPanel__content">
            <div class="dashMiniChart">
              ${svgBars({
                values: cashSeries,
                height: 72,
                color: "var(--cyan)",
                label: t("dashboard.cashMonthlyTitle", "Encaissements mensuels"),
              })}
            </div>
            <div class="dashMiniLegend">
              <span class="chip">${esc(t("dashboard.max", "max"))}</span> ${fmtEUR(Math.max(0, ...cashSeries.map((x) => n(x, 0))))}
              <span class="chip">${esc(t("dashboard.month", "mois"))}</span> ${esc(latestCashMonth)}
            </div>
          </div>
        </div>

        <div class="dashPanel">
          <div class="dashPanel__title">${esc(t("dashboard.recognizedMonthlyTitle", "CA reconnu (YTD) — par mois"))}</div>
          <div class="dashPanel__content">
            <div class="dashMiniChart">
              ${svgBars({
                values: recognizedSeries,
                height: 72,
                color: "var(--accent)",
                label: t("dashboard.recognizedMonthlyTitle", "CA reconnu par mois"),
              })}
            </div>
            <div class="dashMiniLegend">
              <span class="chip">${esc(t("dashboard.max", "max"))}</span> ${fmtEUR(Math.max(0, ...recognizedSeries))}
              <span class="chip">${esc(t("dashboard.month", "mois"))}</span> ${esc(latestRevenueMonth)}
            </div>
          </div>
        </div>
      </div>
    </div>

    <section class="card dashManagement">
      <header class="dashSectionHead"><div><div class="card__title">${esc(mt("management"))}</div><div class="hint">${titleYear}</div></div></header>
      <div class="dashManagementGrid">
        <div class="dashManagementKpi is-cash"><span>${esc(mt("cash"))}</span><strong>${fmtEUR(cashYtd)}</strong><small>${esc(t("dashboard.cashMonthlyTitle", "Encaissements par mois"))}</small></div>
        <button type="button" class="dashManagementKpi" data-open-module="payments"><span>${esc(mt("outstanding"))}</span><strong>${fmtEUR(outstanding)}</strong><small>${esc(mt("due30"))}: ${fmtEUR(due30)}</small></button>
        <button type="button" class="dashManagementKpi is-alert" data-open-module="payments"><span>${esc(mt("overdue"))}</span><strong>${fmtEUR(overdue)}</strong><small>${fmtInt(overdueCount)} ${esc(mt("overdueInvoices"))}${missingDueCount ? ` · ${fmtInt(missingDueCount)} ${esc(mt("missingDueDate"))} (${fmtEUR(missingDueAmount)})` : ""}</small></button>
        <button type="button" class="dashManagementKpi" data-open-module="quotes"><span>${esc(mt("conversion"))}</span><strong>${(clamp(quoteConversion, 0, 1) * 100).toFixed(0)}%</strong><small>${fmtInt(decidedQuotes)} ${esc(mt("decidedQuotes"))}</small></button>
      </div>
    </section>

    <section class="card dashSupportCard">
      <header class="dashSectionHead"><div><div class="card__title">${esc(support?.isAdmin ? mt("supportAdmin") : mt("supportCustomer"))}</div><div class="hint">${esc(support?.isAdmin ? mt("supportLeadAdmin") : mt("supportLeadCustomer"))}</div></div><div><span class="dashSupportCount">${fmtInt(openTickets.length)}</span><button type="button" class="dashPrimaryAction" data-support-ticket="">${esc(support?.isAdmin ? mt("viewQueue") : `+  ${mt("newTicket")}`)}</button></div></header>
      ${supportSummary}
      ${supportFilters}
      <div class="dashTicketList">${ticketRows || `<p class="dashEmpty">${esc(_supportTicketFilter === "closed" ? mt("noClosedTickets") : mt("noTickets"))}</p>`}</div>
    </section>
  `;
  visuals.onclick = (event) => {
    const element = event.target instanceof Element ? event.target.closest("[data-open-module], [data-support-ticket], [data-support-filter]") : null;
    if (!element) return;
    const supportFilter = element.getAttribute("data-support-filter");
    if (supportFilter && ["active", "closed", "all"].includes(supportFilter)) {
      _supportTicketFilter = supportFilter;
      renderVisuals({ legacy, metrics, support });
      return;
    }
    const moduleName = element.getAttribute("data-open-module");
    if (moduleName) {
      q(`#navModules [data-module="${CSS.escape(moduleName)}"]`)?.click();
      return;
    }
    if (element.hasAttribute("data-support-ticket")) {
      window.parent.postMessage({ type: "d2f-open-support", ticketId: element.getAttribute("data-support-ticket") || "" }, window.location.origin);
    }
  };
}

/* -------------------------------------------------------
   Refresh (robust)
------------------------------------------------------- */
let _refreshing = false;

async function refreshDashboard({ force = false } = {}) {
  const page = q('.page[data-page="dashboard"]');
  if (!page) return;
  if (!force && !isDashboardActive()) return;
  if (_refreshing) return;

  _refreshing = true;

  const visuals = ensureDashboardVisualSlots();
  if (visuals) {
    visuals.innerHTML = `
      <div class="card dashHero">
        <div class="card__title">${esc(t("dashboard.title", "Dashboard"))}</div>
        <div class="hint">${esc(t("dashboard.loading", "Chargement…"))}</div>
      </div>
    `;
  }

  try {
    const data = await fetchDashboardData();
    if (data?.legacy) renderLegacy(data.legacy);
    renderVisuals({ legacy: data?.legacy, metrics: data?.metrics, support: data?.support });
    const status = document.getElementById("appStatus");
    if (status) status.textContent = t("status.ready", "Prêt");

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (typeof window.resizeDashboardCharts === "function") {
          try {
            window.resizeDashboardCharts();
          } catch {}
        }
      });
    });
  } catch (e) {
    console.error("[dashboard] refresh failed", e);
    const status = document.getElementById("appStatus");
    if (status) status.textContent = t("dashboard.error", "Erreur");
    if (visuals) {
      visuals.innerHTML = `
        <div class="card dashHero">
          <div class="card__title">${esc(t("dashboard.title", "Dashboard"))}</div>
          <div class="hint" style="color: rgba(239,68,68,.95);">${esc(t("dashboard.error", "Erreur"))}: ${esc(e?.message || e)}</div>
        </div>
      `;
    }
  } finally {
    _refreshing = false;
  }
}

/* -------------------------------------------------------
   Hooks (nav + mutation + IPC + locale change)
------------------------------------------------------- */
let _mo = null;
let _unsubCompany = null;
let _unsubInvalidate = null;
let _unsubLocale = null;
let _supportMessageHandler = null;

function hookDashboardAutoRefresh() {
  if (_supportMessageHandler) window.removeEventListener("message", _supportMessageHandler);
  _supportMessageHandler = (event) => {
    if (event.origin !== window.location.origin || event.data?.type !== "d2f-support-updated") return;
    refreshDashboard({ force: true });
  };
  window.addEventListener("message", _supportMessageHandler);

  const nav = q("#navModules");
  if (nav) {
    nav.addEventListener("click", () => {
      setTimeout(() => refreshDashboard({ force: true }), 0);
    });
  }

  const page = q('.page[data-page="dashboard"]');
  if (page) {
    _mo = new MutationObserver(() => {
      if (isDashboardActive()) refreshDashboard({ force: true });
    });
    _mo.observe(page, { attributes: true, attributeFilter: ["class", "style", "hidden"] });
  }

  if (window?.api?.on) {
    if (_unsubCompany) _unsubCompany();
    if (_unsubInvalidate) _unsubInvalidate();
    if (_unsubLocale) _unsubLocale();

    _unsubCompany = window.api.on("company:updated", () => refreshDashboard({ force: true }));
    _unsubInvalidate = window.api.on("dashboard:invalidate", () => refreshDashboard({ force: true }));

    // optionnel : si ton app émet un event i18n quand la langue change
    _unsubLocale = window.api.on("i18n:changed", () => refreshDashboard({ force: true }));
  }

  window.d2fDashboardRefresh = () => refreshDashboard({ force: true });
}

document.addEventListener("DOMContentLoaded", () => {
  hookDashboardAutoRefresh();
  setTimeout(() => refreshDashboard({ force: true }), 0);
});
