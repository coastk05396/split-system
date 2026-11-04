export { GroupLedger } from "./ledger.js";
import { app } from "./app.js";
import { dailyMaintenance } from "./maintenance.js";
import type { Bindings } from "./env.js";

export type { AppType } from "./app.js";
export type { ErrorBody, ErrorCode } from "./errors.js";

export default {
  fetch: app.fetch,
  /** Daily Cron Trigger (wrangler.jsonc): clean-up, then caches the day's reference Exchange rates. */
  async scheduled(controller, env) {
    await dailyMaintenance(env, controller.scheduledTime);
  },
} satisfies ExportedHandler<Bindings>;
