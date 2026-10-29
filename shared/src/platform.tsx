import { createContext, useContext } from "react";

export type PlatformKind = "web" | "desktop" | "mobile";

/**
 * Each app variant (web, desktop, mobile) provides an adapter so the shared UI can use
 * native capabilities without depending on Electron or Capacitor directly.
 */
export interface PlatformAdapter {
  kind: PlatformKind;
  /** "mac" | "windows" | "linux" | "android" | "ios" | "web" */
  os: string;
  /** Opens a URL outside of the app (system browser). */
  openExternal?: (url: string) => void;
  /** Called whenever the effective color scheme changes (e.g. to tint native status bars). */
  onThemeChange?: (theme: "light" | "dark") => void;
  /** Total unread count, for dock / taskbar badges. */
  setBadgeCount?: (count: number) => void;
  /** Shows a system notification. Falls back to the Web Notification API when omitted. */
  notify?: (title: string, body: string, onClick: () => void) => void;
  /** Whether SSO login via full-page redirect is available. */
  supportsSsoRedirect?: boolean;
  /** Whether the window draws its own title bar area (macOS hidden inset title bar). */
  insetTitleBar?: boolean;
}

export const defaultPlatform: PlatformAdapter = { kind: "web", os: "web", supportsSsoRedirect: true };

export const PlatformContext = createContext<PlatformAdapter>(defaultPlatform);

export function usePlatform(): PlatformAdapter {
  return useContext(PlatformContext);
}
