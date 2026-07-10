"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Trouve le fichier i18n:
 * - DEV: <projectRoot>/renderer/i18n/<lang>.json
 * - PROD (packagé): <resourcesPath>/i18n/<lang>.json
 *
 * En mode serveur, process.resourcesPath n'est pas garanti comme dans Electron,
 * donc on le garde en option et on priorise projectRoot si dispo.
 */
function resolveI18nFilePath({ projectRoot, lang }) {
  const l = String(lang || "fr").toLowerCase();

  const devPath = projectRoot
    ? path.join(projectRoot, "renderer", "i18n", `${l}.json`)
    : path.join(__dirname, "..", "..", "renderer", "i18n", `${l}.json`);

  const resourcesBase = typeof process.resourcesPath === "string" ? process.resourcesPath : null;
  const prodPath = resourcesBase ? path.join(resourcesBase, "i18n", `${l}.json`) : null;

  if (prodPath && fs.existsSync(prodPath)) return prodPath;
  return devPath;
}

module.exports = (ipcMain, getDb) => {
  // getDb est fourni par le loader; non utilisé ici.
  void getDb;

  // On déduit projectRoot depuis le chemin du fichier ipc:
  // .../<projectRoot>/Electron/ipc/i18n.ipc.js -> remonter 3 niveaux => <projectRoot>
  const projectRoot = path.join(__dirname, "..", "..", "..");

  ipcMain.handle("i18n:load", async (_e, lang) => {
    const filePath = resolveI18nFilePath({ projectRoot, lang });

    if (!fs.existsSync(filePath)) {
      throw new Error(`Fichier i18n introuvable: ${filePath}`);
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  });
};
