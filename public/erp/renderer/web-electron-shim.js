// renderer/web-electron-shim.js
(function () {
  // Si on est dans Electron, preload déjà présent => ne rien faire
  if (window.electron && window.electron.ipcRenderer) return;

  const listeners = new Map(); // channel -> Set(callback)

  async function rpc(method, args) {
    const r = await fetch("/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, args }),
    });
    const json = await r.json();
    if (!json.ok) throw new Error(json.error || "RPC error");
    return json.result;
  }

  function emit(channel, ...args) {
    const set = listeners.get(channel);
    if (!set) return;
    for (const cb of set) {
      try {
        cb({}, ...args); // signature type Electron: (event, ...args)
      } catch (e) {
        console.error("[shim ipcRenderer.on] listener error", channel, e);
      }
    }
  }

  window.electron = {
    ipcRenderer: {
      // API principale
      invoke: (channel, ...args) => rpc(channel, args),

      // Certains fronts utilisent send + on (pattern event)
      send: async (channel, ...args) => {
        // on exécute la RPC, puis on émet un éventuel retour sur `${channel}:reply`
        const result = await rpc(channel, args);
        emit(`${channel}:reply`, result);
        return result;
      },

      on: (channel, cb) => {
        if (!listeners.has(channel)) listeners.set(channel, new Set());
        listeners.get(channel).add(cb);
        return () => listeners.get(channel)?.delete(cb);
      },

      removeAllListeners: (channel) => {
        if (channel) listeners.delete(channel);
        else listeners.clear();
      },

      // utile pour debug éventuel
      _emit: emit,
    },
  };

  console.log("✅ web-electron-shim actif (mode navigateur)");
})();
