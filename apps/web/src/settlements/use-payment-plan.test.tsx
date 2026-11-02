import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Balance } from "@split/shared";
import { usePaymentPlan } from "./use-payment-plan.js";

const pair = (amount: number): Balance[] => [
  { memberId: "a", amountMinor: -amount },
  { memberId: "b", amountMinor: amount },
];

describe("usePaymentPlan", () => {
  it("derives small plans immediately when balances arrive or change", () => {
    const { result, rerender } = renderHook(({ balances }) => usePaymentPlan(balances), {
      initialProps: { balances: undefined as Balance[] | undefined },
    });
    expect(result.current.status).toBe("computing");
    rerender({ balances: pair(100) });
    expect(result.current).toMatchObject({
      status: "ready",
      plan: { payments: [{ amountMinor: 100 }] },
    });
    rerender({ balances: pair(200) });
    expect(result.current).toMatchObject({
      status: "ready",
      plan: { payments: [{ amountMinor: 200 }] },
    });
  });

  it("does not return a worker result for different balances", async () => {
    const large = Array.from({ length: 21 }, (_, i) => ({
      memberId: String(i),
      amountMinor: i === 0 ? 20 : -1,
    }));
    const { result, rerender } = renderHook(({ balances }) => usePaymentPlan(balances), {
      initialProps: { balances: large },
    });
    expect(result.current.status).toBe("computing");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ balances: pair(10) });
    expect(result.current).toMatchObject({
      status: "ready",
      plan: { payments: [{ amountMinor: 10 }] },
    });
    rerender({ balances: large.map((b) => ({ ...b, amountMinor: b.amountMinor * 2 })) });
    expect(result.current.status).toBe("computing");
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });
});
