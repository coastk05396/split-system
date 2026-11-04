import { newApi } from "./api.js";
import { bearerToken } from "./auth/bearer-token.js";
import { authRoutes } from "./auth/routes.js";
import { verifyAccessToken } from "./auth/tokens.js";
import { type AppDeps, productionDeps } from "./deps.js";
import { expenseRoutes } from "./expenses/routes.js";
import { groupRoutes } from "./groups/routes.js";
import { lineRoutes } from "./line/routes.js";
import { rateRoutes } from "./rates/routes.js";
import { settlementRoutes } from "./settlements/routes.js";
import { stopRoutes } from "./stops/routes.js";

/** Builds the API with its outside services; tests pass fakes. */
export function createApp(deps: AppDeps) {
  return newApi()
    .get("/health", (c) => c.json({ status: "ok" as const }, 200))
    .use("/groups/:id/*", async (c, next) => {
      // The ledger is only read for a signed-in Member, so a stranger can neither start
      // one by guessing a name nor learn from the header that a Group exists.
      let preFetchedRev: number | undefined;
      if (c.req.method === "GET" || c.req.method === "HEAD") {
        const id = c.req.param("id");
        const token = bearerToken(c.req.header("Authorization"));
        const userId =
          token === undefined
            ? null
            : await verifyAccessToken(token, c.env.SESSION_SIGNING_KEY, deps.now());
        const member =
          userId === null
            ? null
            : await c.env.DB.prepare(
                "SELECT 1 FROM group_member_summary WHERE group_id=? AND user_id=?",
              )
                .bind(id, userId)
                .first();
        if (member !== null) {
          try {
            const stub = c.env.GROUP_LEDGER.get(c.env.GROUP_LEDGER.idFromName(id));
            const response = await stub.fetch("https://ledger.internal/state");
            if (response.ok) {
              const data = await response.json<{ rev: number }>();
              preFetchedRev = data.rev;
            }
          } catch {
            /* ignore if DO not yet available */
          }
        }
      }
      await next();
      if (preFetchedRev !== undefined && c.res.ok && !c.res.headers.has("X-Group-Rev")) {
        c.header("X-Group-Rev", String(preFetchedRev));
      }
    })
    .route("/", authRoutes(deps))
    .route("/", groupRoutes(deps))
    .route("/", expenseRoutes(deps))
    .route("/", settlementRoutes(deps))
    .route("/", rateRoutes(deps))
    .route("/", stopRoutes(deps))
    .route("/", lineRoutes(deps));
}

export const app = createApp(productionDeps);

/** Route types for the SPA's typed client (`hc<AppType>`). */
export type AppType = typeof app;
