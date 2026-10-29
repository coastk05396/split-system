import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // Tests apply the real migrations to an in-memory D1 in test/apply-migrations.ts.
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          // A fresh key per run; real keys live in Worker secrets and the untracked .dev.vars.
          SESSION_SIGNING_KEY: Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join(""),
          // Ensure tests test production defaults regardless of local .dev.vars
          TEST_SIGN_IN: "0",
        },
      },
    })),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
