import type { CapacitorConfig } from "@capacitor/cli";
import type { KeyboardResize } from "@capacitor/keyboard";

const config: CapacitorConfig = {
  appId: "app.abea.messenger",
  appName: "ABEA",
  webDir: "dist",
  backgroundColor: "#f4f5fa",
  ios: {
    contentInset: "never",
  },
  plugins: {
    SystemBars: {
      insetsHandling: "css",
      style: "DEFAULT",
    },
    Keyboard: {
      resize: "native" as KeyboardResize,
      resizeOnFullScreen: true,
    },
    LocalNotifications: {
      smallIcon: "ic_stat_abea",
      iconColor: "#6a6dff",
    },
  },
};

export default config;
