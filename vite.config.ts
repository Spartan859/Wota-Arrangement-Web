import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const apiProxyTarget =
  process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  base: "/",
  server: {
    proxy: {
      "/api": apiProxyTarget,
    },
  },
  optimizeDeps: { include: ["exceljs"] },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
  build: { chunkSizeWarningLimit: 1000 },
});
