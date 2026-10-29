import { newApi } from "./api.js";
import { authRoutes } from "./auth/routes.js";
import { type AppDeps, productionDeps } from "./deps.js";
import { expenseRoutes } from "./expenses/routes.js";
import { groupRoutes } from "./groups/routes.js";
import { lineRoutes } from "./line/routes.js";
import { rateRoutes } from "./rates/routes.js";
import { stopRoutes } from "./stops/routes.js";

/** Builds the API with its outside services; tests pass fakes. */
export function createApp(deps: AppDeps) {
  return newApi()
    .get("/health", (c) => c.json({ status: "ok" as const }, 200))
    .route("/", authRoutes(deps))
    .route("/", groupRoutes(deps))
    .route("/", expenseRoutes(deps))
    .route("/", rateRoutes(deps))
    .route("/", stopRoutes(deps))
    .route("/", lineRoutes(deps));
}

export const app = createApp(productionDeps);

/** Route types for the SPA's typed client (`hc<AppType>`). */
export type AppType = typeof app;
