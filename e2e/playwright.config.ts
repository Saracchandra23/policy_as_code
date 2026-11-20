import { defineConfig } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const e2eDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(e2eDirectory, "..");
const workerStartupScript = resolve(e2eDirectory, "scripts/start-worker.mjs");
const viteEntryPoint = resolve(repositoryRoot, "frontend/node_modules/vite/bin/vite.js");
const node = quoteArgument(process.execPath);
const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:5173";
const useExistingServices = Boolean(process.env.E2E_BASE_URL);

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: useExistingServices ? undefined : [
    {
      command: "go run ./cmd/server",
      cwd: resolve(repositoryRoot, "opa-service"),
      url: "http://127.0.0.1:8080/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `${node} ${quoteArgument(workerStartupScript)}`,
      cwd: e2eDirectory,
      url: "http://127.0.0.1:8787/.well-known/authzen-configuration",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `${node} ${quoteArgument(viteEntryPoint)} --host 127.0.0.1 --port 5173 --strictPort`,
      cwd: resolve(repositoryRoot, "frontend"),
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});

function quoteArgument(value: string): string {
  if (process.platform === "win32") return `"${value.replaceAll('"', '\\"')}"`;
  return `'${value.replaceAll("'", "'\\''")}'`;
}
