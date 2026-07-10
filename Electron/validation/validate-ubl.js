// Electron/validation/validate-ubl.js
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

let SaxonJS = null;
try {
  // pur JS, OK Electron
  SaxonJS = require("saxon-js");
} catch {
  SaxonJS = null;
}

function fileExists(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function dirExists(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Vérifie "well-formed XML".
 * - essaie xmllint si présent
 * - sinon check minimal (ne garantit pas 100%, mais évite faux positifs grossiers)
 */
function isWellFormedXml(xml) {
  const x = String(xml || "").trim();
  if (!x) return { ok: false, error: "XML vide" };

  // 1) try xmllint
  try {
    const r = spawnSync("xmllint", ["--noout", "-"], {
      input: x,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (r.error) {
      // xmllint absent -> fallback
    } else {
      if (r.status === 0) return { ok: true };
      return { ok: false, error: (r.stderr || "XML invalide").trim() };
    }
  } catch {
    // ignore
  }

  // 2) fallback minimal
  const looksXml = x.startsWith("<?xml") || /^<\w+[\s>]/.test(x);
  if (!looksXml) return { ok: false, error: "Ne ressemble pas à du XML" };

  // Vérif très légère de cohérence (pas un parseur)
  if (!x.includes(">") || !x.includes("<")) return { ok: false, error: "XML invalide" };

  return { ok: true, warning: "xmllint non disponible: vérification XML minimale appliquée" };
}

/**
 * Retour simple attendu par ton IPC:
 * { ok: boolean, errors: [], warnings: [] }
 */
function validateFile(filePath, options = {}) {
  const errors = [];
  const warnings = [];

  const p = String(filePath || "").trim();
  if (!p) return { ok: false, errors: ["validateFile: filePath manquant"], warnings };

  if (!fileExists(p)) return { ok: false, errors: [`Fichier introuvable: ${p}`], warnings };

  const maxBytes = Number(options.maxBytes || 2_000_000);
  const data = fs.readFileSync(p, "utf8");
  const xml = data.length > maxBytes ? data.slice(0, maxBytes) : data;

  if (data.length > maxBytes) {
    warnings.push(`Fichier volumineux: lecture partielle (${maxBytes} bytes)`);
  }

  const wf = isWellFormedXml(xml);
  if (!wf.ok) return { ok: false, errors: [wf.error], warnings };
  if (wf.warning) warnings.push(wf.warning);

  return { ok: true, errors: [], warnings };
}

/**
 * Validation Schematron via Saxon-JS.
 *
 * ⚠️ IMPORTANT:
 * Pour faire du Schematron, il faut un XSLT "précompilé" ou un SEF JSON.
 *
 * Le plus simple:
 * - tu places dans resourcesDir un fichier:
 *   - schematron.sef.json  (SEF produit par Saxon)
 * OU
 * - un xslt direct compatible XSLT 3:
 *   - schematron.xsl
 *
 * Ici on supporte:
 * - schematron.sef.json (recommandé)
 * - schematron.xsl
 */
function validateUblSchematron({ xml, resourcesDir } = {}) {
  const errors = [];
  const warnings = [];

  const wf = isWellFormedXml(xml);
  if (!wf.ok) return { ok: false, errors: [{ message: wf.error, code: "XML_NOT_WELLFORMED" }] };
  if (wf.warning) warnings.push(wf.warning);

  const rd = resourcesDir ? String(resourcesDir) : "";
  if (!rd || !dirExists(rd)) {
    warnings.push("resourcesDir absent/introuvable: Schematron non exécuté");
    return { ok: true, errors: [], warnings };
  }

  // Si Saxon-JS n’est pas installé, on ne crashe pas, mais on le signale.
  if (!SaxonJS) {
    warnings.push("saxon-js non installé: Schematron non exécuté (npm i saxon-js)");
    return { ok: true, errors: [], warnings };
  }

  const sefPath = path.join(rd, "schematron.sef.json");
  const xslPath = path.join(rd, "schematron.xsl");

  const hasSef = fileExists(sefPath);
  const hasXsl = fileExists(xslPath);

  if (!hasSef && !hasXsl) {
    warnings.push(
      "Schematron non exécuté: ajoute resources/schematron.sef.json (recommandé) ou resources/schematron.xsl"
    );
    return { ok: true, errors: [], warnings };
  }

  try {
    // Saxon-JS renvoie le résultat de la transformation (SVRL ou HTML selon xsl)
    // On s’attend idéalement à du SVRL (XML) pour extraire les failed-assert
    const result = SaxonJS.transform(
      hasSef
        ? {
            stylesheetFileName: sefPath,
            sourceText: String(xml),
            destination: "serialized",
          }
        : {
            stylesheetFileName: xslPath,
            sourceText: String(xml),
            destination: "serialized",
          }
    );

    const out = String(result?.principalResult || "").trim();
    if (!out) {
      warnings.push("Schematron: sortie vide (XSL/SEF?)");
      return { ok: true, errors: [], warnings };
    }

    // Parse ultra simple des failed-assert (SVRL)
    // On évite dépendance XML parser: regex.
    const failed = [];
    const re = /<svrl:failed-assert\b[\s\S]*?<\/svrl:failed-assert>/g;
    const items = out.match(re) || [];
    for (const block of items) {
      const textMatch = block.match(/<svrl:text[^>]*>([\s\S]*?)<\/svrl:text>/);
      const msg = textMatch ? textMatch[1].replace(/\s+/g, " ").trim() : "Schematron failed-assert";

      const locMatch = block.match(/\blocation="([^"]+)"/);
      const location = locMatch ? locMatch[1] : "";

      failed.push({ message: msg, location, code: "SCHEMATRON_ASSERT" });
    }

    if (failed.length) {
      return { ok: false, errors: failed, warnings };
    }

    return { ok: true, errors: [], warnings };
  } catch (e) {
    return {
      ok: false,
      errors: [{ message: `Schematron: erreur transform: ${e?.message || String(e)}`, code: "SCHEMATRON_ERROR" }],
      warnings,
    };
  }
}

module.exports = {
  validateFile,
  validateUblSchematron,
};
