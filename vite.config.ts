import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  optimizeDeps: { include: ["exceljs"] },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
  build: { chunkSizeWarningLimit: 1000 },
});
