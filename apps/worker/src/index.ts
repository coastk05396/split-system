export { GroupLedger } from "./ledger.js";
import { app } from "./app.js";
import { commitAccountCleanups } from "./auth/account-cleanup.js";
import { createDb } from "./db/client.js";
import { productionDeps } from "./deps.js";
import { purgeExpired } from "./maintenance.js";
import type { Bindings } from "./env.js";
import { refreshRates } from "./rates/rates.js";

export type { AppType } from "./app.js";
export type { ErrorBody, ErrorCode } from "./errors.js";

export default {
  fetch: app.fetch,
  /** Daily Cron Trigger (wrangler.jsonc): clean-up, then caches the day's reference Exchange rates. */
  async scheduled(controller, env) {
    const db = createDb(env.DB);
    await purgeExpired(db, controller.scheduledTime);
    await commitAccountCleanups(env);
    await refreshRates(db, productionDeps.rateSource, controller.scheduledTime);
  },
} satisfies ExportedHandler<Bindings>;
