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
  const max = Math.max(1, ...v);
  const w = 8;
  const gap = 6;
  const totalW = v.length * w + (v.length - 1) * gap;
  const viewW = Math.max(totalW, 1);

  const bars = v
    .map((val, i) => {
      const h = Math.round((val / max) * height);
      const x = i * (w + gap);
      const y = height - h;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${color}" opacity="${val > 0 ? 1 : 0.25}"></rect>`;
    })
    .join("");

  return `
  <svg class="bars" viewBox="0 0 ${viewW} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">
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

async function fetchDashboardData() {
  const [legacy, metrics] = await Promise.all([fetchDashboardGet(), fetchDashboardMetrics()]);
  if (!legacy && !metrics) return { ok: false, error: "No dashboard data" };
  return { ok: true, legacy, metrics };
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
function renderVisuals({ legacy, metrics }) {
  const visuals = ensureDashboardVisualSlots();
  if (!visuals) return;

  if (!metrics) {
    visuals.innerHTML = `
      <div class="card dashHero">
        <div class="card__title">${esc(t("dashboard.visuals", "Visuels"))}</div>
        <div class="hint">${esc(t("dashboard.noMetrics", "Les métriques avancées ne sont pas disponibles. Les KPIs restent OK."))}</div>
      </div>
    `;
    return;
  }

  const titleYear = metrics?.year || new Date().getFullYear();

  const annualTargetHt = n(metrics?.target?.annual_target_ht, 0);
  const caRecognizedHt = n(legacy?.ca_recognized_ht, 0);
  const pctTarget = annualTargetHt > 0 ? caRecognizedHt / annualTargetHt : 0;

  const depIssued = n(legacy?.deposits?.issued_ttc, 0);
  const depPaid = n(legacy?.deposits?.paid_ttc, 0);
  const depWait = n(legacy?.deposits?.waiting_ttc, Math.max(0, depIssued - depPaid));
  const pctDep = depIssued > 0 ? depPaid / depIssued : 0;

  const cashMonthly = Array.isArray(metrics?.series?.cash_monthly) ? metrics.series.cash_monthly : [];
  const months = cashMonthly.map((r) => String(r.ym || ""));
  const cashSeries = cashMonthly.map((r) => n(r.cash_total, 0));

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
              <span class="chip">${esc(t("dashboard.month", "mois"))}</span> ${months.length ? esc(months[months.length - 1]) : "—"}
            </div>
          </div>
        </div>

        <div class="dashPanel">
          <div class="dashPanel__title">${esc(t("dashboard.recognizedMonthlyTitle", "CA reconnu (YTD) — par mois"))}</div>
          <div class="dashPanel__content">
            <div class="hint">${esc(t("dashboard.recognizedMonthlyNotAvailable", "Non disponible via dashboard:metrics (utilise dashboard:get pour le total YTD)."))}</div>
          </div>
        </div>
      </div>
    </div>
  `;
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
    renderVisuals({ legacy: data?.legacy, metrics: data?.metrics });
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

function hookDashboardAutoRefresh() {
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
