import { newApi } from "./api.js";
import { authRoutes } from "./auth/routes.js";
import { type AppDeps, productionDeps } from "./deps.js";
import { groupRoutes } from "./groups/routes.js";

/** Builds the API with its outside services; tests pass fakes. */
export function createApp(deps: AppDeps) {
  return newApi()
    .get("/health", (c) => c.json({ status: "ok" as const }, 200))
    .route("/", authRoutes(deps))
    .route("/", groupRoutes(deps));
}

export const app = createApp(productionDeps);

/** Route types for the SPA's typed client (`hc<AppType>`). */
export type AppType = typeof app;
