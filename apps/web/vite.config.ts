import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// `pnpm --filter @split/worker dev` serves the API on 8787; Vite proxies to it in dev.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { "/api": "http://localhost:8787" },
  },
  build: {
    manifest: true,
    rolldownOptions: {
      // @split/shared is pure (apart from its Web Worker entries): an eager import of
      // formatAmount must not pull its Zod schemas into the first-load chunk.
      treeshake: {
        moduleSideEffects: (id) => !id.includes("/packages/shared/src/") || id.includes(".worker."),
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
  },
});
