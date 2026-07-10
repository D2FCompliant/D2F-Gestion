"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Détecte si on est dans un vrai process Electron (avec dialog dispo).
 * En mode serveur (node), ce sera faux.
 */
function tryGetElectronDialog() {
  try {
    // require dans try/catch pour ne pas crasher en mode node pur
    const electron = require("electron");
    return electron?.dialog || null;
  } catch {
    return null;
  }
}

function guessMimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

function readFileAsBase64Payload(filePath, { withMime = false } = {}) {
  const buf = fs.readFileSync(filePath);
  const payload = {
    path: filePath,
    name: path.basename(filePath),
    bytesBase64: buf.toString("base64"),
  };
  if (withMime) payload.mime = guessMimeFromPath(filePath);
  return payload;
}

/**
 * ✅ New style obligatoire : module.exports = (ipcMain, getDb) => { ... }
 */
module.exports = (ipcMain, getDb) => {
  void getDb;

  const dialog = tryGetElectronDialog();

  // Pick image and return { name, path, mime, bytesBase64 }
  ipcMain.handle("files:pickImage", async () => {
    if (!dialog) {
      // Mode serveur: pas de picker natif
      return {
        ok: false,
        error:
          "files:pickImage indisponible en mode serveur (node). Utiliser un upload HTTP côté web ou fournir un chemin via files:readPath.",
      };
    }

    const res = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });

    if (res.canceled || !res.filePaths?.length) return null;

    const filePath = res.filePaths[0];
    return { ok: true, ...readFileAsBase64Payload(filePath, { withMime: true }) };
  });

  // Generic picker
  ipcMain.handle("files:pickFile", async (_e, { filters } = {}) => {
    if (!dialog) {
      return {
        ok: false,
        error:
          "files:pickFile indisponible en mode serveur (node). Utiliser un upload HTTP côté web ou fournir un chemin via files:readPath.",
      };
    }

    const res = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: Array.isArray(filters) ? filters : undefined,
    });

    if (res.canceled || !res.filePaths?.length) return null;

    const filePath = res.filePaths[0];
    return { ok: true, ...readFileAsBase64Payload(filePath) };
  });

  /**
   * Alternative serveur/web: lire un fichier à partir d’un chemin fourni.
   * ⚠️ Attention sécurité: à restreindre (whitelist de dossiers) si exposé en prod.
   */
  ipcMain.handle("files:readPath", async (_e, { filePath, asImage = false } = {}) => {
    const p = String(filePath || "");
    if (!p) return { ok: false, error: "filePath requis" };
    if (!fs.existsSync(p)) return { ok: false, error: `Fichier introuvable: ${p}` };

    return {
      ok: true,
      ...readFileAsBase64Payload(p, { withMime: Boolean(asImage) }),
    };
  });
};
