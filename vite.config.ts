import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "/",
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
  optimizeDeps: { include: ["exceljs"] },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
  build: { chunkSizeWarningLimit: 1000 },
});
