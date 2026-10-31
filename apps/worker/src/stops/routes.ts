import { stopInputSchema, stopListQuerySchema, stopPatchSchema } from "@split/shared";
import { Hono } from "hono";
import type { AppEnv } from "../api.js";
import { requireUser } from "../auth/require-user.js";
import { createDb } from "../db/client.js";
import type { AppDeps } from "../deps.js";
import { ApiError, ERROR_STATUS, type ErrorCode } from "../errors.js";
import { requireMember } from "../groups/membership.js";
import { parseBody, requireIfMatch } from "../request-guards.js";
import type { Bindings } from "../env.js";

async function stopRequest(
  env: Bindings,
  groupId: string,
  operation: object,
): Promise<{ value: unknown; rev: string }> {
  const ledger = env.GROUP_LEDGER.get(env.GROUP_LEDGER.idFromName(groupId));
  const response = await ledger.fetch("https://ledger.internal/stop-op", {
    method: "POST",
    body: JSON.stringify(operation),
  });
  const result: unknown = await response.json();
  if (typeof result !== "object" || result === null) throw new ApiError("INTERNAL");
  if (!response.ok) {
    if (
      "error" in result &&
      typeof result.error === "string" &&
      Object.hasOwn(ERROR_STATUS, result.error)
    )
      throw new ApiError(
        result.error as ErrorCode,
        "details" in result ? result.details : undefined,
      );
    throw new ApiError("INTERNAL");
  }
  const rev = response.headers.get("X-Group-Rev");
  if (rev === null) throw new ApiError("INTERNAL");
  return { value: "value" in result ? result.value : undefined, rev };
}

/** Any active Member can read and edit their Group's Trip Stops. */
export function stopRoutes(deps: AppDeps) {
  const signedIn = requireUser(deps.now);
  return new Hono<AppEnv>()
    .get("/groups/:id/stops", signedIn, async (c) => {
      const me = await requireMember(createDb(c.env.DB), c.req.param("id"), c.var.userId);
      const query = stopListQuerySchema.safeParse(c.req.query());
      if (!query.success) throw new ApiError("VALIDATION_FAILED");
      const result = await stopRequest(c.env, me.groupId, { action: "list", day: query.data.day });
      c.header("X-Group-Rev", result.rev);
      return c.json(result.value, 200);
    })
    .post("/groups/:id/stops", signedIn, async (c) => {
      const me = await requireMember(createDb(c.env.DB), c.req.param("id"), c.var.userId);
      const input = await parseBody(c, stopInputSchema);
      const result = await stopRequest(c.env, me.groupId, {
        action: "create",
        input,
        now: deps.now(),
      });
      c.header("X-Group-Rev", result.rev);
      return c.json(result.value, 201);
    })
    .patch("/groups/:id/stops/:sid", signedIn, async (c) => {
      const me = await requireMember(createDb(c.env.DB), c.req.param("id"), c.var.userId);
      const expected = requireIfMatch(c);
      const input = await parseBody(c, stopPatchSchema);
      const result = await stopRequest(c.env, me.groupId, {
        action: "patch",
        id: c.req.param("sid"),
        input,
        expected,
        now: deps.now(),
      });
      c.header("X-Group-Rev", result.rev);
      return c.json(result.value, 200);
    })
    .delete("/groups/:id/stops/:sid", signedIn, async (c) => {
      const me = await requireMember(createDb(c.env.DB), c.req.param("id"), c.var.userId);
      const result = await stopRequest(c.env, me.groupId, {
        action: "delete",
        id: c.req.param("sid"),
      });
      c.header("X-Group-Rev", result.rev);
      return c.body(null, 204);
    });
}
