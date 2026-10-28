import { app } from "./app.js";
import type { Bindings } from "./env.js";

export type { AppType } from "./app.js";

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Bindings>;
