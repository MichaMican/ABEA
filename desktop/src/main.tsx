import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, type PlatformAdapter } from "@abea/shared";
import "@abea/shared/styles.css";

const bridge = window.abeaDesktop;
const os = bridge?.platform === "darwin" ? "mac" : bridge?.platform === "win32" ? "windows" : "linux";

const platform: PlatformAdapter = {
  kind: "desktop",
  os,
  insetTitleBar: os === "mac",
  supportsSsoRedirect: true,
  openExternal: bridge ? (url) => bridge.openExternal(url) : undefined,
  setBadgeCount: bridge ? (count) => bridge.setBadgeCount(count) : undefined,
  onThemeChange: bridge ? (theme) => bridge.setTheme(theme) : undefined,
  notify: bridge ? (title, body, onClick) => bridge.notify(title, body, onClick) : undefined,
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App platform={platform} />
  </StrictMode>,
);
