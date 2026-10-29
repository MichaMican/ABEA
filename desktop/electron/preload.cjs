// ABEA desktop – preload script. Exposes a minimal, safe API to the renderer.
const { contextBridge, ipcRenderer } = require("electron");

let nextId = 1;
/** @type {Map<number, () => void>} */
const clickHandlers = new Map();

ipcRenderer.on("abea:notification-click", (_event, id) => {
  const handler = clickHandlers.get(id);
  clickHandlers.delete(id);
  handler?.();
});

contextBridge.exposeInMainWorld("abeaDesktop", {
  platform: process.platform,
  openExternal: (url) => ipcRenderer.send("abea:open-external", String(url)),
  setBadgeCount: (count) => ipcRenderer.send("abea:badge", Number(count) || 0),
  setTheme: (theme) => ipcRenderer.send("abea:theme", theme === "dark" ? "dark" : "light"),
  notify: (title, body, onClick) => {
    const id = nextId++;
    if (typeof onClick === "function") {
      clickHandlers.set(id, onClick);
      // Avoid unbounded growth if notifications are never clicked.
      if (clickHandlers.size > 50) clickHandlers.delete(clickHandlers.keys().next().value);
    }
    ipcRenderer.send("abea:notify", { id, title: String(title), body: String(body) });
  },
});
