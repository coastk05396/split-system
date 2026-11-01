import { Hono } from "hono";
import { routePath } from "hono/route";
import type { Bindings } from "./env.js";
import { ApiError, type ErrorCode } from "./errors.js";

export { ApiError, ERROR_STATUS, type ErrorBody, type ErrorCode } from "./errors.js";

export interface AppEnv {
  Bindings: Bindings;
  Variables: { requestId: string; errorCode: ErrorCode | undefined };
}

/**
 * A Hono app under `/api/v1` with request-ID logging, the shared error shape and the
 * JSON 404. Logs carry the route pattern, never the real path, headers or body.
 */
export function newApi() {
  return new Hono<AppEnv>({ strict: false })
    .onError((error, c) => {
      const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL");
      if (!(error instanceof ApiError)) {
        console.error(
          JSON.stringify({ requestId: c.get("requestId"), stack: error.stack ?? error.name }),
        );
      }
      c.set("errorCode", apiError.code);
      return c.json(apiError.toBody(), apiError.status, { ...apiError.headers });
    })
    .notFound((c) => {
      c.set("errorCode", "NOT_FOUND");
      return c.json(new ApiError("NOT_FOUND").toBody(), 404);
    })
    .use(async (c, next) => {
      const requestId = crypto.randomUUID();
      const started = Date.now();
      c.set("requestId", requestId);
      await next();
      c.header("X-Request-Id", requestId);
      const route = routePath(c, -1);
      console.log(
        JSON.stringify({
          requestId,
          method: c.req.method,
          route: route === "/*" ? "(unmatched)" : route,
          status: c.res.status,
          durationMs: Date.now() - started,
          errorCode: c.get("errorCode"),
        }),
      );
    })
    .use(async (c, next) => {
      const secret = c.env.MAINTENANCE;
      if (
        secret &&
        (c.req.path === "/api/v1" || c.req.path.startsWith("/api/v1/")) &&
        c.req.path !== "/api/v1/health" &&
        c.req.method !== "GET" &&
        c.req.method !== "HEAD" &&
        c.req.header("X-Maintenance-Bypass") !== secret
      )
        throw new ApiError("MAINTENANCE");
      await next();
    })
    .basePath("/api/v1");
}
