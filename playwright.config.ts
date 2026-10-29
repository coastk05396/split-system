import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    // The golden path is written against the Chinese interface; a headless browser would
    // otherwise report en-US and be shown English.
    locale: "zh-TW",
    baseURL: "http://[::1]:8787",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      testMatch: "**/golden-paths.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        },
      },
    },
    {
      name: "api",
      testMatch: "**/prod-config.spec.ts",
    },
  ],
  webServer: [
    {
      command:
        "pnpm --filter @split/worker exec wrangler dev --port 8787 --ip ::1 --persist-to /tmp/wrangler-e2e-8787 --var TEST_SIGN_IN:1 --var SESSION_SIGNING_KEY:local-session-signing-key-minimum-32-chars-long",
      url: "http://[::1]:8787/api/v1/health",
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
    },
    {
      // The production configuration: TEST_SIGN_IN is pinned off here so an `apps/worker/.dev.vars`
      // from `pnpm dev` (which turns it on) cannot leak into this instance.
      command:
        "pnpm --filter @split/worker exec wrangler dev --port 8788 --ip ::1 --persist-to /tmp/wrangler-e2e-8788 --var TEST_SIGN_IN:0 --var SESSION_SIGNING_KEY:local-session-signing-key-minimum-32-chars-long",
      url: "http://[::1]:8788/api/v1/health",
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
    },
  ],
});
