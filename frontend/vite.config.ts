import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const workerOrigin = "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: workerOrigin, changeOrigin: true },
      "/access": { target: workerOrigin, changeOrigin: true },
      "/.well-known": { target: workerOrigin, changeOrigin: true },
    },
  },
});
