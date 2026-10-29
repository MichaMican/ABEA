import { readFileSync } from "node:fs";
import type { UserConfig } from "vite";

const rootPkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

/** Vite settings shared by every ABEA variant (web, desktop renderer, mobile). */
export function abeaViteDefaults(): UserConfig {
  return {
    define: {
      __ABEA_VERSION__: JSON.stringify(rootPkg.version),
    },
    optimizeDeps: {
      // The Rust crypto WASM bundle loads its .wasm via import.meta.url; pre-bundling breaks that.
      exclude: ["@matrix-org/matrix-sdk-crypto-wasm"],
    },
    build: {
      target: "es2022",
      chunkSizeWarningLimit: 4096,
    },
    worker: { format: "es" },
  };
}
