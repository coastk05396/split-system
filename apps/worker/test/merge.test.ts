import { MERGE_PENDING_TTL_MS } from "@split/shared";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { AccountDeletionOperation } from "../src/ledger-types.js";
import { bearer, call, clock, json, signIn, uniqueSub, withCookie } from "./auth-harness.js";
import { createGroup, listMembers, send } from "./groups-harness.js";
import { createExpense, twdExpense } from "./expenses-harness.js";

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
