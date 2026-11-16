export { GroupLedger } from "./ledger.js";
import { app } from "./app.js";
import { runScheduled } from "./maintenance.js";
import type { Bindings } from "./env.js";

export type { AppType } from "./app.js";
export type { ErrorBody, ErrorCode } from "./errors.js";

export default {
  fetch: app.fetch,
  /** Cron Triggers (wrangler.jsonc): 16:30 UTC cleanup+FX, 00:00 UTC (08:00 Taipei) daily flights. */
  async scheduled(controller, env) {
    await runScheduled(controller.cron, env, controller.scheduledTime);
  },
} satisfies ExportedHandler<Bindings>;
