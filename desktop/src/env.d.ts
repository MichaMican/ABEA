/** API exposed by electron/preload.cjs via contextBridge. */
interface AbeaDesktopBridge {
  platform: "darwin" | "win32" | "linux" | string;
  openExternal(url: string): void;
  setBadgeCount(count: number): void;
  setTheme(theme: "light" | "dark"): void;
  notify(title: string, body: string, onClick: () => void): void;
}

interface Window {
  abeaDesktop?: AbeaDesktopBridge;
}
