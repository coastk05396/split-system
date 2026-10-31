import {
  claimInputSchema,
  groupInputSchema,
  groupPatchSchema,
  memberPatchSchema,
  placeholderInputSchema,
} from "@split/shared";
import { Hono } from "hono";
import type { AppEnv } from "../api.js";
import { verifyAccessToken } from "../auth/tokens.js";
import { ApiError } from "../errors.js";
import { requireUser } from "../auth/require-user.js";
import { createDb } from "../db/client.js";
import type { AppDeps } from "../deps.js";
import { rateLimit } from "../rate-limit.js";
import { parseBody, requireIfMatch } from "../request-guards.js";
import { createGroup, deleteGroup, listGroups, loadGroup, patchGroup } from "./groups.js";
import {
  claimPlaceholder,
  currentInvite,
  ensureInvite,
  joinGroup,
  previewInvite,
  regenerateInvite,
} from "./invites.js";
import { addPlaceholder, leaveGroup, listMembers, patchMember, removeMember } from "./members.js";
import { requireMember } from "./membership.js";

/**
 * Groups, Members, Invites and Placeholder Members (SPEC §5.1, decisions 10, 13, 16, 31).
 * Every Group route answers anyone who is not an active Member with 404.
 */
export function groupRoutes(deps: AppDeps) {
  const signedIn = requireUser(deps.now);

  return new Hono<AppEnv>()
    .get("/groups/:id/live", async (c) => {
      const offered = (c.req.header("Sec-WebSocket-Protocol") ?? "")
        .split(",")
        .map((value) => value.trim());
      const protocol = offered[0] === "split.v1" ? offered[0] : undefined;
      const bearer = /^Bearer (\S+)$/.exec(c.req.header("Authorization") ?? "");
      const token = bearer?.[1] ?? (protocol === undefined ? undefined : offered[1]);
      const userId =
        token === undefined
          ? null
          : await verifyAccessToken(token, c.env.SESSION_SIGNING_KEY, deps.now());
      if (userId === null) throw new ApiError("UNAUTHORIZED");
      await requireMember(createDb(c.env.DB), c.req.param("id"), userId);
      if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") return c.body(null, 426);
      const id = c.env.GROUP_LEDGER.idFromName(c.req.param("id"));
      const headers = new Headers({ Upgrade: "websocket", "X-User-Id": userId });
      if (protocol !== undefined) headers.set("Sec-WebSocket-Protocol", protocol);
      return c.env.GROUP_LEDGER.get(id).fetch("https://ledger.internal/live", { headers });
    })
    .get("/groups", signedIn, async (c) =>
      c.json(await listGroups(createDb(c.env.DB), c.var.userId), 200),
    )
    .post("/groups", signedIn, rateLimit("group_create", deps.now), async (c) => {
      const input = await parseBody(c, groupInputSchema);
      const group = await createGroup(createDb(c.env.DB), c.var.userId, input, deps.now());
      return c.json(group, 201);
    })
    .get("/groups/:id", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      return c.json(await loadGroup(db, me), 200);
    })
    .patch("/groups/:id", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      const expected = requireIfMatch(c);
      const patch = await parseBody(c, groupPatchSchema);
      return c.json(await patchGroup(db, me, patch, expected, deps.now()), 200);
    })
    .delete("/groups/:id", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      await deleteGroup(db, me);
      return c.body(null, 204);
    })
    .get("/groups/:id/members", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      return c.json(await listMembers(db, me.groupId, me.id), 200);
    })
    .post("/groups/:id/members", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      const input = await parseBody(c, placeholderInputSchema);
      return c.json(await addPlaceholder(db, me, input, deps.now()), 201);
    })
    .patch("/groups/:id/members/:mid", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      const patch = await parseBody(c, memberPatchSchema);
      return c.json(await patchMember(db, me, c.req.param("mid"), patch), 200);
    })
    .delete("/groups/:id/members/:mid", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      await removeMember(db, me, c.req.param("mid"));
      return c.body(null, 204);
    })
    .post("/groups/:id/leave", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      await leaveGroup(db, await requireMember(db, c.req.param("id"), c.var.userId));
      return c.body(null, 204);
    })
    .get("/groups/:id/invite", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      return c.json(await currentInvite(db, me, deps.now()), 200);
    })
    .post("/groups/:id/invite", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      return c.json(await regenerateInvite(db, me, deps.now()), 201);
    })
    .post("/groups/:id/invite/ensure", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      return c.json(await ensureInvite(db, me, deps.now()), 200);
    })
    .get("/invites/:token", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      return c.json(await previewInvite(db, c.req.param("token"), c.var.userId, deps.now()), 200);
    })
    .post("/invites/:token/join", signedIn, rateLimit("invite_join", deps.now), async (c) => {
      const db = createDb(c.env.DB);
      return c.json(await joinGroup(db, c.req.param("token"), c.var.userId, deps.now()), 200);
    })
    .post("/invites/:token/claim", signedIn, rateLimit("invite_join", deps.now), async (c) => {
      const db = createDb(c.env.DB);
      const { memberId } = await parseBody(c, claimInputSchema);
      const result = await claimPlaceholder(
        db,
        c.req.param("token"),
        c.var.userId,
        memberId,
        deps.now(),
      );
      return c.json(result, 200);
    });
}
