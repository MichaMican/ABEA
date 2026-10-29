import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { Keyboard, KeyboardStyle } from "@capacitor/keyboard";
import { LocalNotifications } from "@capacitor/local-notifications";
import { App, type PlatformAdapter } from "@abea/shared";
import "@abea/shared/styles.css";

const native = Capacitor.isNativePlatform();
const os = Capacitor.getPlatform(); // "android" | "ios" | "web"

// ---- Hardware back button (Android) ----------------------------------------------------------
// The shared UI listens for the cancellable "abea:back" event and navigates one level up.
// When nothing handled it we are at the root screen, so the app is minimized like native apps.
if (native) {
  void CapApp.addListener("backButton", () => {
    const event = new Event("abea:back", { cancelable: true });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) void CapApp.minimizeApp().catch(() => CapApp.exitApp());
  });

  // Keep the composer visible while the software keyboard is open.
  void Keyboard.addListener("keyboardDidShow", () => {
    document.documentElement.classList.add("keyboard-open");
    (document.activeElement as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });
  });
  void Keyboard.addListener("keyboardDidHide", () => document.documentElement.classList.remove("keyboard-open"));
}

// ---- Local notifications ---------------------------------------------------------------------

let notificationId = 1;
const clickHandlers = new Map<number, () => void>();
let permission: "unknown" | "granted" | "denied" = "unknown";

async function ensureNotificationPermission(): Promise<boolean> {
  if (permission !== "unknown") return permission === "granted";
  try {
    let status = await LocalNotifications.checkPermissions();
    if (status.display === "prompt" || status.display === "prompt-with-rationale") {
      status = await LocalNotifications.requestPermissions();
    }
    permission = status.display === "granted" ? "granted" : "denied";
  } catch {
    permission = "denied";
  }
  return permission === "granted";
}

if (native) {
  void LocalNotifications.addListener("localNotificationActionPerformed", ({ notification }) => {
    const handler = clickHandlers.get(notification.id);
    clickHandlers.delete(notification.id);
    handler?.();
  });
}

// ---- Platform adapter ------------------------------------------------------------------------

const platform: PlatformAdapter = {
  kind: "mobile",
  os,
  supportsSsoRedirect: !native,
  onThemeChange: (theme) => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0b0d14" : "#f4f5fa");
    if (!native) return;
    // "Dark" = light icons for dark backgrounds.
    void SystemBars.setStyle({ style: theme === "dark" ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
    if (os === "ios") void Keyboard.setStyle({ style: theme === "dark" ? KeyboardStyle.Dark : KeyboardStyle.Light }).catch(() => {});
  },
  notify: native
    ? (title, body, onClick) => {
        void ensureNotificationPermission().then((granted) => {
          if (!granted) return;
          const id = notificationId++;
          clickHandlers.set(id, onClick);
          if (clickHandlers.size > 50) clickHandlers.delete(clickHandlers.keys().next().value!);
          void LocalNotifications.schedule({ notifications: [{ id, title, body }] });
        });
      }
    : undefined,
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App platform={platform} />
  </StrictMode>,
);
