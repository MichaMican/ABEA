// Starts the Vite dev server for the renderer and launches Electron pointing at it.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

const server = await createServer({ root, configFile: `${root}/vite.config.ts` });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? "http://localhost:5174/";
server.printUrls();

const electronBinary = require("electron");
const child = spawn(electronBinary, ["."], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, ABEA_DEV_SERVER_URL: url },
});
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
