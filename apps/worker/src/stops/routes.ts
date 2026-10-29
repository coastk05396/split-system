import { stopInputSchema, stopListQuerySchema, stopPatchSchema } from "@split/shared";
import { Hono } from "hono";
import type { AppEnv } from "../api.js";
import { requireUser } from "../auth/require-user.js";
import { createDb } from "../db/client.js";
import type { AppDeps } from "../deps.js";
import { ApiError } from "../errors.js";
import { requireMember } from "../groups/membership.js";
import { parseBody, requireIfMatch } from "../request-guards.js";
import { createStop, deleteStop, listStops, patchStop } from "./stops.js";

/** Trip Stops (SPEC §5.1, decisions 13, 16): any active Member reads and edits them. */
export function stopRoutes(deps: AppDeps) {
  const signedIn = requireUser(deps.now);

  return new Hono<AppEnv>()
    .get("/groups/:id/stops", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      const query = stopListQuerySchema.safeParse(c.req.query());
      if (!query.success) throw new ApiError("VALIDATION_FAILED");
      return c.json(await listStops(db, me, query.data.day), 200);
    })
    .post("/groups/:id/stops", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      const input = await parseBody(c, stopInputSchema);
      return c.json(await createStop(db, me, input, deps.now()), 201);
    })
    .patch("/groups/:id/stops/:sid", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      const expected = requireIfMatch(c);
      const patch = await parseBody(c, stopPatchSchema);
      const stop = await patchStop(db, me, c.req.param("sid"), patch, expected, deps.now());
      return c.json(stop, 200);
    })
    .delete("/groups/:id/stops/:sid", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      await deleteStop(db, me, c.req.param("sid"));
      return c.body(null, 204);
    });
}
