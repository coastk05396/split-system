import {
  type Expense,
  type ExpenseInput,
  MERGE_PENDING_TTL_MS,
  type Settlement,
  type SettlementPage,
} from "@split/shared";
import { env } from "cloudflare:workers";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AccountDeletionOperation } from "../src/ledger-types.js";
import { bearer, call, clock, json, signIn, uniqueSub, withCookie } from "./auth-harness.js";
import { createGroup, inviteToken, listMembers, person, send } from "./groups-harness.js";
import { balances, createExpense, newKey, postExpense, twdExpense } from "./expenses-harness.js";

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
});

describe("User Merge in a shared Group", () => {
  it("collapses both Members into one with summed Balance, summed payer lines, and updated Personal spending", async () => {
    const kept = await signIn("line", uniqueSub("line"), "LINE小宇");
    const googleSub = uniqueSub("google");
    const other = await signIn("google", googleSub, "Google小宇");
    const third = await person("阿明");

    const sharedGroup = await createGroup(kept, { name: "共同旅遊" });
    const token = await inviteToken(kept, sharedGroup.id);
    expect((await send(other, "POST", `/invites/${token}/join`)).status).toBe(200);
    expect((await send(third, "POST", `/invites/${token}/join`)).status).toBe(200);

    const beforeMembers = await listMembers(kept, sharedGroup.id);
    const keptMemberId = beforeMembers.find((m) => m.userId === kept.userId)?.id;
    const otherMemberId = beforeMembers.find((m) => m.userId === other.userId)?.id;
    const thirdMemberId = beforeMembers.find((m) => m.userId === third.userId)?.id;
    if (!keptMemberId || !otherMemberId || !thirdMemberId) {
      throw new Error("missing members");
    }

    const expense = await createExpense(kept, sharedGroup.id, {
      ...twdExpense(keptMemberId, [keptMemberId, otherMemberId, thirdMemberId], 600),
      payers: [
        { memberId: keptMemberId, amountMinor: 250 },
        { memberId: otherMemberId, amountMinor: 350 },
      ],
      split: {
        method: "exact",
        lines: [
          { memberId: keptMemberId, amountMinor: 100 },
          { memberId: otherMemberId, amountMinor: 200 },
          { memberId: thirdMemberId, amountMinor: 300 },
        ],
      },
    });

    const redeemRes = await redeem(await issueLinkCode(kept.accessToken), googleSub);
    const { accessToken: confirmToken, merge } = await redeemRes.json<RedeemMergeBody>();
    if (merge === undefined) throw new Error("expected merge preview");
    expect(merge.kept.groups).toEqual([{ id: sharedGroup.id, name: "共同旅遊", shared: true }]);
    expect(merge.other.groups).toEqual([{ id: sharedGroup.id, name: "共同旅遊", shared: true }]);

    const confirmRes = await call(
      "/auth/merge/confirm",
      json({ mergeId: merge.mergeId }, bearer(confirmToken)),
    );
    expect(confirmRes.status).toBe(200);

    const afterMembers = await listMembers(kept, sharedGroup.id);
    expect(afterMembers).toHaveLength(2);
    expect(afterMembers).toContainEqual(
      expect.objectContaining({
        id: keptMemberId,
        userId: kept.userId,
        status: "active",
        balance: 300,
      }),
    );
    expect(afterMembers).toContainEqual(
      expect.objectContaining({
        id: thirdMemberId,
        userId: third.userId,
        status: "active",
        balance: -300,
      }),
    );

    const afterBalances = await balances(kept, sharedGroup.id);
    expect(afterBalances).toEqual(
      new Map([
        [keptMemberId, 300],
        [thirdMemberId, -300],
      ]),
    );

    const fetchedExpense = await (
      await send(kept, "GET", `/groups/${sharedGroup.id}/expenses/${expense.id}`)
    ).json<{
      payers: { memberId: string; amountMinor: number; settlementAmount: number }[];
      splits: {
        memberId: string;
        shares: number | null;
        amountMinor: number;
        settlementAmount: number;
      }[];
    }>();
    expect(fetchedExpense.payers).toEqual([
      { memberId: keptMemberId, amountMinor: 600, settlementAmount: 600 },
    ]);
    expect(fetchedExpense.splits).toEqual([
      { memberId: keptMemberId, shares: null, amountMinor: 300, settlementAmount: 300 },
      { memberId: thirdMemberId, shares: null, amountMinor: 300, settlementAmount: 300 },
    ]);

    const groups = await (
      await send(kept, "GET", "/groups")
    ).json<{ id: string; memberCount: number; me: { memberId: string; balance: number } }[]>();
    expect(groups).toHaveLength(1);
    expect(groups).toMatchObject([
      {
        id: sharedGroup.id,
        memberCount: 2,
        me: { memberId: keptMemberId, balance: 300 },
      },
    ]);

    const spending = await (
      await send(kept, "GET", "/stats/spending")
    ).json<{ amount: number }[]>();
    expect(spending).toEqual([
      { month: "2026-06", category: "food", currency: "TWD", amount: 300 },
    ]);
  });

  it("rewrites equal and shares Expenses naming both Members to exact amounts while keeping single-Member splits intact", async () => {
    const kept = await signIn("line", uniqueSub("line"), "LINE小宇");
    const googleSub = uniqueSub("google");
    const other = await signIn("google", googleSub, "Google小宇");
    const third = await person("阿明");

    const sharedGroup = await createGroup(kept, { name: "共同旅遊" });
    const token = await inviteToken(kept, sharedGroup.id);
    expect((await send(other, "POST", `/invites/${token}/join`)).status).toBe(200);
    expect((await send(third, "POST", `/invites/${token}/join`)).status).toBe(200);

    const beforeMembers = await listMembers(kept, sharedGroup.id);
    const keptMemberId = beforeMembers.find((m) => m.userId === kept.userId)?.id;
    const otherMemberId = beforeMembers.find((m) => m.userId === other.userId)?.id;
    const thirdMemberId = beforeMembers.find((m) => m.userId === third.userId)?.id;
    if (!keptMemberId || !otherMemberId || !thirdMemberId) {
      throw new Error("missing members");
    }

    const equalBoth = await createExpense(
      kept,
      sharedGroup.id,
      twdExpense(keptMemberId, [keptMemberId, otherMemberId, thirdMemberId], 100),
    );
    const sharesBoth = await createExpense(kept, sharedGroup.id, {
      ...twdExpense(otherMemberId, [keptMemberId, otherMemberId, thirdMemberId], 100),
      split: {
        method: "shares",
        lines: [
          { memberId: keptMemberId, shares: 1 },
          { memberId: otherMemberId, shares: 2 },
          { memberId: thirdMemberId, shares: 3 },
        ],
      },
    });
    const equalOnlyOther = await createExpense(
      other,
      sharedGroup.id,
      twdExpense(otherMemberId, [otherMemberId, thirdMemberId], 300),
    );

    const redeemRes = await redeem(await issueLinkCode(kept.accessToken), googleSub);
    const { accessToken: confirmToken, merge } = await redeemRes.json<RedeemMergeBody>();
    if (merge === undefined) throw new Error("expected merge preview");
    expect(
      (await call("/auth/merge/confirm", json({ mergeId: merge.mergeId }, bearer(confirmToken))))
        .status,
    ).toBe(200);

    const afterEqualBoth = await (
      await send(kept, "GET", `/groups/${sharedGroup.id}/expenses/${equalBoth.id}`)
    ).json<typeof equalBoth>();
    expect(afterEqualBoth.splitMethod).toBe("exact");
    expect(afterEqualBoth.splits).toEqual([
      { memberId: keptMemberId, shares: null, amountMinor: 67, settlementAmount: 67 },
      { memberId: thirdMemberId, shares: null, amountMinor: 33, settlementAmount: 33 },
    ]);

    const afterSharesBoth = await (
      await send(kept, "GET", `/groups/${sharedGroup.id}/expenses/${sharesBoth.id}`)
    ).json<typeof sharesBoth>();
    expect(afterSharesBoth.splitMethod).toBe("exact");
    expect(afterSharesBoth.splits).toEqual([
      { memberId: keptMemberId, shares: null, amountMinor: 50, settlementAmount: 50 },
      { memberId: thirdMemberId, shares: null, amountMinor: 50, settlementAmount: 50 },
    ]);

    const afterEqualOnlyOther = await (
      await send(kept, "GET", `/groups/${sharedGroup.id}/expenses/${equalOnlyOther.id}`)
    ).json<typeof equalOnlyOther>();
    expect(afterEqualOnlyOther.splitMethod).toBe("equal");
    expect(afterEqualOnlyOther.splits).toEqual([
      { memberId: keptMemberId, shares: null, amountMinor: 150, settlementAmount: 150 },
      { memberId: thirdMemberId, shares: null, amountMinor: 150, settlementAmount: 150 },
    ]);
  });

  it("deletes Settlements between the two Members and repoints Settlements involving others", async () => {
    const kept = await signIn("line", uniqueSub("line"), "LINE小宇");
    const googleSub = uniqueSub("google");
    const other = await signIn("google", googleSub, "Google小宇");
    const third = await person("阿明");

    const sharedGroup = await createGroup(kept, { name: "共同旅遊" });
    const token = await inviteToken(kept, sharedGroup.id);
    expect((await send(other, "POST", `/invites/${token}/join`)).status).toBe(200);
    expect((await send(third, "POST", `/invites/${token}/join`)).status).toBe(200);

    const beforeMembers = await listMembers(kept, sharedGroup.id);
    const keptMemberId = beforeMembers.find((m) => m.userId === kept.userId)?.id;
    const otherMemberId = beforeMembers.find((m) => m.userId === other.userId)?.id;
    const thirdMemberId = beforeMembers.find((m) => m.userId === third.userId)?.id;
    if (!keptMemberId || !otherMemberId || !thirdMemberId) {
      throw new Error("missing members");
    }

    await createExpense(
      other,
      sharedGroup.id,
      twdExpense(otherMemberId, [keptMemberId, otherMemberId, thirdMemberId], 300),
    );
    // kept: -100, other: +200, third: -100

    const sUndoneRes = await send(
      kept,
      "POST",
      `/groups/${sharedGroup.id}/settlements`,
      { payerMemberId: keptMemberId, receiverMemberId: otherMemberId, amount: 40 },
      { "Idempotency-Key": newKey() },
    );
    expect(sUndoneRes.status).toBe(201);
    const sUndone = await sUndoneRes.json<Settlement>();
    expect((await send(kept, "POST", `/settlements/${sUndone.id}/undo`)).status).toBe(200);

    const sBetweenRes = await send(
      kept,
      "POST",
      `/groups/${sharedGroup.id}/settlements`,
      { payerMemberId: keptMemberId, receiverMemberId: otherMemberId, amount: 100 },
      { "Idempotency-Key": newKey() },
    );
    expect(sBetweenRes.status).toBe(201);
    const sBetween = await sBetweenRes.json<Settlement>();

    const sThirdRes = await send(
      other,
      "POST",
      `/groups/${sharedGroup.id}/settlements`,
      { payerMemberId: thirdMemberId, receiverMemberId: otherMemberId, amount: 50 },
      { "Idempotency-Key": newKey() },
    );
    expect(sThirdRes.status).toBe(201);
    const sThird = await sThirdRes.json<Settlement>();

    const redeemRes = await redeem(await issueLinkCode(kept.accessToken), googleSub);
    const { accessToken: confirmToken, merge } = await redeemRes.json<RedeemMergeBody>();
    if (merge === undefined) throw new Error("expected merge preview");
    expect(
      (await call("/auth/merge/confirm", json({ mergeId: merge.mergeId }, bearer(confirmToken))))
        .status,
    ).toBe(200);

    expect(await balances(kept, sharedGroup.id)).toEqual(
      new Map([
        [keptMemberId, 50],
        [thirdMemberId, -50],
      ]),
    );

    const page = await (
      await send(kept, "GET", `/groups/${sharedGroup.id}/settlements`)
    ).json<SettlementPage>();
    expect(page.settlements).toHaveLength(1);
    expect(page.settlements[0]).toMatchObject({
      id: sThird.id,
      payerMemberId: thirdMemberId,
      receiverMemberId: keptMemberId,
      createdByMemberId: keptMemberId,
      confirmedByMemberId: keptMemberId,
      amount: 50,
      status: "confirmed",
    });

    expect((await send(kept, "POST", `/settlements/${sBetween.id}/undo`)).status).toBe(404);
    expect((await send(kept, "POST", `/settlements/${sThird.id}/undo`)).status).toBe(200);
    expect(await balances(kept, sharedGroup.id)).toEqual(
      new Map([
        [keptMemberId, 100],
        [thirdMemberId, -100],
      ]),
    );
  });

  it("repoints Expense creators without Idempotency-Key collisions so the merged Member can edit both", async () => {
    const admin = await person("團長");
    const kept = await signIn("line", uniqueSub("line"), "LINE小宇");
    const googleSub = uniqueSub("google");
    const other = await signIn("google", googleSub, "Google小宇");

    const sharedGroup = await createGroup(admin, { name: "共同旅遊" });
    const token = await inviteToken(admin, sharedGroup.id);
    expect((await send(kept, "POST", `/invites/${token}/join`)).status).toBe(200);
    expect((await send(other, "POST", `/invites/${token}/join`)).status).toBe(200);

    const beforeMembers = await listMembers(admin, sharedGroup.id);
    const keptMemberId = beforeMembers.find((m) => m.userId === kept.userId)?.id;
    const otherMemberId = beforeMembers.find((m) => m.userId === other.userId)?.id;
    if (!keptMemberId || !otherMemberId) throw new Error("missing members");

    const keptExpenseRes = await postExpense(
      kept,
      sharedGroup.id,
      twdExpense(keptMemberId, [keptMemberId], 100, { description: "保留早餐" }),
      "shared-key",
    );
    expect(keptExpenseRes.status).toBe(201);
    const keptExpense = await keptExpenseRes.json<Expense>();

    const deletedExpenseRes = await postExpense(
      kept,
      sharedGroup.id,
      twdExpense(keptMemberId, [keptMemberId], 50, { description: "已刪飲料" }),
      "deleted-collision-key",
    );
    expect(deletedExpenseRes.status).toBe(201);
    const deletedExpense = await deletedExpenseRes.json<Expense>();
    expect(
      (await send(kept, "DELETE", `/groups/${sharedGroup.id}/expenses/${deletedExpense.id}`))
        .status,
    ).toBe(204);

    const otherExpense1Res = await postExpense(
      other,
      sharedGroup.id,
      twdExpense(otherMemberId, [otherMemberId], 200, { description: "合併晚餐" }),
      "shared-key",
    );
    expect(otherExpense1Res.status).toBe(201);
    const otherExpense1 = await otherExpense1Res.json<Expense>();

    const otherExpense2Res = await postExpense(
      other,
      sharedGroup.id,
      twdExpense(otherMemberId, [otherMemberId], 250, { description: "合併消夜" }),
      "deleted-collision-key",
    );
    expect(otherExpense2Res.status).toBe(201);
    const otherExpense2 = await otherExpense2Res.json<Expense>();

    const placeholderRes = await send(other, "POST", `/groups/${sharedGroup.id}/members`, {
      name: "小明",
    });
    expect(placeholderRes.status).toBe(201);
    const placeholder = await placeholderRes.json<{ id: string }>();

    const redeemRes = await redeem(await issueLinkCode(kept.accessToken), googleSub);
    const { accessToken: confirmToken, merge } = await redeemRes.json<RedeemMergeBody>();
    if (merge === undefined) throw new Error("expected merge preview");
    expect(
      (await call("/auth/merge/confirm", json({ mergeId: merge.mergeId }, bearer(confirmToken))))
        .status,
    ).toBe(200);

    const fetchedOther1 = await (
      await send(kept, "GET", `/groups/${sharedGroup.id}/expenses/${otherExpense1.id}`)
    ).json<Expense>();
    expect(fetchedOther1.creatorMemberId).toBe(keptMemberId);

    // Plain Member `kept` can edit Expenses originally created by `other`.
    const patch1 = await send(
      kept,
      "PATCH",
      `/groups/${sharedGroup.id}/expenses/${otherExpense1.id}`,
      twdExpense(keptMemberId, [keptMemberId], 220, { description: "更新合併晚餐" }),
      { "If-Match": String(otherExpense1.updatedAt) },
    );
    expect(patch1.status).toBe(200);

    const patch2 = await send(
      kept,
      "PATCH",
      `/groups/${sharedGroup.id}/expenses/${otherExpense2.id}`,
      twdExpense(keptMemberId, [keptMemberId], 260, { description: "更新合併消夜" }),
      { "If-Match": String(otherExpense2.updatedAt) },
    );
    expect(patch2.status).toBe(200);

    // `kept`'s own Idempotency-Key still resolves to `kept`'s original Expense.
    const replay = await postExpense(
      kept,
      sharedGroup.id,
      twdExpense(keptMemberId, [keptMemberId], 100, { description: "保留早餐" }),
      "shared-key",
    );
    expect(replay.status).toBe(201);
    expect((await replay.json<Expense>()).id).toBe(keptExpense.id);

    const afterMembers = await listMembers(kept, sharedGroup.id);
    expect(afterMembers).toContainEqual(
      expect.objectContaining({ id: placeholder.id, createdByMemberId: keptMemberId }),
    );
  });

  it("carries over admin role and active status when either Member had them and keeps the kept Member's display name", async () => {
    const admin = await person("原團長");
    const kept = await signIn("line", uniqueSub("line"), "LINE小宇");
    const googleSub = uniqueSub("google");
    const other = await signIn("google", googleSub, "Google大明");

    // Group 1: `kept` is a plain member, `other` is promoted to admin.
    const adminGroup = await createGroup(admin, { name: "管理員群組" });
    const token1 = await inviteToken(admin, adminGroup.id);
    expect((await send(kept, "POST", `/invites/${token1}/join`)).status).toBe(200);
    expect((await send(other, "POST", `/invites/${token1}/join`)).status).toBe(200);
    const members1 = await listMembers(admin, adminGroup.id);
    const keptM1 = members1.find((m) => m.userId === kept.userId)?.id;
    const otherM1 = members1.find((m) => m.userId === other.userId)?.id;
    if (!keptM1 || !otherM1) throw new Error("missing members in group 1");
    expect(
      (
        await send(admin, "PATCH", `/groups/${adminGroup.id}/members/${otherM1}`, {
          role: "admin",
        })
      ).status,
    ).toBe(200);

    // Group 2: `kept` joins, pays an expense for self, settles to 0 (already 0), and leaves (`former`), while `other` stays `active`.
    const formerGroup = await createGroup(other, { name: "退群後回歸" });
    const token2 = await inviteToken(other, formerGroup.id);
    expect((await send(kept, "POST", `/invites/${token2}/join`)).status).toBe(200);
    const members2 = await listMembers(other, formerGroup.id);
    const keptM2 = members2.find((m) => m.userId === kept.userId)?.id;
    if (!keptM2) throw new Error("missing kept in group 2");
    await createExpense(
      kept,
      formerGroup.id,
      twdExpense(keptM2, [keptM2], 180, { description: "個人門票" }),
    );
    expect((await send(kept, "POST", `/groups/${formerGroup.id}/leave`)).status).toBe(204);

    const redeemRes = await redeem(await issueLinkCode(kept.accessToken), googleSub);
    const { accessToken: confirmToken, merge } = await redeemRes.json<RedeemMergeBody>();
    if (merge === undefined) throw new Error("expected merge preview");
    expect(
      (await call("/auth/merge/confirm", json({ mergeId: merge.mergeId }, bearer(confirmToken))))
        .status,
    ).toBe(200);

    // Group 1: `kept` is now admin with `kept`'s display name, and can rename the Group.
    const after1 = await listMembers(kept, adminGroup.id);
    expect(after1.filter((m) => m.userId === kept.userId)).toEqual([
      expect.objectContaining({
        id: keptM1,
        displayName: "LINE小宇",
        role: "admin",
        status: "active",
      }),
    ]);
    const renameRes = await send(
      kept,
      "PATCH",
      `/groups/${adminGroup.id}`,
      { name: "新群組名" },
      { "If-Match": String(adminGroup.updatedAt) },
    );
    expect(renameRes.status).toBe(200);

    // Group 2: `kept` is active again as a single Member, and Personal spending includes the reopened Group's split.
    const after2 = await listMembers(kept, formerGroup.id);
    expect(after2).toHaveLength(1);
    expect(after2[0]).toMatchObject({
      id: keptM2,
      userId: kept.userId,
      displayName: "LINE小宇",
      role: "admin",
      status: "active",
    });
    expect(await (await send(kept, "GET", "/stats/spending")).json<{ amount: number }[]>()).toEqual(
      [{ month: "2026-06", category: "food", currency: "TWD", amount: 180 }],
    );
  });

  it("preserves every other Member's Balance across random Expenses and Settlements", async () => {
    type RandomOp =
      | {
          kind: "expense";
          creator: number;
          amount: number;
          payerIndices: number[];
          payerWeights: number[];
          participants: number[];
          exactWeights: number[];
          shares: number[];
          method: "equal" | "exact" | "shares";
          useUsd: boolean;
        }
      | { kind: "settle"; payer: number; receiver: number; num: number; den: number }
      | { kind: "undo" };

    const anyOp: fc.Arbitrary<RandomOp> = fc.oneof(
      {
        weight: 4,
        arbitrary: fc.record({
          kind: fc.constant("expense" as const),
          creator: fc.nat(3),
          amount: fc.integer({ min: 10, max: 10_000 }),
          payerIndices: fc.uniqueArray(fc.nat(3), { minLength: 1, maxLength: 3 }),
          payerWeights: fc.array(fc.integer({ min: 1, max: 10 }), { minLength: 3, maxLength: 3 }),
          participants: fc.uniqueArray(fc.nat(3), { minLength: 1, maxLength: 4 }),
          exactWeights: fc.array(fc.integer({ min: 0, max: 10 }), { minLength: 4, maxLength: 4 }),
          shares: fc.array(fc.integer({ min: 1, max: 99 }), { minLength: 4, maxLength: 4 }),
          method: fc.constantFrom("equal" as const, "exact" as const, "shares" as const),
          useUsd: fc.boolean(),
        }),
      },
      {
        weight: 2,
        arbitrary: fc.record({
          kind: fc.constant("settle" as const),
          payer: fc.nat(3),
          receiver: fc.nat(3),
          num: fc.integer({ min: 1, max: 4 }),
          den: fc.integer({ min: 1, max: 4 }),
        }),
      },
      { weight: 1, arbitrary: fc.constant({ kind: "undo" as const }) },
    );

    const partitionAmount = (total: number, weights: number[], minPerSlot: number): number[] => {
      const base = weights.map(() => minPerSlot);
      const remaining = total - minPerSlot * weights.length;
      const weightSum = weights.reduce((s, w) => s + w, 0);
      if (weightSum === 0) {
        const first = base[0];
        if (first !== undefined) base[0] = first + remaining;
        return base;
      }
      let allocated = 0;
      const out = base.map((b, i) => {
        const add = Math.floor((remaining * (weights[i] ?? 0)) / weightSum);
        allocated += add;
        return b + add;
      });
      const first = out[0];
      if (first !== undefined) out[0] = first + (remaining - allocated);
      return out;
    };

    await fc.assert(
      fc.asyncProperty(fc.array(anyOp, { minLength: 2, maxLength: 8 }), async (ops) => {
        const kept = await signIn("line", uniqueSub("prop-line"), "LINE小宇");
        const googleSub = uniqueSub("prop-google");
        const other = await signIn("google", googleSub, "Google小宇");
        const alice = await person("小美");
        const bob = await person("阿傑");

        const sharedGroup = await createGroup(kept, { name: "隨機群組" });
        const token = await inviteToken(kept, sharedGroup.id);
        expect((await send(other, "POST", `/invites/${token}/join`)).status).toBe(200);
        expect((await send(alice, "POST", `/invites/${token}/join`)).status).toBe(200);
        expect((await send(bob, "POST", `/invites/${token}/join`)).status).toBe(200);

        const members = await listMembers(kept, sharedGroup.id);
        const sessions = [kept, other, alice, bob];
        const memberIds = sessions.map((s) => {
          const found = members.find((m) => m.userId === s.userId)?.id;
          if (!found) throw new Error("missing member");
          return found;
        });
        const [keptId, otherId, aliceId, bobId] = memberIds;
        if (!keptId || !otherId || !aliceId || !bobId) throw new Error("missing member ids");

        const confirmedSettlements: string[] = [];

        for (const op of ops) {
          clock.now += 2_100;
          if (op.kind === "expense") {
            const creatorSession = sessions[op.creator] ?? kept;
            const payerAmounts = partitionAmount(
              op.amount,
              op.payerIndices.map((_, idx) => op.payerWeights[idx] ?? 1),
              1,
            );
            const payers = op.payerIndices.map((idx, pos) => ({
              memberId: memberIds[idx] ?? keptId,
              amountMinor: payerAmounts[pos] ?? 1,
            }));
            const participantIds = op.participants.map((idx) => memberIds[idx] ?? keptId);
            const split: ExpenseInput["split"] =
              op.method === "equal"
                ? { method: "equal", participants: participantIds }
                : op.method === "shares"
                  ? {
                      method: "shares",
                      lines: op.participants.map((idx) => ({
                        memberId: memberIds[idx] ?? keptId,
                        shares: op.shares[idx] ?? 1,
                      })),
                    }
                  : {
                      method: "exact",
                      lines: partitionAmount(
                        op.amount,
                        op.participants.map((idx) => op.exactWeights[idx] ?? 1),
                        0,
                      ).map((amt, pos) => ({
                        memberId: participantIds[pos] ?? keptId,
                        amountMinor: amt,
                      })),
                    };
            const base = twdExpense(keptId, participantIds, op.amount, { payers, split });
            const input: ExpenseInput = op.useUsd
              ? {
                  ...base,
                  originalCurrency: "USD",
                  fxRateScaled: 31_523_400,
                  isCustomRate: true,
                  settlementAmount: Math.max(1, Math.round(op.amount * 0.3)),
                }
              : base;
            await createExpense(creatorSession, sharedGroup.id, input);
          } else if (op.kind === "settle") {
            const current = await balances(kept, sharedGroup.id);
            const pId = memberIds[op.payer] ?? keptId;
            const rId = memberIds[op.receiver] ?? otherId;
            if (pId === rId) continue;
            const pBal = current.get(pId) ?? 0;
            const rBal = current.get(rId) ?? 0;
            const maxPayable = Math.min(-pBal, rBal);
            if (maxPayable <= 0) continue;
            const amount = Math.max(
              1,
              Math.floor((maxPayable * Math.min(op.num, op.den)) / op.den),
            );
            const res = await send(
              kept,
              "POST",
              `/groups/${sharedGroup.id}/settlements`,
              { payerMemberId: pId, receiverMemberId: rId, amount },
              { "Idempotency-Key": newKey() },
            );
            expect(res.status).toBe(201);
            confirmedSettlements.push((await res.json<Settlement>()).id);
          } else {
            const sid = confirmedSettlements.pop();
            if (sid === undefined) continue;
            expect((await send(kept, "POST", `/settlements/${sid}/undo`)).status).toBe(200);
          }
        }

        const beforeBalances = await balances(kept, sharedGroup.id);
        const redeemRes = await redeem(await issueLinkCode(kept.accessToken), googleSub);
        const { accessToken: confirmToken, merge } = await redeemRes.json<RedeemMergeBody>();
        if (merge === undefined) throw new Error("expected merge preview");
        expect(
          (
            await call(
              "/auth/merge/confirm",
              json({ mergeId: merge.mergeId }, bearer(confirmToken)),
            )
          ).status,
        ).toBe(200);

        const afterBalances = await balances(kept, sharedGroup.id);
        expect(afterBalances.has(otherId)).toBe(false);
        expect(afterBalances.get(aliceId)).toBe(beforeBalances.get(aliceId));
        expect(afterBalances.get(bobId)).toBe(beforeBalances.get(bobId));
        expect(afterBalances.get(keptId)).toBe(
          (beforeBalances.get(keptId) ?? 0) + (beforeBalances.get(otherId) ?? 0),
        );
        expect([...afterBalances.values()].reduce((s, b) => s + b, 0)).toBe(0);
      }),
      { numRuns: 10 },
    );
  }, 300_000);
});
