import { describe, expect, it } from "vitest";
import { handlePaymentPlanMessage } from "./payment-plan-worker.js";

describe("handlePaymentPlanMessage", () => {
  it("answers a list of Balances with its Payment plan", () => {
    expect(
      handlePaymentPlanMessage([
        { memberId: "a", amountMinor: -300 },
        { memberId: "b", amountMinor: 300 },
      ]),
    ).toEqual({
      ok: true,
      value: {
        method: "exact",
        payments: [{ fromMemberId: "a", toMemberId: "b", amountMinor: 300 }],
        maxPayments: 1,
      },
    });
  });

  it("answers a malformed message with an error code instead of throwing", () => {
    expect(handlePaymentPlanMessage({ balances: "nope" })).toEqual({
      ok: false,
      error: "PAYMENT_PLAN_INPUT_INVALID",
    });
    expect(handlePaymentPlanMessage([{ memberId: "a", amountMinor: 1 }])).toEqual({
      ok: false,
      error: "BALANCES_SUM_NOT_ZERO",
    });
  });
});
