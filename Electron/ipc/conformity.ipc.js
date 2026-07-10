"use strict";

/**
 * Conformité = E-REPORTING (ne pas mélanger avec e-invoicing).
 * Stockage: company.use_case_meta_json.conformity (fiche société).
 *
 * API IPC:
 * - conformity:getConfig
 * - conformity:saveConfig
 * - conformity:rebuildPeriod
 * - conformity:sendNow (placeholder enqueue)
 * - conformity:openQueue (event)
 * - conformity:openSettings (event)
 *
 * Multi-pays:
 * - config.jurisdiction = "FR" | "BE" | ... | "DEFAULT"
 * - rules engine: ./conformity/rules
 */

const { getRulesForJurisdiction, normalizeJurisdiction } = require("./conformity/rules");

// -------------------- Helpers JSON --------------------
function safeJsonParse(str, fallback = {}) {
  try {
    if (!str) return fallback;
    return typeof str === "string" ? JSON.parse(str) : (str || fallback);
  } catch {
    return fallback;
  }
}

function safeJsonStringify(obj) {
  try {
    return JSON.stringify(obj ?? {});
  } catch {
    return "{}";
  }
}

// -------------------- Normalizers --------------------
function normScope(v) {
  return String(v || "FR").toUpperCase() === "INTL" ? "INTL" : "FR";
}

function normPeriodicity(v) {
  const p = String(v || "M").toUpperCase();
  return ["D", "M", "B"].includes(p) ? p : "M";
}

function defaultConfig() {
  return {
    scope: "FR",               // FR | INTL (legacy UI)
    jurisdiction: "FR",        // FR | DEFAULT | (autres pays)
    periodicity: "M",          // D | M | B

    archiving: "ON",           // ON | OFF
    platform: "",              // legacy (ancien champ)
    platform_name: "",         // NEW: nom plateforme (PA/solution)
    platform_kind: "PA",       // NEW: "PA" | "SC" | "OTHER"

    next_due: "",              // ISO yyyy-mm-dd

    emits_b2c: 0,
    has_international: 0,

    kpis: { flux8: 0, flux9: 0, flux10: 0 },
  };
}

function normalizeConfig(input) {
  const p = input && typeof input === "object" ? input : {};
  const base = defaultConfig();

  const scope = normScope(p.scope ?? base.scope);

  // Jurisdiction : si absent, déduit depuis scope
  const jurisdictionRaw = p.jurisdiction ?? (scope === "FR" ? "FR" : "DEFAULT");
  const jurisdiction = String(jurisdictionRaw || "DEFAULT").toUpperCase();

  // Platform fields
  const kind = String(p.platform_kind ?? base.platform_kind ?? "PA").toUpperCase();
  const platform_kind = ["PA", "SC", "OTHER"].includes(kind) ? kind : "PA";

  // Nom de plateforme : préfère platform_name, sinon legacy platform
  const platform_name = String(p.platform_name ?? p.platform ?? base.platform_name ?? "");

  const out = {
    ...base,
    ...p,

    scope,
    jurisdiction,

    periodicity: normPeriodicity(p.periodicity ?? base.periodicity),
    archiving: String(p.archiving || base.archiving).toUpperCase() === "OFF" ? "OFF" : "ON",

    // legacy + new
    platform: String(p.platform ?? base.platform ?? ""),
    platform_name,
    platform_kind,

    next_due: String(p.next_due ?? base.next_due ?? ""),

    emits_b2c: Number(p.emits_b2c ?? base.emits_b2c) === 1 ? 1 : 0,
    has_international: Number(p.has_international ?? base.has_international) === 1 ? 1 : 0,

    kpis: {
      ...base.kpis,
      ...(p.kpis || {}),
    },
  };

  out.kpis = {
    flux8: Number(out.kpis.flux8 || 0) || 0,
    flux9: Number(out.kpis.flux9 || 0) || 0,
    flux10: Number(out.kpis.flux10 || 0) || 0,
  };

  return out;
}


// -------------------- DB access --------------------
function readCompanyMeta(db) {
  try {
    const row = db.prepare("SELECT use_case_meta_json FROM company WHERE id=1").get();
    return safeJsonParse(row?.use_case_meta_json, {});
  } catch {
    return {};
  }
}

function writeCompanyMeta(db, meta) {
  const json = safeJsonStringify(meta || {});
  const updatedAt = new Date().toISOString();
  try {
    return db
      .prepare("UPDATE company SET use_case_meta_json=?, updated_at=? WHERE id=1")
      .run(json, updatedAt);
  } catch {
    return null;
  }
}

function readCompanyVatRegime(db) {
  try {
    const row = db.prepare("SELECT vat_regime FROM company WHERE id=1").get();
    return String(row?.vat_regime || "").toUpperCase();
  } catch {
    return "";
  }
}

// -------------------- Engine glue --------------------
function computeNextDueWithRules({ rules, cfg, ctx }) {
  // rules.computeNextDue({ cfg, ctx }) doit renvoyer yyyy-mm-dd
  try {
    const due = rules.computeNextDue({ cfg, ctx });
    return String(due || "");
  } catch {
    return "";
  }
}

function computeDerivedWithRules({ rules, cfg, ctx }) {
  // rules.derive({ cfg, ctx }) peut forcer periodicity, etc.
  try {
    const derived = rules.derive({ cfg, ctx });
    return derived && typeof derived === "object" ? derived : {};
  } catch {
    return {};
  }
}

// -------------------- Module export --------------------
module.exports = function registerConformityIpc(ipcMain, getDbFn) {
  if (typeof getDbFn !== "function") {
    throw new Error("conformity.ipc.js: getDbFn manquant (doit être passé depuis main.js)");
  }

  const db = () => getDbFn();

  function getStoredConfigRaw() {
    const meta = readCompanyMeta(db());
    return normalizeConfig(meta?.conformity || {});
  }

  function saveStoredConfig(patch) {
    const meta = readCompanyMeta(db());
    const cur = normalizeConfig(meta?.conformity || {});
    const incoming = patch && typeof patch === "object" ? patch : {};

    // Merge + normalize
    const merged = normalizeConfig({
      ...cur,
      ...incoming,
      kpis: { ...cur.kpis, ...((incoming && incoming.kpis) || {}) },
    });

    // Rules selection (par jurisdiction)
    const rules = getRulesForJurisdiction(merged.jurisdiction);

    const ctx = {
      vat_regime: readCompanyVatRegime(db()),
      now: new Date(),
    };

    // Derived fields: ex FR force periodicity selon TVA
    const derived = computeDerivedWithRules({ rules, cfg: merged, ctx });

    const finalCfg = normalizeConfig({
      ...merged,
      ...derived,
    });

    // Si next_due absent, on calcule via rules
    if (!finalCfg.next_due) {
      const computed = computeNextDueWithRules({ rules, cfg: finalCfg, ctx });
      if (computed) finalCfg.next_due = computed;
    }

    meta.conformity = finalCfg;
    writeCompanyMeta(db(), meta);
    return finalCfg;
  }

  // -------------------- IPC handlers --------------------
  ipcMain.handle("conformity:getConfig", async () => {
    const cur = getStoredConfigRaw();

    // Patch: si next_due vide, calcul + persist
    if (!cur.next_due) {
      return saveStoredConfig({ next_due: "" }); // force recalcul via rules
    }

    return cur;
  });

  ipcMain.handle("conformity:saveConfig", async (_e, payload) => {
    return saveStoredConfig(payload);
  });

  /**
   * Recalcule periodicity + next_due via rules.
   * - FR: periodicity dérivée de la TVA (dans rules/FR.js)
   * - Autres: fallback DEFAULT (ou futur pays)
   */
  ipcMain.handle("conformity:rebuildPeriod", async (_e, payload) => {
    const cur = getStoredConfigRaw();

    const incoming = payload && typeof payload === "object" ? payload : {};
    const scope = normScope(incoming.scope ?? cur.scope);

    // Migration: si UI met INTL, on bascule juridiction DEFAULT sauf si payload.jurisdiction fourni
    const jurisdiction = normalizeJurisdiction(
      incoming.jurisdiction ??
        (scope === "FR" ? "FR" : "DEFAULT") ??
        cur.jurisdiction
    );

    // periodicityWanted est utile pour les pays qui laissent choisir
    const periodicityWanted = normPeriodicity(incoming.periodicity ?? cur.periodicity);

    const draft = normalizeConfig({
      ...cur,
      ...incoming,
      scope,
      jurisdiction,
      periodicity: periodicityWanted,
      next_due: "", // force recalcul
    });

    const saved = saveStoredConfig(draft);

    return {
      ok: true,
      jurisdiction: saved.jurisdiction,
      next_due: saved.next_due,
      periodicity: saved.periodicity,
      kpis: saved.kpis,
      message: `Période recalculée (${saved.jurisdiction}/${saved.periodicity}).`,
    };
  });

  // Placeholder: déclenche l’envoi e-reporting (Flux 8/9/10)
  ipcMain.handle("conformity:sendNow", async (_e, payload) => {
    const cur = getStoredConfigRaw();
    const incoming = payload && typeof payload === "object" ? payload : {};

    const scope = normScope(incoming.scope ?? cur.scope);
    const jurisdiction = normalizeJurisdiction(
      incoming.jurisdiction ?? cur.jurisdiction ?? (scope === "FR" ? "FR" : "DEFAULT")
    );
    const periodicity = normPeriodicity(incoming.periodicity ?? cur.periodicity);

    const emitsB2C = Number(cur.emits_b2c || 0) === 1;
    const hasIntl = Number(cur.has_international || 0) === 1;

    // Garde tes règles métier actuelles
    if (scope === "FR" && !emitsB2C && !hasIntl) {
      return { ok: false, message: "E-reporting non requis (pas de B2C, pas d’international)." };
    }
    if (scope === "INTL" && !hasIntl) {
      return {
        ok: false,
        message: "Mode International sélectionné, mais la société n’a pas d’activité internationale.",
      };
    }

    // TODO: brancher la vraie logique d’enqueue (flux8/9/10)
    const queued = { flux8: 0, flux9: 0, flux10: 0 };

    // Persist + assure next_due non vide (rules)
    const saved = saveStoredConfig({
      scope,
      jurisdiction,
      periodicity,
      next_due: cur.next_due || "",
      kpis: { ...cur.kpis, ...queued },
    });

    return {
      ok: true,
      jurisdiction: saved.jurisdiction,
      scope: saved.scope,
      periodicity: saved.periodicity,
      queued,
      next_due: saved.next_due,
      message: "Envoi déclenché.",
    };
  });

  // UI hooks (renderer décide quoi faire)
  ipcMain.handle("conformity:openQueue", async (e) => {
    try {
      e.sender.send("conformity:openQueueRequested", { ok: true });
    } catch {}
    return { ok: true };
  });

  ipcMain.handle("conformity:openSettings", async (e) => {
    try {
      e.sender.send("conformity:openSettingsRequested", { ok: true });
    } catch {}
    return { ok: true };
  });
};
