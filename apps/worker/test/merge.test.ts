import { MERGE_PENDING_TTL_MS } from "@split/shared";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { AccountDeletionOperation } from "../src/ledger-types.js";
import { dailyMaintenance, MAINTENANCE_CRON, runScheduled } from "../src/maintenance.js";
import { bearer, call, clock, json, signIn, uniqueSub, withCookie } from "./auth-harness.js";
import {
  createGroup,
  errorCode,
  inviteToken,
  listMembers,
  person,
  send,
} from "./groups-harness.js";
import { balances, createExpense, postExpense, twdExpense } from "./expenses-harness.js";

async function issueLinkCode(accessToken: string): Promise<string> {
  const res = await call("/auth/link-code", json({}, bearer(accessToken)));
  expect(res.status).toBe(200);
  return (await res.json<{ code: string }>()).code;
}

function redeem(code: string, sub: string, name = "Google名", email = "g@example.com") {
  return call("/auth/link-code/redeem", json({ code, idToken: `fake|${sub}|${name}|${email}` }));
}

interface RedeemMergeBody {
  accessToken: string;
  user: { id: string; identities: { provider: string; email: string | null }[] };
  mergeNeeded?: boolean;
  merge?: {
    mergeId: string;
    path: string;
    expiresAt: number;
    kept: {
      id: string;
      displayName: string;
      pictureUrl: string | null;
      providers: string[];
      profileProvider: string;
      groupCount: number;
      groups: { id: string; name: string; shared: boolean }[];
    };
    other: {
      id: string;
      displayName: string;
      pictureUrl: string | null;
      providers: string[];
      profileProvider: string;
      groupCount: number;
      groups: { id: string; name: string; shared: boolean }[];
    };
  };
}

describe("User Merge on the Link code path", () => {
  it("redeeming a Link code with a Google owned by another User returns a merge-needed preview and links nothing yet", async () => {
    const lineSub = uniqueSub("line");
    const googleSub = uniqueSub("google");
    const kept = await signIn("line", lineSub, "LINE小宇");
    const other = await signIn("google", googleSub, "Google小宇", "g@example.com");
    const keptGroup = await createGroup(kept, { name: "LINE群組" });
    const otherGroup = await createGroup(other, { name: "Google群組" });

    const res = await redeem(
      await issueLinkCode(kept.accessToken),
      googleSub,
      "Google小宇",
      "g@example.com",
    );
    expect(res.status).toBe(200);
    const body = await res.json<RedeemMergeBody>();

    expect(body.mergeNeeded).toBe(true);
    expect(body.merge).toMatchObject({
      path: "linkCode",
      kept: {
        id: kept.userId,
        displayName: "LINE小宇",
        pictureUrl: `https://pic/${lineSub}`,
        providers: ["line"],
        profileProvider: "line",
        groupCount: 1,
        groups: [{ id: keptGroup.id, name: "LINE群組", shared: false }],
      },
      other: {
        id: other.userId,
        displayName: "Google小宇",
        pictureUrl: `https://pic/${googleSub}`,
        providers: ["google"],
        profileProvider: "google",
        groupCount: 1,
        groups: [{ id: otherGroup.id, name: "Google群組", shared: false }],
      },
    });
    expect(body.merge?.mergeId).toEqual(expect.any(String));

    // Nothing has been linked or moved yet.
    const keptMe = await (
      await call("/me", { headers: bearer(kept.accessToken) })
    ).json<{
      identities: { provider: string; email: string | null }[];
    }>();
    expect(keptMe.identities).toEqual([{ provider: "line", email: null }]);
    const otherMe = await (
      await call("/me", { headers: bearer(other.accessToken) })
    ).json<{
      identities: { provider: string; email: string | null }[];
    }>();
    expect(otherMe.identities).toEqual([{ provider: "google", email: "g@example.com" }]);
    expect(await (await send(kept, "GET", "/groups")).json<unknown[]>()).toHaveLength(1);
    expect(await (await send(other, "GET", "/groups")).json<unknown[]>()).toHaveLength(1);
  });

  it("ties the pending Merge to the confirming Session and expires it after its TTL", async () => {
    const lineSub = uniqueSub("line");
    const googleSub = uniqueSub("google");
    const kept = await signIn("line", lineSub, "LINE小宇");
    await signIn("google", googleSub, "Google小宇");
    const res = await redeem(await issueLinkCode(kept.accessToken), googleSub);
    const { accessToken: confirmToken, merge } = await res.json<RedeemMergeBody>();
    if (merge === undefined) throw new Error("expected merge preview");

    // Another Session of the same kept User cannot read or confirm this pending Merge.
    expect((await call("/auth/merge", { headers: bearer(kept.accessToken) })).status).toBe(422);
    const wrongSessionConfirm = await call(
      "/auth/merge/confirm",
      json({ mergeId: merge.mergeId }, bearer(kept.accessToken)),
    );
    expect(wrongSessionConfirm.status).toBe(422);
    expect(await wrongSessionConfirm.json()).toEqual({ error: { code: "MERGE_PENDING_INVALID" } });

    // Confirming Session can read the preview.
    expect((await call("/auth/merge", { headers: bearer(confirmToken) })).status).toBe(200);

    // Once expired, both preview and confirm refuse.
    clock.now += MERGE_PENDING_TTL_MS + 1;
    try {
      expect((await call("/auth/merge", { headers: bearer(confirmToken) })).status).toBe(422);
      const expired = await call(
        "/auth/merge/confirm",
        json({ mergeId: merge.mergeId }, bearer(confirmToken)),
      );
      expect(expired.status).toBe(422);
      expect(await expired.json()).toEqual({ error: { code: "MERGE_PENDING_INVALID" } });
    } finally {
      clock.now -= MERGE_PENDING_TTL_MS + 1;
    }
  });

  it("cancelling deletes the pending Merge and leaves both Users, Identities and Groups untouched", async () => {
    const kept = await signIn("line", uniqueSub("line"), "LINE小宇");
    const googleSub = uniqueSub("google");
    const other = await signIn("google", googleSub, "Google小宇", "g@example.com");
    const keptGroup = await createGroup(kept, { name: "保留群組" });
    const otherGroup = await createGroup(other, { name: "其他群組" });

    const redeemRes = await redeem(await issueLinkCode(kept.accessToken), googleSub);
    const { accessToken: confirmToken, merge } = await redeemRes.json<RedeemMergeBody>();
    if (merge === undefined) throw new Error("expected merge preview");

    const cancelRes = await call(
      "/auth/merge/cancel",
      json({ mergeId: merge.mergeId }, bearer(confirmToken)),
    );
    expect(cancelRes.status).toBe(204);

    // Single-use: cannot be fetched or confirmed afterwards.
    expect((await call("/auth/merge", { headers: bearer(confirmToken) })).status).toBe(422);
    const reuseRes = await call(
      "/auth/merge/confirm",
      json({ mergeId: merge.mergeId }, bearer(confirmToken)),
    );
    expect(reuseRes.status).toBe(422);

    // Both Users, Identities, and Groups remain intact.
    expect(await (await call("/me", { headers: bearer(kept.accessToken) })).json()).toMatchObject({
      identities: [{ provider: "line", email: null }],
    });
    expect(await (await call("/me", { headers: bearer(other.accessToken) })).json()).toMatchObject({
      identities: [{ provider: "google", email: "g@example.com" }],
    });
    expect(await (await send(kept, "GET", "/groups")).json()).toMatchObject([{ id: keptGroup.id }]);
    expect(await (await send(other, "GET", "/groups")).json()).toMatchObject([
      { id: otherGroup.id },
    ]);
  });

  it("refuses confirm when both Users hold the same provider", async () => {
    const kept = await signIn("line", uniqueSub("line-1"), "LINE一");
    const googleSub = uniqueSub("google");
    const other = await signIn("google", googleSub, "Google二");
    // Give the other User a LINE Identity too, so both Users hold LINE.
    expect(
      (
        await call(
          "/auth/link/line",
          json({ idToken: `fake|${uniqueSub("line-2")}|LINE二` }, bearer(other.accessToken)),
        )
      ).status,
    ).toBe(200);

    const redeemRes = await redeem(await issueLinkCode(kept.accessToken), googleSub);
    const { accessToken: confirmToken, merge } = await redeemRes.json<RedeemMergeBody>();
    if (merge === undefined) throw new Error("expected merge preview");

    const confirmRes = await call(
      "/auth/merge/confirm",
      json({ mergeId: merge.mergeId }, bearer(confirmToken)),
    );
    expect(confirmRes.status).toBe(409);
    expect(await confirmRes.json()).toEqual({ error: { code: "MERGE_SAME_PROVIDER" } });
  });

  it("refuses confirm while either User has a pending account deletion", async () => {
    const kept = await signIn("line", uniqueSub("line"), "LINE一");
    const googleSub = uniqueSub("google");
    const other = await signIn("google", googleSub, "Google二");
    await createGroup(other, { name: "刪除中群組" });

    const redeemRes = await redeem(await issueLinkCode(kept.accessToken), googleSub);
    const { accessToken: confirmToken, merge } = await redeemRes.json<RedeemMergeBody>();
    if (merge === undefined) throw new Error("expected merge preview");

    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let observed: () => void = () => {};
    const frozen = new Promise<void>((resolve) => {
      observed = resolve;
    });
    const namespace = new Proxy(env.GROUP_LEDGER, {
      get(targetNamespace, key) {
        if (key !== "get") {
          const value: unknown = Reflect.get(targetNamespace, key, targetNamespace);
          return typeof value === "function"
            ? (...args: unknown[]): unknown => Reflect.apply(value, targetNamespace, args)
            : value;
        }
        return (id: DurableObjectId) => {
          const stub = targetNamespace.get(id);
          return new Proxy(stub, {
            get(targetStub, prop) {
              if (prop !== "accountDeletion") {
                const value: unknown = Reflect.get(targetStub, prop, targetStub);
                return typeof value === "function"
                  ? (...args: unknown[]): unknown => Reflect.apply(value, targetStub, args)
                  : value;
              }
              return async (op: AccountDeletionOperation) => {
                const result = await targetStub.accountDeletion(op);
                if (op.action === "freeze") {
                  observed();
                  await hold;
                }
                return result;
              };
            },
          });
        };
      },
    });
    const deletion = call(
      "/me",
      { method: "DELETE", headers: bearer(other.accessToken) },
      { GROUP_LEDGER: namespace },
    );
    try {
      await frozen;
      const confirmRes = await call(
        "/auth/merge/confirm",
        json({ mergeId: merge.mergeId }, bearer(confirmToken)),
      );
      expect(confirmRes.status).toBe(409);
      expect(await confirmRes.json()).toEqual({
        error: { code: "MERGE_ACCOUNT_DELETION_PENDING" },
      });
    } finally {
      release();
      await deletion;
    }
  });

  it("confirms Merge: moves Identities, Groups, Balances and Personal spending to kept User and ends other User's Sessions", async () => {
    const baseTime = clock.now;
    const googleSub = uniqueSub("google");
    const lineSub = uniqueSub("line");
    // Create Google User earlier than LINE User to verify kept User keeps Profile source.
    const other = await signIn("google", googleSub, "Google名", "old@example.com");
    await send(other, "PATCH", "/me", { preferredCurrency: "JPY", language: "en" });
    const otherGroup = await createGroup(other, { name: "Google群組" });
    const otherExpense = await createExpense(
      other,
      otherGroup.id,
      twdExpense(otherGroup.me.memberId, [otherGroup.me.memberId], 450, {
        description: "拉麵",
        category: "food",
      }),
    );

    clock.now = baseTime + 5_000;
    try {
      const kept = await signIn("line", lineSub, "LINE名");
      await send(kept, "PATCH", "/me", { preferredCurrency: "USD", language: "zh-TW" });
      const keptGroup = await createGroup(kept, { name: "LINE群組" });
      await createExpense(
        kept,
        keptGroup.id,
        twdExpense(keptGroup.me.memberId, [keptGroup.me.memberId], 300, {
          description: "咖啡",
          category: "food",
        }),
      );

      const redeemRes = await redeem(
        await issueLinkCode(kept.accessToken),
        googleSub,
        "Google新名",
        "new@example.com",
      );
      const { accessToken: confirmToken, merge } = await redeemRes.json<RedeemMergeBody>();
      if (merge === undefined) throw new Error("expected merge preview");

      const confirmRes = await call(
        "/auth/merge/confirm",
        json({ mergeId: merge.mergeId }, bearer(confirmToken)),
      );
      expect(confirmRes.status).toBe(200);
      const confirmed = await confirmRes.json<{
        accessToken: string;
        user: {
          id: string;
          displayName: string;
          pictureUrl: string | null;
          preferredCurrency: string;
          language: string;
          signedInWith: string;
          identities: { provider: string; email: string | null }[];
        };
      }>();
      expect(confirmed.user).toMatchObject({
        id: kept.userId,
        displayName: "LINE名",
        pictureUrl: `https://pic/${lineSub}`,
        preferredCurrency: "USD",
        language: "zh-TW",
        signedInWith: "google",
        identities: [
          { provider: "line", email: null },
          { provider: "google", email: "new@example.com" },
        ],
      });

      // Single-use: confirming again fails.
      expect(
        (
          await call(
            "/auth/merge/confirm",
            json({ mergeId: merge.mergeId }, bearer(confirmed.accessToken)),
          )
        ).status,
      ).toBe(422);

      // GET /me on LINE session stays signedInWith: "line" and lists both Identities.
      expect(await (await call("/me", { headers: bearer(kept.accessToken) })).json()).toMatchObject(
        {
          id: kept.userId,
          displayName: "LINE名",
          signedInWith: "line",
          identities: [
            { provider: "line", email: null },
            { provider: "google", email: "new@example.com" },
          ],
        },
      );

      // Signing in with Google afterwards lands on kept User and preserves LINE Profile source.
      const googleSignIn = await signIn("google", googleSub, "Google改名", "fresh@example.com");
      expect(googleSignIn.userId).toBe(kept.userId);
      expect(await (await call("/me", { headers: bearer(kept.accessToken) })).json()).toMatchObject(
        {
          displayName: "LINE名",
          pictureUrl: `https://pic/${lineSub}`,
        },
      );

      // Group list (and Home total source) contains both Groups, and moved Group's ledger works.
      const groups = await (
        await send(kept, "GET", "/groups")
      ).json<{ id: string; name: string; me: { memberId: string } }[]>();
      expect(groups.map((g) => g.id).sort()).toEqual([keptGroup.id, otherGroup.id].sort());
      expect((await send(kept, "GET", `/groups/${otherGroup.id}`)).status).toBe(200);
      expect(await listMembers(kept, otherGroup.id)).toContainEqual(
        expect.objectContaining({
          id: otherGroup.me.memberId,
          userId: kept.userId,
          status: "active",
          role: "admin",
        }),
      );
      expect(
        (await send(kept, "GET", `/groups/${otherGroup.id}/expenses/${otherExpense.id}`)).status,
      ).toBe(200);

      // Personal spending includes moved Groups.
      const spending = await (
        await send(kept, "GET", "/stats/spending")
      ).json<{ amount: number }[]>();
      expect(spending).toEqual([
        { month: "2026-06", category: "food", currency: "TWD", amount: 750 },
      ]);

      // Merged-away User's access and refresh tokens fail.
      expect((await call("/me", { headers: bearer(other.accessToken) })).status).toBe(401);
      expect((await call("/auth/refresh", withCookie(other.refresh))).status).toBe(401);
    } finally {
      clock.now = baseTime;
    }
  });

  it("when a Group ledger fails during confirm, other Groups complete, the failing Group shows as merging and refuses writes until maintenance finishes it", async () => {
    const kept = await signIn("line", uniqueSub("line"), "LINE小宇");
    const googleSub = uniqueSub("google");
    const other = await signIn("google", googleSub, "Google小宇");
    const alice = await person("Alice");

    const goodGroup = await createGroup(other, { name: "順利群組" });
    const flakyGroup = await createGroup(other, { name: "卡住群組", isTrip: true });
    const token = await inviteToken(other, flakyGroup.id);
    expect((await send(alice, "POST", `/invites/${token}/join`)).status).toBe(200);

    const redeemRes = await redeem(await issueLinkCode(kept.accessToken), googleSub);
    const { accessToken: confirmToken, merge } = await redeemRes.json<RedeemMergeBody>();
    if (merge === undefined) throw new Error("expected merge preview");

    const flakyDoId = env.GROUP_LEDGER.idFromName(flakyGroup.id);
    const flakyLedger = new Proxy(env.GROUP_LEDGER, {
      get(targetNamespace, key) {
        if (key !== "get") {
          const value: unknown = Reflect.get(targetNamespace, key, targetNamespace);
          return typeof value === "function"
            ? (...args: unknown[]): unknown => Reflect.apply(value, targetNamespace, args)
            : value;
        }
        return (id: DurableObjectId) => {
          const stub = targetNamespace.get(id);
          return new Proxy(stub, {
            get(targetStub, prop) {
              if (prop === "mergeUser" && id.equals(flakyDoId)) {
                return () => Promise.reject(new Error("ledger unreachable"));
              }
              const value: unknown = Reflect.get(targetStub, prop, targetStub);
              return typeof value === "function"
                ? (...args: unknown[]): unknown => Reflect.apply(value, targetStub, args)
                : value;
            },
          });
        };
      },
    });

    const confirmRes = await call(
      "/auth/merge/confirm",
      json({ mergeId: merge.mergeId }, bearer(confirmToken)),
      { GROUP_LEDGER: flakyLedger },
    );
    expect(confirmRes.status).toBe(200);
    const confirmBody = await confirmRes.json<{ mergingGroupIds?: string[] }>();
    expect(confirmBody.mergingGroupIds).toEqual([flakyGroup.id]);

    // Good Group finished immediately and accepts writes.
    expect(
      (
        await postExpense(
          kept,
          goodGroup.id,
          twdExpense(goodGroup.me.memberId, [goodGroup.me.memberId], 100),
        )
      ).status,
    ).toBe(201);
    expect(await listMembers(kept, goodGroup.id)).toContainEqual(
      expect.objectContaining({ userId: kept.userId, status: "active" }),
    );

    // Durable Merge cleanup record keeps only the unfinished Group.
    const pendingCleanups = await env.DB.prepare(
      "SELECT group_id FROM merge_cleanups WHERE other_user_id=?",
    )
      .bind(other.userId)
      .all<{ group_id: string }>();
    expect(pendingCleanups.results.map((r) => r.group_id)).toEqual([flakyGroup.id]);

    // Group list and Group detail show the failing Group as merging.
    const groupsList = await (
      await send(kept, "GET", "/groups")
    ).json<{ id: string; merging?: boolean }[]>();
    expect(groupsList.find((g) => g.id === goodGroup.id)?.merging).not.toBe(true);
    expect(groupsList.find((g) => g.id === flakyGroup.id)?.merging).toBe(true);

    const keptDetail = await send(kept, "GET", `/groups/${flakyGroup.id}`);
    expect(keptDetail.status).toBe(200);
    expect(await keptDetail.json<{ merging?: boolean }>()).toMatchObject({ merging: true });

    const aliceDetail = await send(alice, "GET", `/groups/${flakyGroup.id}`);
    expect(aliceDetail.status).toBe(200);
    expect(await aliceDetail.json<{ merging?: boolean }>()).toMatchObject({ merging: true });

    // Writes to the merging Group are refused for both kept User and other Members.
    const expenseWrite = await postExpense(
      kept,
      flakyGroup.id,
      twdExpense(flakyGroup.me.memberId, [flakyGroup.me.memberId], 200),
    );
    expect(expenseWrite.status).toBe(409);
    expect(await errorCode(expenseWrite)).toBe("GROUP_MERGING");

    const aliceMembers = await listMembers(alice, flakyGroup.id);
    const aliceMemberId = aliceMembers.find((m) => m.isMe)?.id;
    if (aliceMemberId === undefined) throw new Error("expected alice member");
    const aliceExpenseWrite = await postExpense(
      alice,
      flakyGroup.id,
      twdExpense(aliceMemberId, [aliceMemberId], 200),
    );
    expect(aliceExpenseWrite.status).toBe(409);
    expect(await errorCode(aliceExpenseWrite)).toBe("GROUP_MERGING");

    const patchGroup = await send(
      kept,
      "PATCH",
      `/groups/${flakyGroup.id}`,
      { name: "改名" },
      { "If-Match": String(flakyGroup.updatedAt) },
    );
    expect(patchGroup.status).toBe(409);
    expect(await errorCode(patchGroup)).toBe("GROUP_MERGING");

    const settlementWrite = await send(
      kept,
      "POST",
      `/groups/${flakyGroup.id}/settlements`,
      { payerMemberId: flakyGroup.me.memberId, receiverMemberId: aliceMemberId, amount: 10 },
      { "Idempotency-Key": "s-merging-1" },
    );
    expect(settlementWrite.status).toBe(409);
    expect(await errorCode(settlementWrite)).toBe("GROUP_MERGING");

    const stopWrite = await send(kept, "POST", `/groups/${flakyGroup.id}/stops`, {
      dayDate: "2026-06-13",
      title: "車站",
      category: "transport",
    });
    expect(stopWrite.status).toBe(409);
    expect(await errorCode(stopWrite)).toBe("GROUP_MERGING");

    const addPlaceholder = await send(kept, "POST", `/groups/${flakyGroup.id}/members`, {
      name: "小明",
    });
    expect(addPlaceholder.status).toBe(409);
    expect(await errorCode(addPlaceholder)).toBe("GROUP_MERGING");

    const regenInvite = await send(kept, "POST", `/groups/${flakyGroup.id}/invite`);
    expect(regenInvite.status).toBe(409);
    expect(await errorCode(regenInvite)).toBe("GROUP_MERGING");

    const deleteMeWhileMerging = await send(kept, "DELETE", "/me");
    expect(deleteMeWhileMerging.status).toBe(409);
    expect(await errorCode(deleteMeWhileMerging)).toBe("GROUP_MERGING");

    // Next maintenance run finishes the Group, removes the durable record, and clears merging state.
    await dailyMaintenance(env, clock.now);

    const remainingCleanups = await env.DB.prepare(
      "SELECT group_id FROM merge_cleanups WHERE other_user_id=?",
    )
      .bind(other.userId)
      .all<{ group_id: string }>();
    expect(remainingCleanups.results).toEqual([]);

    const groupsAfter = await (
      await send(kept, "GET", "/groups")
    ).json<{ id: string; merging?: boolean }[]>();
    expect(groupsAfter.find((g) => g.id === flakyGroup.id)?.merging).not.toBe(true);

    const detailAfter = await send(kept, "GET", `/groups/${flakyGroup.id}`);
    expect(detailAfter.status).toBe(200);
    expect((await detailAfter.json<{ merging?: boolean }>()).merging).not.toBe(true);

    expect(await listMembers(kept, flakyGroup.id)).toContainEqual(
      expect.objectContaining({
        id: flakyGroup.me.memberId,
        userId: kept.userId,
        status: "active",
        role: "admin",
      }),
    );

    const writeAfter = await postExpense(
      kept,
      flakyGroup.id,
      twdExpense(flakyGroup.me.memberId, [flakyGroup.me.memberId], 200),
    );
    expect(writeAfter.status).toBe(201);
  });

  it("re-running a Group's merge after it finished is idempotent (revision and Balances unchanged)", async () => {
    const kept = await signIn("line", uniqueSub("line"), "LINE小宇");
    const googleSub = uniqueSub("google");
    const other = await signIn("google", googleSub, "Google小宇");
    const alice = await person("Alice");

    const group = await createGroup(other, { name: "冪等群組" });
    const token = await inviteToken(other, group.id);
    expect((await send(alice, "POST", `/invites/${token}/join`)).status).toBe(200);
    const aliceMemberId = (await listMembers(other, group.id)).find((m) => !m.isMe)?.id;
    if (aliceMemberId === undefined) throw new Error("expected alice member");
    await createExpense(
      other,
      group.id,
      twdExpense(group.me.memberId, [group.me.memberId, aliceMemberId], 600),
    );

    const redeemRes = await redeem(await issueLinkCode(kept.accessToken), googleSub);
    const { accessToken: confirmToken, merge } = await redeemRes.json<RedeemMergeBody>();
    if (merge === undefined) throw new Error("expected merge preview");
    expect(
      (await call("/auth/merge/confirm", json({ mergeId: merge.mergeId }, bearer(confirmToken))))
        .status,
    ).toBe(200);

    const beforeRes = await send(kept, "GET", `/groups/${group.id}`);
    expect(beforeRes.status).toBe(200);
    const revBefore = beforeRes.headers.get("X-Group-Rev");
    const balancesBefore = await balances(kept, group.id);
    expect(balancesBefore.get(group.me.memberId)).toBe(300);
    expect(balancesBefore.get(aliceMemberId)).toBe(-300);

    // Simulate a retry (e.g. lost RPC reply after ledger committed) via maintenance.
    await env.DB.prepare(
      "INSERT INTO merge_cleanups(kept_user_id,other_user_id,group_id,expires_at) VALUES (?,?,?,?)",
    )
      .bind(kept.userId, other.userId, group.id, clock.now + 60_000)
      .run();
    await runScheduled(MAINTENANCE_CRON, env, clock.now);

    expect(
      await env.DB.prepare("SELECT group_id FROM merge_cleanups WHERE other_user_id=?")
        .bind(other.userId)
        .all(),
    ).toMatchObject({ results: [] });

    const afterRes = await send(kept, "GET", `/groups/${group.id}`);
    expect(afterRes.status).toBe(200);
    expect(afterRes.headers.get("X-Group-Rev")).toBe(revBefore);
    expect(await balances(kept, group.id)).toEqual(balancesBefore);
  });

  it("marks any Group that is still merging in a pending Merge preview", async () => {
    const googleSub = uniqueSub("google-2");
    await signIn("google", googleSub, "Google二");
    const kept = await signIn("line", uniqueSub("line-2"), "LINE二");
    const keptGroup = await createGroup(kept, { name: "合併中測試群" });
    await env.DB.prepare(
      "INSERT INTO merge_cleanups(kept_user_id,other_user_id,group_id,expires_at) VALUES (?,?,?,?)",
    )
      .bind(kept.userId, "u-prev", keptGroup.id, clock.now + 60_000)
      .run();

    try {
      const redeemRes = await redeem(await issueLinkCode(kept.accessToken), googleSub);
      const body = await redeemRes.json<{
        accessToken: string;
        merge?: { kept: { groups: { id: string; merging?: boolean }[] } };
      }>();
      expect(body.merge?.kept.groups).toContainEqual(
        expect.objectContaining({ id: keptGroup.id, merging: true }),
      );
      const previewRes = await call("/auth/merge", { headers: bearer(body.accessToken) });
      expect(previewRes.status).toBe(200);
      const preview = await previewRes.json<{
        kept: { groups: { id: string; merging?: boolean }[] };
      }>();
      expect(preview.kept.groups).toContainEqual(
        expect.objectContaining({ id: keptGroup.id, merging: true }),
      );
    } finally {
      await env.DB.prepare("DELETE FROM merge_cleanups WHERE other_user_id='u-prev'").run();
    }
  });
});
