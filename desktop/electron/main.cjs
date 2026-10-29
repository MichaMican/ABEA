// ABEA desktop – Electron main process.
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  shell,
  screen,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";
const devServerUrl = process.env.ABEA_DEV_SERVER_URL;
const distDir = path.join(__dirname, "..", "dist");
const APP_ORIGIN = "app://abea";

const BACKGROUND = { light: "#f4f5fa", dark: "#0b0d14" };

app.setName("ABEA");
if (isWindows) app.setAppUserModelId("app.abea.desktop");

// The renderer is served from a privileged custom scheme (instead of file://) so that fetch(),
// WebAssembly (Matrix Rust crypto), IndexedDB and service-style origins behave like on the web.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/** @type {BrowserWindow | null} */
let mainWindow = null;

// ---- Window state persistence ----------------------------------------------------------------

const stateFile = () => path.join(app.getPath("userData"), "window-state.json");

function loadWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    const visible = screen.getAllDisplays().some((d) => {
      const b = d.workArea;
      return state.x >= b.x - 50 && state.y >= b.y - 50 && state.x < b.x + b.width && state.y < b.y + b.height;
    });
    return visible ? state : { width: state.width, height: state.height, maximized: state.maximized };
  } catch {
    return { width: 1240, height: 820 };
  }
}

function saveWindowState(win) {
  try {
    const bounds = win.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...bounds, maximized: win.isMaximized() }));
  } catch {
    // Not critical.
  }
}

// ---- Window ------------------------------------------------------------------------------------

function createWindow() {
  const state = loadWindowState();
  const dark = nativeTheme.shouldUseDarkColors;

  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width ?? 1240,
    height: state.height ?? 820,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: "ABEA",
    backgroundColor: dark ? BACKGROUND.dark : BACKGROUND.light,
    icon: path.join(__dirname, "..", "build", "icon.png"),
    autoHideMenuBar: !isMac,
    ...(isMac ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 18, y: 18 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  if (state.maximized) mainWindow.maximize();
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // Links opened with target=_blank go to the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });

  // Only allow top-level navigation within the app and to http(s) pages (needed for SSO login,
  // which redirects back to the app origin). Everything else is blocked.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = url.startsWith(APP_ORIGIN) || (devServerUrl && url.startsWith(devServerUrl)) || /^https?:\/\//.test(url);
    if (!allowed) event.preventDefault();
  });

  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(["notifications", "clipboard-sanitized-write", "media", "fullscreen"].includes(permission));
  });

  for (const ev of ["resize", "move", "close"]) {
    mainWindow.on(ev, () => mainWindow && saveWindowState(mainWindow));
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
  }
}

function focusMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function openExternal(url) {
  if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
}

// ---- Menu --------------------------------------------------------------------------------------

function buildMenu() {
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "About Matrix", click: () => openExternal("https://matrix.org/docs/chat_basics/matrix-for-im/") },
        { label: "Matrix Specification", click: () => openExternal("https://spec.matrix.org/latest/") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- Badge -------------------------------------------------------------------------------------

/** Renders a small red badge with the unread count, used as Windows taskbar overlay. */
function badgeImage(count) {
  const label = count > 99 ? "99+" : String(count);
  const fontSize = label.length > 2 ? 9 : 11;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">
    <circle cx="10" cy="10" r="10" fill="#f43f5e"/>
    <text x="10" y="14" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="${fontSize}" fill="#fff">${label}</text>
  </svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

function setBadgeCount(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (isWindows) {
    if (!mainWindow) return;
    if (n > 0) {
      const img = badgeImage(n);
      mainWindow.setOverlayIcon(img.isEmpty() ? null : img, `${n} unread`);
    } else {
      mainWindow.setOverlayIcon(null, "");
    }
  } else {
    app.setBadgeCount(n);
  }
}

// ---- IPC ---------------------------------------------------------------------------------------

ipcMain.on("abea:open-external", (_e, url) => openExternal(String(url)));
ipcMain.on("abea:badge", (_e, count) => setBadgeCount(count));
ipcMain.on("abea:theme", (_e, theme) => {
  const dark = theme === "dark";
  nativeTheme.themeSource = dark ? "dark" : "light";
  mainWindow?.setBackgroundColor(dark ? BACKGROUND.dark : BACKGROUND.light);
});
ipcMain.on("abea:notify", (event, { id, title, body }) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: String(title), body: String(body), silent: false });
  n.on("click", () => {
    focusMainWindow();
    if (!event.sender.isDestroyed()) event.sender.send("abea:notification-click", id);
  });
  n.show();
});

// ---- App lifecycle -----------------------------------------------------------------------------

app.on("second-instance", () => focusMainWindow());

app.whenReady().then(() => {
  protocol.handle("app", (request) => {
    const { pathname } = new URL(request.url);
    const relative = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
    const filePath = path.normalize(path.join(distDir, relative));
    // Prevent path traversal outside of the bundled renderer.
    if (!filePath.startsWith(distDir + path.sep)) {
      return new Response("Not found", { status: 404 });
    }
    const target = fs.existsSync(filePath) ? filePath : path.join(distDir, "index.html");
    return net.fetch(pathToFileURL(target).toString());
  });

  buildMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else focusMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
