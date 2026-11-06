import { stopInputSchema, stopListQuerySchema, stopPatchSchema } from "@split/shared";
import { Hono } from "hono";
import type { AppEnv } from "../api.js";
import { rateLimit } from "../rate-limit.js";
import { requireUser } from "../auth/require-user.js";
import { createDb } from "../db/client.js";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { requireMember } from "../groups/membership.js";
import { groupLedger } from "../ledger-client.js";
import { parseBody, requireIfMatch } from "../request-guards.js";

/** Any active Member can read and edit their Group's Trip Stops. */
export function stopRoutes(deps: AppDeps) {
  const signedIn = requireUser(deps.now);
  const writeLimit = rateLimit("expense_write", deps.now);
  return new Hono<AppEnv>()
    .get("/groups/:id/stops", signedIn, async (c) => {
      const me = await requireMember(createDb(c.env.DB), c.req.param("id"), c.var.userId);
      const query = stopListQuerySchema.safeParse(c.req.query());
      if (!query.success) throw new ApiError("VALIDATION_FAILED");
      const result = await groupLedger(c.env, me.groupId).stop({
        action: "list",
        actorId: me.id,
        day: query.data.day,
      });
      c.header("X-Group-Rev", String(result.rev));
      return c.json(result.value, 200);
    })
    .post("/groups/:id/stops", signedIn, writeLimit, async (c) => {
      const me = await requireMember(createDb(c.env.DB), c.req.param("id"), c.var.userId);
      const input = await parseBody(c, stopInputSchema);
      const result = await groupLedger(c.env, me.groupId).stop({
        action: "create",
        actorId: me.id,
        input,
        now: deps.now(),
      });
      c.header("X-Group-Rev", String(result.rev));
      return c.json(result.value, 201);
    })
    .patch("/groups/:id/stops/:sid", signedIn, writeLimit, async (c) => {
      const me = await requireMember(createDb(c.env.DB), c.req.param("id"), c.var.userId);
      const expected = requireIfMatch(c);
      const input = await parseBody(c, stopPatchSchema);
      const result = await groupLedger(c.env, me.groupId).stop({
        action: "patch",
        actorId: me.id,
        id: c.req.param("sid"),
        input,
        expected,
        now: deps.now(),
      });
      c.header("X-Group-Rev", String(result.rev));
      return c.json(result.value, 200);
    })
    .delete("/groups/:id/stops/:sid", signedIn, writeLimit, async (c) => {
      const me = await requireMember(createDb(c.env.DB), c.req.param("id"), c.var.userId);
      const result = await groupLedger(c.env, me.groupId).stop({
        action: "delete",
        actorId: me.id,
        id: c.req.param("sid"),
      });
      c.header("X-Group-Rev", String(result.rev));
      return c.body(null, 204);
    });
}
