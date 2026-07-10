"use strict";

const FR = require("./FR");
const DEFAULT = require("./DEFAULT");

function normalizeJurisdiction(v) {
  const s = String(v || "").trim().toUpperCase();
  if (!s) return "DEFAULT";
  if (s === "INTL") return "DEFAULT";
  return s;
}

function getRulesForJurisdiction(jurisdiction) {
  const j = normalizeJurisdiction(jurisdiction);
  if (j === "FR") return FR;
  return DEFAULT;
}

module.exports = {
  normalizeJurisdiction,
  getRulesForJurisdiction,
};
