import type { Settlement } from "@split/shared";
import { describe, expect, it } from "vitest";
import { balancesAfterPending } from "./model.js";

const balances = [
  { memberId: "me", balance: -100 },
  { memberId: "a", balance: 60 },
  { memberId: "b", balance: 40 },
];

const pending = (payer: string, receiver: string, amount: number, createdAt: number) =>
  ({ payerMemberId: payer, receiverMemberId: receiver, amount, createdAt }) as Settlement;

const by = (list: { memberId: string; amountMinor: number }[]) =>
  Object.fromEntries(list.map((b) => [b.memberId, b.amountMinor]));

describe("balancesAfterPending", () => {
  it("returns the Balances unchanged when nothing is pending", () => {
    expect(by(balancesAfterPending(balances, []))).toEqual({ me: -100, a: 60, b: 40 });
  });

  it("moves each pending payment as if it were confirmed", () => {
    expect(by(balancesAfterPending(balances, [pending("me", "a", 50, 1)]))).toEqual({
      me: -50,
      a: 10,
      b: 40,
    });
  });

  it("never carries a Balance past zero, as confirming would not", () => {
    // 80 is more than 宜庭 is owed (60), and 30 more than I still owe after that.
    const result = balancesAfterPending(balances, [
      pending("me", "a", 80, 1),
      pending("me", "b", 80, 2),
    ]);
    expect(by(result)).toEqual({ me: 0, a: 0, b: 0 });
  });

  it("applies pending payments oldest first, whatever order they arrive in", () => {
    const newest = pending("me", "b", 40, 2);
    const oldest = pending("me", "a", 60, 1);
    expect(by(balancesAfterPending(balances, [newest, oldest]))).toEqual({ me: 0, a: 0, b: 0 });
  });

  it("ignores a pending payment between Members who are not in the Balances", () => {
    expect(by(balancesAfterPending(balances, [pending("x", "y", 10, 1)]))).toEqual({
      me: -100,
      a: 60,
      b: 40,
    });
  });
});
