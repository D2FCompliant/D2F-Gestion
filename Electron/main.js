// Electron/main.js
"use strict";

const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, ipcMain, session } = require("electron");
const { getDb, migrate } = require("./db");

let mainWindow = null;

// -------------------- Resources resolver (DEV + PROD) --------------------
function resolveResourcePath(relPath) {
  // 1) PROD packagé (extraResources)
  const pProd = path.join(process.resourcesPath, relPath);
  if (fs.existsSync(pProd)) return pProd;

  // 2) DEV: dans le projet (recommandé)
  const pDev1 = path.join(app.getAppPath(), "Electron", "resources", relPath);
  if (fs.existsSync(pDev1)) return pDev1;

  // 3) DEV fallback: à côté de main.js
  const pDev2 = path.join(__dirname, "resources", relPath);
  if (fs.existsSync(pDev2)) return pDev2;

  return null;
}

// -------------------- Static resources (packaged) --------------------

// XP Z12-012 rejection reasons JSON
ipcMain.handle("xpReject:load", async () => {
  const filename = "rejection-reasons.xp-z12-012.v1.2.json";
  const p = resolveResourcePath(filename);
  if (!p) {
    throw new Error(
      `XP reject JSON introuvable. Testés:\n- ${path.join(process.resourcesPath, filename)}\n- ${path.join(
        app.getAppPath(),
        "Electron",
        "resources",
        filename
      )}\n- ${path.join(__dirname, "resources", filename)}\n`
    );
  }
  return JSON.parse(fs.readFileSync(p, "utf-8"));
});

// i18n dictionaries (FR/EN/SR/ES/IT)
ipcMain.handle("i18n:load", async (_e, { locale } = {}) => {
  const base = String(locale || "fr").toLowerCase().split(/[-_]/)[0];
  const safe = ["fr", "en", "sr", "es", "it"].includes(base) ? base : "fr";

  const rel = path.join("i18n", `${safe}.json`);
  const p = resolveResourcePath(rel);

  if (!p) {
    throw new Error(
      `i18n introuvable: ${rel}. Testés:\n- ${path.join(process.resourcesPath, rel)}\n- ${path.join(
        app.getAppPath(),
        "Electron",
        "resources",
        rel
      )}\n- ${path.join(__dirname, "resources", rel)}\n`
    );
  }

  return JSON.parse(fs.readFileSync(p, "utf-8"));
});

// -------------------- IPC registration --------------------
function purgeRequireCache(filePath) {
  try {
    const resolved = require.resolve(filePath);
    delete require.cache[resolved];
  } catch {
    // ignore
  }
}

function safeRequireIpc(label, filePath, ...args) {
  try {
    purgeRequireCache(filePath);
    const mod = require(filePath);
    if (typeof mod !== "function") {
      throw new Error(`${label} n'exporte pas une fonction`);
    }
    mod(...args);
    console.log(`[IPC] loaded: ${label}`);
  } catch (e) {
    console.error(`[IPC] FAILED: ${label}`, e);

    // Retry 1x si EINTR (lecture interrompue)
    if (String(e?.message || "").includes("EINTR")) {
      console.warn(`[IPC] retry after EINTR: ${label}`);
      try {
        purgeRequireCache(filePath);
        const mod = require(filePath);
        if (typeof mod !== "function") {
          throw new Error(`${label} n'exporte pas une fonction (retry)`);
        }
        mod(...args);
        console.log(`[IPC] loaded after retry: ${label}`);
        return;
      } catch (e2) {
        console.error(`[IPC] retry FAILED: ${label}`, e2);
      }
    }

    throw e;
  }
}

function registerIpc(getDbFn) {
  const ipcDir = path.join(__dirname, "ipc");

  safeRequireIpc("company.ipc.js", path.join(ipcDir, "company.ipc.js"), ipcMain, getDbFn);
  safeRequireIpc("clients.ipc.js", path.join(ipcDir, "clients.ipc.js"), ipcMain, getDbFn);
  safeRequireIpc("items.ipc.js", path.join(ipcDir, "items.ipc.js"), ipcMain, getDbFn);
  safeRequireIpc("quotes.ipc.js", path.join(ipcDir, "quotes.ipc.js"), ipcMain, getDbFn);
  safeRequireIpc("invoices.ipc.js", path.join(ipcDir, "invoices.ipc.js"), ipcMain, getDbFn);
  safeRequireIpc("audit.ipc.js", path.join(ipcDir, "audit.ipc.js"), ipcMain);
  safeRequireIpc("payments.ipc.js", path.join(ipcDir, "payments.ipc.js"), ipcMain, getDbFn);
  safeRequireIpc("inbound.ipc.js", path.join(ipcDir, "inbound.ipc.js"), ipcMain, getDbFn);
  safeRequireIpc("conformity.ipc.js", path.join(ipcDir, "conformity.ipc.js"), ipcMain, getDbFn);
  safeRequireIpc("dashboard.ipc.js", path.join(ipcDir, "dashboard.ipc.js"), ipcMain, getDbFn);

  // PDF exports
  safeRequireIpc("pdf.ipc.js", path.join(ipcDir, "pdf.ipc.js"), ipcMain, getDbFn);

  // EMAIL
  safeRequireIpc("email.ipc.js", path.join(ipcDir, "email.ipc.js"), ipcMain, getDbFn);

  // files.ipc.js ne dépend pas de DB
  safeRequireIpc("files.ipc.js", path.join(ipcDir, "files.ipc.js"), ipcMain);
}

// -------------------- CSP --------------------
function buildCsp() {
  const connect = ["'self'"];

  // DEV
  if (process.env.ELECTRON_DEV === "1") {
    connect.push("http://localhost:*");
  }

  // SaaS (exemples)
  connect.push("https://api.d2f.com");
  connect.push("https://updates.d2f.com");

  // On-prem (exemples) — mets TON domaine intranet
  connect.push("https://intranet");

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: file:",
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

// -------------------- Window --------------------
function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Inject CSP headers (per-window)
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};
    headers["Content-Security-Policy"] = [buildCsp()];
    callback({ responseHeaders: headers });
  });

  // Anti-navigation (en plus de window.open)
  win.webContents.on("will-navigate", (e) => {
    e.preventDefault();
  });

  win.loadFile(path.join(__dirname, "index.html"));

  if (process.env.ELECTRON_DEV === "1") {
    win.webContents.openDevTools({ mode: "detach" });
  }

  return win;
}

// -------------------- App lifecycle --------------------
app.whenReady().then(() => {
  // ✅ OK après whenReady
  console.log("📦 Electron userData =", app.getPath("userData"));

  // Migrations DB
  try {
    migrate();
  } catch (e) {
    console.error("[DB] migrate FAILED", e);
    // selon ta stratégie, tu peux throw ici
    // throw e;
  }

  const getDbFn = () => getDb();
  registerIpc(getDbFn);

  // Permission requests (bloque par défaut)
  try {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
      callback(false);
    });
  } catch (e) {
    console.warn("[SEC] setPermissionRequestHandler failed", e);
  }

  mainWindow = createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Sécurité navigation / popups
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
});
