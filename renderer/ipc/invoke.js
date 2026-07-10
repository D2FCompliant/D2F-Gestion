// renderer/ipc/invoke.js
export async function invoke(channel, ...args) {
  // Mode WEB (navigateur)
  if (typeof window !== "undefined" && !window?.electron?.ipcRenderer) {
    const r = await fetch("http://localhost:3000/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: channel, args }),
    });
    const json = await r.json();
    if (!json.ok) throw new Error(json.error || "RPC error");
    return json.result;
  }

  // Mode ELECTRON
  // (adapte selon comment tu exposes ipcRenderer dans preload)
  return window.electron.ipcRenderer.invoke(channel, ...args);
}
