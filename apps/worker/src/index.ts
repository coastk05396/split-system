import { app } from "./app.js";
import { createDb } from "./db/client.js";
import { productionDeps } from "./deps.js";
import type { Bindings } from "./env.js";
import { refreshRates } from "./rates/rates.js";

export type { AppType } from "./app.js";
export type { ErrorBody, ErrorCode } from "./errors.js";

export default {
  fetch: app.fetch,
  /** Daily Cron Trigger (wrangler.jsonc): caches the day's reference Exchange rates. */
  async scheduled(controller, env) {
    await refreshRates(createDb(env.DB), productionDeps.rateSource, controller.scheduledTime);
  },
} satisfies ExportedHandler<Bindings>;
