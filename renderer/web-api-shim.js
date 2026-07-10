// renderer/web-api-shim.js
(function () {
  // Si on est dans Electron et que preload a déjà injecté window.api, on ne touche à rien.
  if (window.api) return;

  async function rpc(method, ...args) {
    const r = await fetch("/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, args }),
    });
    const json = await r.json();
    if (!json.ok) throw new Error(json.error || "RPC error");
    return json.result;
  }

  // Helper: fabrique un namespace qui mappe directement sur les méthodes IPC
  function ns(prefix) {
    return new Proxy(
      {},
      {
        get(_t, prop) {
          if (typeof prop !== "string") return undefined;
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
    quotes: ns("quotes"),
    clients: ns("clients"),
    invoices: ns("invoices"),
    items: ns("items"),
    payments: ns("payments"),
    inbound: ns("inbound"),
    company: ns("company"),
    connections: ns("connections"),
    conformity: ns("conformity"),
    pdf: ns("pdf"),

    // pour i18n old-style (si ton front appelle window.api.i18n.load)
    i18n: ns("i18n"),
    files: ns("files"),
    audit: ns("audit"),
  };

  console.log("✅ web-api-shim actif : window.api.* -> /rpc");
})();
