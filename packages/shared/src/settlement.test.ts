import { describe, expect, it } from "vitest";
import { canConfirmSettlement, canUndoSettlement, maxPayable } from "./settlement.js";

describe("Settlement rules", () => {
  it.each([
    {
      memberId: "payer",
      role: "member",
      confirm: true,
      undo: true,
      confirmedByMemberId: "confirmer",
    },
    {
      memberId: "receiver",
      role: "member",
      confirm: true,
      undo: true,
      confirmedByMemberId: "confirmer",
    },
    {
      memberId: "confirmer",
      role: "member",
      confirm: false,
      undo: true,
      confirmedByMemberId: "confirmer",
    },
    {
      memberId: "other",
      role: "admin",
      confirm: true,
      undo: true,
      confirmedByMemberId: "confirmer",
    },
    {
      memberId: "other",
      role: "member",
      confirm: false,
      undo: false,
      confirmedByMemberId: "confirmer",
    },
    {
      memberId: "confirmer",
      role: "member",
      confirm: false,
      undo: false,
      confirmedByMemberId: null,
    },
  ])("permission: $memberId ($role)", ({ memberId, role, confirm, undo, confirmedByMemberId }) => {
    const actor = { memberId, role };
    expect(canConfirmSettlement(actor, "payer", "receiver")).toBe(confirm);
    expect(
      canUndoSettlement(actor, {
        payerMemberId: "payer",
        receiverMemberId: "receiver",
        confirmedByMemberId,
      }),
    ).toBe(undo);
  });
  it.each([
    [-100, 60, 60],
    [-40, 100, 40],
    [-100, 100, 100],
    [20, 60, 0],
    [-100, -60, 0],
    [-100, 0, 0],
    [0, 60, 0],
    [0, 0, 0],
    [-1, 1, 1],
    [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  ])("minor-unit limit for payer %s, receiver %s is %s", (payer, receiver, expected) => {
    expect(maxPayable(payer, receiver)).toBe(expected);
  });
});
