// renderer/web-api-shim.js
(function () {
  // Si on est dans Electron et que preload a déjà injecté window.api, on ne touche à rien.
  if (window.api) return;

  const downloadCache = new Map();

  function signalActivity() {
    try { window.parent?.postMessage({ type: "d2f-activity" }, window.location.origin); } catch {}
  }

  ["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
    window.addEventListener(eventName, signalActivity, { passive: true });
  });

  async function rpc(method, ...args) {
    signalActivity();
    const r = await fetch("/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, args }),
    });
    const json = await r.json();
    if (!json.ok) throw new Error(json.error || "RPC error");
    const result = json.result;
    if (result?.downloadBase64) downloadBase64(result.downloadBase64, result.mimeType || "application/octet-stream", result.fileName || result.filename || "document");
    return result;
  }

  function downloadBase64(base64, mimeType, fileName) {
    downloadCache.set(fileName, { base64, mimeType });
    const binary = atob(String(base64 || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function chooseFile({ accept = "*/*", asDataUrl = false } = {}) {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = accept;
      input.style.display = "none";
      input.addEventListener("change", async () => {
        try {
          const file = input.files?.[0];
          input.remove();
          if (!file) return resolve({ canceled: true });
          if (file.size > 10 * 1024 * 1024) throw new Error("Le fichier dépasse la taille maximale de 10 Mo");
          const buffer = await file.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = "";
          for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
          const contentBase64 = btoa(binary);
          const dataUrl = `data:${file.type || "application/octet-stream"};base64,${contentBase64}`;
          let text = "";
          if (/xml|json|csv|text/i.test(file.type) || /\.(xml|json|csv|txt)$/i.test(file.name)) text = new TextDecoder().decode(bytes);
          resolve({ ok: true, name: file.name, filename: file.name, mimeType: file.type, size: file.size, contentBase64, text, dataUrl, path: asDataUrl ? dataUrl : file.name });
        } catch (error) {
          input.remove();
          reject(error);
        }
      }, { once: true });
      document.body.appendChild(input);
      input.click();
    });
  }

  async function sendEmail(payload) {
    const cached = downloadCache.get(payload?.attachmentPath) || downloadCache.get(payload?.attachmentName);
    const result = await rpc("email:send", cached ? { ...payload, attachmentBase64: cached.base64, attachmentMimeType: cached.mimeType } : payload);
    if (result?.requiresClientMail) {
      const url = `mailto:${encodeURIComponent(payload?.to || "")}?subject=${encodeURIComponent(payload?.subject || "")}&body=${encodeURIComponent(payload?.text || "")}`;
      window.location.href = url;
      return { ...result, ok: true, mode: "mailto", prepared: true };
    }
    return result;
  }

  // Helper: fabrique un namespace qui mappe directement sur les méthodes IPC
  function ns(prefix, overrides = {}) {
    return new Proxy(
      overrides,
      {
        get(target, prop) {
          if (typeof prop !== "string") return undefined;
          if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
          // ex: window.api.quotes.list(...) -> RPC "quotes:list"
          return (...args) => rpc(`${prefix}:${prop}`, ...args);
        },
      }
    );
  }

  // IMPORTANT:
  // - Ici on suppose que ton app appelle window.api.quotes.list / get / create / update / setStatus etc.
  // - Si chez toi les noms diffèrent, on adaptera après 1 log.
  window.api = {
    invoke: (channel, payload) => rpc(channel, payload),
    on: () => () => {},
    off: () => {},
    dashboard: ns("dashboard"),
    quotes: ns("quotes"),
    clients: ns("clients"),
    invoices: ns("invoices"),
    items: ns("items"),
    payments: ns("payments"),
    inbound: ns("inbound", { importFile: async () => {
      const selected = await chooseFile({ accept: ".xml,.json,.pdf,application/xml,application/json,application/pdf" });
      if (selected?.canceled) return selected;
      return rpc("inbound:importFile", selected);
    } }),
    company: ns("company"),
    connections: ns("connections"),
    conformity: ns("conformity"),
    email: ns("email", { send: sendEmail }),
    pdf: ns("pdf"),
    exports: ns("exports"),

    // pour i18n old-style (si ton front appelle window.api.i18n.load)
    i18n: ns("i18n"),
    files: ns("files", {
      pickImage: () => chooseFile({ accept: "image/png,image/jpeg,image/webp", asDataUrl: true }),
    }),
    audit: ns("audit"),
    rejectionReasons: ns("xpReject"),
    xpReject: ns("xpReject"),
  };

  console.log("✅ web-api-shim actif : window.api.* -> /rpc");
})();
