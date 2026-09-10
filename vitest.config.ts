import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mirrors the "@/*" path alias from tsconfig.json so tests can import runtime modules.
export default defineConfig({
  test: {
    // Network-backed smoke tests are run explicitly, never as part of `npm test`.
    exclude: ["**/node_modules/**", "**/lib/analysis/live-smoke.spec.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
