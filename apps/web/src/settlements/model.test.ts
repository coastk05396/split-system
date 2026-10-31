import type { Settlement } from "@split/shared";
import { describe, expect, it } from "vitest";
import { type BalanceRow, canConfirm, canUndo, maxPayable } from "./model.js";

const row = (memberId: string, balance: number): BalanceRow => ({
  memberId,
  displayName: memberId,
  status: "active",
  balance,
});

describe("Settlement permissions and limits", () => {
  it("allows the payer, the receiver, or an Admin to confirm a Settlement", () => {
    const payer = row("a", -100);
    const receiver = row("b", 100);
    expect(canConfirm({ memberId: "a", role: "member" }, payer, receiver)).toBe(true);
    expect(canConfirm({ memberId: "b", role: "member" }, payer, receiver)).toBe(true);
    expect(canConfirm({ memberId: "c", role: "admin" }, payer, receiver)).toBe(true);
    expect(canConfirm({ memberId: "c", role: "member" }, payer, receiver)).toBe(false);
  });

  it("allows the payer, the receiver, the confirmer, or an Admin to undo a Settlement", () => {
    const settlement = {
      payerMemberId: "a",
      receiverMemberId: "b",
      confirmedByMemberId: "b",
    } as Settlement;
    expect(canUndo({ memberId: "a", role: "member" }, settlement)).toBe(true);
    expect(canUndo({ memberId: "b", role: "member" }, settlement)).toBe(true);
    expect(canUndo({ memberId: "c", role: "admin" }, settlement)).toBe(true);
    expect(canUndo({ memberId: "c", role: "member" }, settlement)).toBe(false);
  });

  it("caps maxPayable so neither Balance passes zero", () => {
    expect(maxPayable(row("a", -100), row("b", 60))).toBe(60);
    expect(maxPayable(row("a", 20), row("b", 60))).toBe(0);
  });
});
