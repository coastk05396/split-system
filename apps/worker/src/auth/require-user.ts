import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../api.js";
import { ApiError } from "../errors.js";
import { verifyAccessToken } from "./tokens.js";

export interface SignedInEnv {
  Bindings: AppEnv["Bindings"];
  Variables: AppEnv["Variables"] & { userId: string };
}

/**
 * Requires `Authorization: Bearer <access token>` and sets `userId`. Only the JWT is
 * checked, never the database, so a token stays valid for its hour after logout.
 */
export function requireUser(now: () => number) {
  return createMiddleware<SignedInEnv>(async (c, next) => {
    const match = /^Bearer (\S+)$/.exec(c.req.header("Authorization") ?? "");
    const userId =
      match?.[1] === undefined
        ? null
        : await verifyAccessToken(match[1], c.env.SESSION_SIGNING_KEY, now());
    if (userId === null) throw new ApiError("UNAUTHORIZED");
    c.set("userId", userId);
    await next();
  });
}
