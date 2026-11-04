import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../api.js";
import { ApiError } from "../errors.js";
import { bearerToken } from "./bearer-token.js";
import type { Provider } from "./identity-verifier.js";
import { verifyAccess } from "./tokens.js";

export interface SignedInEnv {
  Bindings: AppEnv["Bindings"];
  Variables: AppEnv["Variables"] & { userId: string; signedInWith: Provider | null };
}

/**
 * Requires `Authorization: Bearer <access token>` and sets `userId`. Only the JWT is
 * checked, never the database, so a token stays valid for its hour after logout.
 */
export function requireUser(now: () => number) {
  return createMiddleware<SignedInEnv>(async (c, next) => {
    const token = bearerToken(c.req.header("Authorization"));
    const access =
      token === undefined ? null : await verifyAccess(token, c.env.SESSION_SIGNING_KEY, now());
    if (access === null) throw new ApiError("UNAUTHORIZED");
    c.set("userId", access.userId);
    c.set("signedInWith", access.provider);
    await next();
  });
}
