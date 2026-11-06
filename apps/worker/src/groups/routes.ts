import { withReservation } from "../auth/reservations.js";
import {
  claimInputSchema,
  groupInputSchema,
  groupPatchSchema,
  memberPatchSchema,
  placeholderInputSchema,
} from "@split/shared";
import { Hono } from "hono";
import type { AppEnv } from "../api.js";
import { bearerToken } from "../auth/bearer-token.js";
import { verifyAccessToken } from "../auth/tokens.js";
import { ApiError } from "../errors.js";
import { requireUser } from "../auth/require-user.js";
import { createDb } from "../db/client.js";
import type { AppDeps } from "../deps.js";
import { consumeRateLimit, rateLimit } from "../rate-limit.js";
import { parseBody, requireIfMatch } from "../request-guards.js";
import { assertUnderGroupCap, listGroups, readLedgerGroup, usersById } from "./groups.js";
import {
  claimPlaceholder,
  currentInvite,
  ensureInvite,
  joinGroup,
  previewInvite,
  regenerateInvite,
} from "./invites.js";
import {
  addPlaceholder,
  leaveGroup,
  listMembersWithRev,
  patchMember,
  removeMember,
} from "./members.js";
import { findMembership, requireAdmin, requireMember } from "./membership.js";
import { groupLedger } from "../ledger-client.js";

/**
 * Groups, Members, Invites and Placeholder Members (SPEC §5.1, decisions 10, 13, 16, 31).
 * Every Group route answers anyone who is not an active Member with 404.
 */
export function groupRoutes(deps: AppDeps) {
  const signedIn = requireUser(deps.now);
  const writeLimit = rateLimit("expense_write", deps.now);

  return new Hono<AppEnv>()
    .get("/groups/:id/live", async (c) => {
      const offered = (c.req.header("Sec-WebSocket-Protocol") ?? "")
        .split(",")
        .map((value) => value.trim());
      const protocol = offered[0] === "split.v1" ? offered[0] : undefined;
      const token =
        bearerToken(c.req.header("Authorization")) ??
        (protocol === undefined ? undefined : offered[1]);
      const userId =
        token === undefined
          ? null
          : await verifyAccessToken(token, c.env.SESSION_SIGNING_KEY, deps.now());
      if (userId === null) throw new ApiError("UNAUTHORIZED");
      const groupId = c.req.param("id");
      const db = createDb(c.env.DB);
      if ((await findMembership(db, groupId, userId)) === undefined)
        await consumeRateLimit(db, userId, "membership_lookup", deps.now());
      if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
        if (!(await groupLedger(c.env, groupId).isMember(userId))) throw new ApiError("NOT_FOUND");
        return c.body(null, 426);
      }
      return groupLedger(c.env, groupId).live(userId, protocol);
    })
    .get("/groups", signedIn, async (c) =>
      c.json(await listGroups(createDb(c.env.DB), c.var.userId), 200),
    )
    .post("/groups", signedIn, rateLimit("group_create", deps.now), async (c) => {
      const input = await parseBody(c, groupInputSchema);
      const db = createDb(c.env.DB);
      await assertUnderGroupCap(db, c.var.userId);
      const user = (await usersById(db, [c.var.userId])).get(c.var.userId);
      if (user === undefined) throw new ApiError("UNAUTHORIZED");
      const id = crypto.randomUUID();
      const memberId = crypto.randomUUID();
      const now = deps.now();
      const ledger = groupLedger(c.env, id);
      await withReservation(
        c.env.DB,
        c.var.userId,
        id,
        now,
        async () => {
          if (!(await ledger.create({ id, memberId, userId: c.var.userId, now, input })))
            throw new ApiError("INTERNAL");
        },
        () => ledger.isMember(c.var.userId),
      );
      c.header("X-Group-Rev", "0");
      return c.json(
        {
          id,
          name: input.name,
          settlementCurrency: input.settlementCurrency,
          isTrip: input.isTrip,
          tripDestination: input.tripDestination ?? null,
          tripStartDate: input.tripStartDate ?? null,
          tripEndDate: input.tripEndDate ?? null,
          tripNotes: input.tripNotes ?? null,
          settlementCurrencyLocked: false,
          memberCount: 1,
          memberPreview: [{ name: user.displayName, pictureUrl: user.pictureUrl }],
          createdAt: now,
          updatedAt: now,
          me: { memberId, role: "admin", balance: 0 },
        },
        201,
      );
    })
    .get("/groups/:id", signedIn, async (c) => {
      const id = c.req.param("id");
      const db = createDb(c.env.DB);
      if ((await findMembership(db, id, c.var.userId)) === undefined)
        await consumeRateLimit(db, c.var.userId, "membership_lookup", deps.now());
      const ledger = groupLedger(c.env, id);
      if (!(await ledger.isMember(c.var.userId))) throw new ApiError("NOT_FOUND");
      const { group, rev } = await readLedgerGroup(db, c.env, id, c.var.userId);
      c.header("X-Group-Rev", String(rev));
      return c.json(group, 200);
    })
    .patch("/groups/:id", signedIn, writeLimit, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      requireAdmin(me);
      const expected = requireIfMatch(c);
      const patch = await parseBody(c, groupPatchSchema);
      await groupLedger(c.env, me.groupId)
        .patch({ patch, expected, now: deps.now(), actorMemberId: me.id })
        .catch(async (error: unknown) => {
          if (!(error instanceof ApiError)) throw error;
          if (error.code === "EDIT_CONFLICT")
            throw new ApiError("EDIT_CONFLICT", {
              current: (await readLedgerGroup(db, c.env, me.groupId, c.var.userId, me)).group,
            });
          // VALIDATION_FAILED carries the invalid Trip dates; a missing Group was INTERNAL.
          if (
            error.code === "FORBIDDEN" ||
            error.code === "SETTLEMENT_CURRENCY_LOCKED" ||
            error.code === "VALIDATION_FAILED"
          )
            throw error;
          throw new ApiError("INTERNAL");
        });
      const updated = await readLedgerGroup(db, c.env, me.groupId, c.var.userId, me);
      c.header("X-Group-Rev", String(updated.rev));
      return c.json(updated.group, 200);
    })
    .delete("/groups/:id", signedIn, writeLimit, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      requireAdmin(me);
      const { rev } = await groupLedger(c.env, me.groupId)
        .delete({ actorMemberId: me.id })
        .catch((error: unknown) => {
          throw error instanceof ApiError && error.code === "FORBIDDEN"
            ? error
            : new ApiError("INTERNAL");
        });
      c.header("X-Group-Rev", String(rev));
      return c.body(null, 204);
    })
    .get("/groups/:id/members", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      const { members, rev } = await listMembersWithRev(db, me.groupId, me.id, c.env, c.var.userId);
      c.header("X-Group-Rev", String(rev));
      return c.json(members, 200);
    })
    .post("/groups/:id/members", signedIn, writeLimit, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      const input = await parseBody(c, placeholderInputSchema);
      const result = await addPlaceholder(db, me, input, deps.now(), c.env);
      c.header("X-Group-Rev", String(result.rev));
      return c.json(result.member, 201);
    })
    .patch("/groups/:id/members/:mid", signedIn, writeLimit, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      const patch = await parseBody(c, memberPatchSchema);
      const result = await patchMember(db, me, c.req.param("mid"), patch, c.env);
      c.header("X-Group-Rev", String(result.rev));
      return c.json(result.member, 200);
    })
    .delete("/groups/:id/members/:mid", signedIn, writeLimit, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      const result = await removeMember(me, c.req.param("mid"), c.env);
      c.header("X-Group-Rev", String(result.rev));
      return c.body(null, 204);
    })
    .post("/groups/:id/leave", signedIn, writeLimit, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      const result = await leaveGroup(me, c.env);
      c.header("X-Group-Rev", String(result.rev));
      return c.body(null, 204);
    })
    .get("/groups/:id/invite", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      return c.json(await currentInvite(me, deps.now(), c.env), 200);
    })
    .post("/groups/:id/invite", signedIn, writeLimit, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      return c.json(
        await regenerateInvite(me, deps.now(), c.env, (rev) => {
          c.header("X-Group-Rev", rev);
        }),
        201,
      );
    })
    .post("/groups/:id/invite/ensure", signedIn, writeLimit, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      return c.json(
        await ensureInvite(me, deps.now(), c.env, (rev) => {
          c.header("X-Group-Rev", rev);
        }),
        200,
      );
    })
    .get("/invites/:token", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      return c.json(
        await previewInvite(db, c.req.param("token"), c.var.userId, deps.now(), c.env),
        200,
      );
    })
    .post("/invites/:token/join", signedIn, rateLimit("invite_join", deps.now), async (c) => {
      const db = createDb(c.env.DB);
      return c.json(
        await joinGroup(db, c.req.param("token"), c.var.userId, deps.now(), c.env, (rev) => {
          c.header("X-Group-Rev", rev);
        }),
        200,
      );
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
        c.env,
        (rev) => {
          c.header("X-Group-Rev", rev);
        },
      );
      return c.json(result, 200);
    });
}
