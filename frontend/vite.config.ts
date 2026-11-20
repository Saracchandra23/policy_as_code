import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const workerOrigin = loadEnv(mode, ".", "VITE_").VITE_PROXY_TARGET || "http://127.0.0.1:8787";
  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": { target: workerOrigin, changeOrigin: true },
        "/access": { target: workerOrigin, changeOrigin: true },
        "/.well-known": { target: workerOrigin, changeOrigin: true },
      },
    },
  };
});
