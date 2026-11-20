import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workerDirectory = resolve(scriptDirectory, "../../worker");
const persistenceDirectory = join(workerDirectory, ".wrangler", "playwright-state");
const wranglerEntryPoint = join(workerDirectory, "node_modules", "wrangler", "bin", "wrangler.js");

if (!process.env.CLOUDFLARE_API_TOKEN?.trim()) {
  throw new Error(
    "Set CLOUDFLARE_API_TOKEN with Workers AI access before running the live AI E2E suite.",
  );
}

await rm(persistenceDirectory, { recursive: true, force: true });
await mkdir(dirname(persistenceDirectory), { recursive: true });

const worker = spawn(
  process.execPath,
  [
    wranglerEntryPoint,
    "dev",
    "--config",
    "wrangler.compose.jsonc",
    "--ip",
    "127.0.0.1",
    "--port",
    "8787",
    "--persist-to",
    persistenceDirectory,
  ],
  {
    cwd: workerDirectory,
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit",
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => worker.kill(signal));
}

worker.on("error", (error) => {
  console.error("Could not start Wrangler for Playwright:", error);
  process.exitCode = 1;
});

worker.on("exit", async (code, signal) => {
  await rm(persistenceDirectory, { recursive: true, force: true });
  process.exitCode = code ?? (signal ? 1 : 0);
});
