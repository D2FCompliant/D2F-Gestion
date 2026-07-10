"use strict";

/**
 * i18n-runtime.js (offline + Electron)
 * - Charge les dictionnaires via IPC: window.api.i18n.load(locale)
 * - Fournit t(), format money/date/number (Intl)
 * - Persiste la langue via localStorage
 */

(function () {
  const SUPPORTED = ["fr", "en", "sr", "es", "it"];
  const FALLBACK = "fr";
  const LS_KEY = "d2f.ui.locale";

  let locale = FALLBACK;
  let dict = {};
  const listeners = new Set();

  function getApi() {
    return window.api || window.d2f || null;
  }

  function normLocale(x) {
    const base = String(x || "").toLowerCase().split(/[-_]/)[0];
    return SUPPORTED.includes(base) ? base : FALLBACK;
  }

  function t(key, vars = {}) {
    const raw = (dict && dict[key]) || key;
    return String(raw).replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? `{${k}}` : String(vars[k])));
  }

  function getLocale() {
    return locale;
  }

  function saveLocale(l) {
    try {
      localStorage.setItem(LS_KEY, l);
    } catch {}
  }

  function loadSavedLocale() {
    try {
      return localStorage.getItem(LS_KEY);
    } catch {
      return null;
    }
  }

  async function setLocale(next) {
    const api = getApi();
    if (!api?.i18n?.load) throw new Error("API i18n absente (preload non chargé).");

    const wanted = normLocale(next);
    const data = await api.i18n.load(wanted);

    locale = wanted;
    dict = data || {};
    saveLocale(locale);

    for (const fn of listeners) {
      try {
        fn(locale);
      } catch {}
    }
  }

  async function init() {
    const saved = loadSavedLocale();
    const sys = normLocale(navigator.language || FALLBACK);
    const start = normLocale(saved || sys);
    await setLocale(start);
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function money(amount, currency = "EUR") {
    const v = Number(amount || 0) || 0;
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency }).format(v);
    } catch {
      return `${v.toFixed(2)} ${currency}`;
    }
  }

  function number(x) {
    const v = Number(x || 0) || 0;
    try {
      return new Intl.NumberFormat(locale).format(v);
    } catch {
      return String(v);
    }
  }

  function dateISO(iso) {
    const s = String(iso || "").slice(0, 10);
    if (!s) return "—";
    const d = new Date(s + "T00:00:00");
    try {
      return new Intl.DateTimeFormat(locale).format(d);
    } catch {
      return s;
    }
  }

  window.I18N = {
    SUPPORTED,
    t,
    init,
    setLocale,
    getLocale,
    onChange,
    money,
    number,
    dateISO,
  };
})();
