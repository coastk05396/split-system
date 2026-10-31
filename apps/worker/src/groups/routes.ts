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
import { assertUnderGroupCap, listGroups, loadGroup } from "./groups.js";
import {
  claimPlaceholder,
  currentInvite,
  ensureInvite,
  joinGroup,
  previewInvite,
  regenerateInvite,
} from "./invites.js";
import { addPlaceholder, leaveGroup, listMembers, patchMember, removeMember } from "./members.js";
import { requireAdmin, requireMember } from "./membership.js";
import type { Bindings } from "../env.js";
import type { MemberRow } from "./membership.js";

function ledger(env: Bindings, id: string) {
  return env.GROUP_LEDGER.get(env.GROUP_LEDGER.idFromName(id));
}

async function readLedgerGroup(env: Bindings, me: MemberRow) {
  const response = await ledger(env, me.groupId).fetch("https://ledger.internal/state");
  if (!response.ok) throw new ApiError("NOT_FOUND");
  const state = await response.json<{
    rev: number;
    locked: boolean;
    group: {
      name: string;
      settlement_currency: "TWD" | "USD" | "JPY" | "THB";
      is_trip: number;
      trip_destination: string | null;
      trip_start_date: string | null;
      trip_end_date: string | null;
      trip_notes: string | null;
      updated_at: number;
    };
  }>();
  const legacy = await loadGroup(createDb(env.DB), me);
  return {
    rev: state.rev,
    group: {
      ...legacy,
      settlementCurrencyLocked: state.locked,
      name: state.group.name,
      settlementCurrency: state.group.settlement_currency,
      isTrip: state.group.is_trip === 1,
      tripDestination: state.group.trip_destination,
      tripStartDate: state.group.trip_start_date,
      tripEndDate: state.group.trip_end_date,
      tripNotes: state.group.trip_notes,
      updatedAt: state.group.updated_at,
    },
  };
}

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
      await assertUnderGroupCap(createDb(c.env.DB), c.var.userId);
      const user = await c.env.DB.prepare(
        "SELECT display_name, picture_url FROM users WHERE id = ?",
      )
        .bind(c.var.userId)
        .first<{ display_name: string; picture_url: string | null }>();
      if (user === null) throw new ApiError("UNAUTHORIZED");
      const id = crypto.randomUUID();
      const memberId = crypto.randomUUID();
      const now = deps.now();
      await c.env.DB.prepare(
        "INSERT INTO group_reservations (user_id, group_id, status, created_at) VALUES (?, ?, 'pending', ?)",
      )
        .bind(c.var.userId, id, now)
        .run();
      const ledgerId = c.env.GROUP_LEDGER.idFromName(id);
      const response = await c.env.GROUP_LEDGER.get(ledgerId).fetch(
        "https://ledger.internal/create",
        {
          method: "POST",
          body: JSON.stringify({ id, memberId, userId: c.var.userId, now, input }),
        },
      );
      if (!response.ok) throw new ApiError("INTERNAL");
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
          memberPreview: [{ name: user.display_name, pictureUrl: user.picture_url }],
          createdAt: now,
          updatedAt: now,
          me: { memberId, role: "admin", balance: 0 },
        },
        201,
      );
    })
    .get("/groups/:id", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      const current = await readLedgerGroup(c.env, me);
      c.header("X-Group-Rev", String(current.rev));
      return c.json(current.group, 200);
    })
    .patch("/groups/:id", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      requireAdmin(me);
      const expected = requireIfMatch(c);
      const patch = await parseBody(c, groupPatchSchema);
      const response = await ledger(c.env, me.groupId).fetch("https://ledger.internal/patch", {
        method: "POST",
        body: JSON.stringify({
          patch,
          expected,
          now: deps.now(),
        }),
      });
      if (!response.ok) {
        const result = await response.json<{ error: string }>();
        if (result.error === "EDIT_CONFLICT")
          throw new ApiError("EDIT_CONFLICT", {
            current: (await readLedgerGroup(c.env, me)).group,
          });
        if (result.error === "SETTLEMENT_CURRENCY_LOCKED")
          throw new ApiError("SETTLEMENT_CURRENCY_LOCKED");
        if (result.error === "TRIP_DATES_INVALID")
          throw new ApiError("VALIDATION_FAILED", {
            issues: [{ path: ["tripEndDate"], message: "TRIP_DATES_INVALID" }],
          });
        throw new ApiError("INTERNAL");
      }
      const updated = await readLedgerGroup(c.env, me);
      c.header("X-Group-Rev", String(updated.rev));
      return c.json(updated.group, 200);
    })
    .delete("/groups/:id", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      requireAdmin(me);
      const response = await ledger(c.env, me.groupId).fetch("https://ledger.internal/delete", {
        method: "POST",
      });
      if (!response.ok) throw new ApiError("INTERNAL");
      const { rev } = await response.json<{ rev: number }>();
      c.header("X-Group-Rev", String(rev));
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
      return c.json(await addPlaceholder(db, me, input, deps.now(), c.env), 201);
    })
    .patch("/groups/:id/members/:mid", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      const patch = await parseBody(c, memberPatchSchema);
      return c.json(await patchMember(db, me, c.req.param("mid"), patch, c.env), 200);
    })
    .delete("/groups/:id/members/:mid", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      const me = await requireMember(db, c.req.param("id"), c.var.userId);
      await removeMember(db, me, c.req.param("mid"), c.env);
      return c.body(null, 204);
    })
    .post("/groups/:id/leave", signedIn, async (c) => {
      const db = createDb(c.env.DB);
      await leaveGroup(db, await requireMember(db, c.req.param("id"), c.var.userId), c.env);
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
      return c.json(
        await previewInvite(db, c.req.param("token"), c.var.userId, deps.now(), c.env),
        200,
      );
    })
    .post("/invites/:token/join", signedIn, rateLimit("invite_join", deps.now), async (c) => {
      const db = createDb(c.env.DB);
      return c.json(
        await joinGroup(db, c.req.param("token"), c.var.userId, deps.now(), c.env),
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
      );
      return c.json(result, 200);
    });
}
