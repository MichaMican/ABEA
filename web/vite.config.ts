import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { abeaViteDefaults } from "../shared/vite.defaults.ts";

export default defineConfig({
  ...abeaViteDefaults(),
  plugins: [react()],
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
});
