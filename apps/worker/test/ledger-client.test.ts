import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/errors.js";
import { groupLedger } from "../src/ledger-client.js";
import { clock } from "./auth-harness.js";
import { createGroup, groupWith, person } from "./groups-harness.js";

describe("the typed Group ledger client", () => {
  it("reads the Group and its Members as domain values", async () => {
    const admin = await person("client admin");
    const group = await createGroup(admin, { name: "客戶端" });
    const ledger = groupLedger(env, group.id);

    const state = await ledger.state();
    expect(state.value).toEqual({
      group: {
        id: group.id,
        name: "客戶端",
        settlementCurrency: "TWD",
        isTrip: false,
        tripDestination: null,
        tripStartDate: null,
        tripEndDate: null,
        tripNotes: null,
        createdAt: clock.now,
        updatedAt: clock.now,
      },
      locked: false,
      seated: [
        {
          id: group.me.memberId,
          userId: admin.userId,
          placeholderName: null,
          role: "admin",
          balance: 0,
        },
      ],
    });
    const members = await ledger.members(admin.userId);
    expect(members.rev).toBe(state.rev);
    expect(members.value).toEqual([
      {
        id: group.me.memberId,
        userId: admin.userId,
        placeholderName: null,
        role: "admin",
        balance: 0,
        status: "active",
        nickname: null,
        createdByMemberId: null,
      },
    ]);
  });

  it("answers the member check with true or false", async () => {
    const admin = await person("check admin");
    const stranger = await person("check stranger");
    const group = await createGroup(admin);
    const ledger = groupLedger(env, group.id);
    expect(await ledger.isMember(admin.userId)).toBe(true);
    expect(await ledger.isMember(stranger.userId)).toBe(false);
  });

  it("decodes a ledger refusal into an ApiError with its code", async () => {
    const { group } = await groupWith("refusal admin", "refusal member");
    const refusal = groupLedger(env, group.id).member({
      action: "leave",
      actorMemberId: group.me.memberId,
      targetMemberId: group.me.memberId,
      now: clock.now,
    });
    await expect(refusal).rejects.toBeInstanceOf(ApiError);
    await expect(refusal).rejects.toMatchObject({ code: "LAST_ADMIN" });
  });

  it("refuses Member-facing reads once the Group is deleted", async () => {
    const admin = await person("deleted admin");
    const group = await createGroup(admin);
    const ledger = groupLedger(env, group.id);
    await ledger.delete({ actorMemberId: group.me.memberId });
    await expect(ledger.members()).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ledger.state()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
