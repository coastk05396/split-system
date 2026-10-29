import type { Expense, ExpenseInput } from "@split/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { clock } from "./auth-harness.js";
import { balances, createExpense, twdExpense } from "./expenses-harness.js";
import { groupWith, listMembers, send } from "./groups-harness.js";

type Step =
  | { kind: "create"; input: (ids: string[]) => ExpenseInput }
  | { kind: "edit"; pick: number; input: (ids: string[]) => ExpenseInput }
  | { kind: "delete"; pick: number };

const anyInput = fc
  .record({
    amount: fc.integer({ min: 1, max: 99_999 }),
    payer: fc.nat(3),
    participants: fc.uniqueArray(fc.nat(3), { minLength: 1, maxLength: 4 }),
    shares: fc.array(fc.integer({ min: 1, max: 99 }), { minLength: 4, maxLength: 4 }),
    method: fc.constantFrom("equal" as const, "shares" as const, "usd" as const),
  })
  .map((r) => (ids: string[]): ExpenseInput => {
    const id = (i: number) => ids[i] ?? "";
    const participants = r.participants.map(id);
    const base = twdExpense(id(r.payer), participants, r.amount);
    if (r.method === "shares") {
      return {
        ...base,
        split: {
          method: "shares",
          lines: r.participants.map((i) => ({ memberId: id(i), shares: r.shares[i] ?? 1 })),
        },
      };
    }
    if (r.method === "usd") {
      // A custom rate: the typed converted amount is the authority.
      return {
        ...base,
        originalCurrency: "USD",
        fxRateScaled: 31_523_400,
        isCustomRate: true,
        settlementAmount: Math.max(1, Math.round(r.amount * 0.3)),
      };
    }
    return base;
  });

const anyStep: fc.Arbitrary<Step> = fc.oneof(
  anyInput.map((input) => ({ kind: "create" as const, input })),
  fc.record({ pick: fc.nat(), input: anyInput }).map((s) => ({ kind: "edit" as const, ...s })),
  fc.nat().map((pick) => ({ kind: "delete" as const, pick })),
);

describe("Balances", () => {
  it("sum to zero and match the Expenses after any sequence of create, edit and delete", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(anyStep, { minLength: 1, maxLength: 8 }), async (steps) => {
        const { admin, group } = await groupWith("小宇", "阿明", "小美", "阿傑");
        const ids = (await listMembers(admin, group.id)).map((m) => m.id);
        const live: Expense[] = [];
        for (const step of steps) {
          clock.now += 2_100;
          if (step.kind === "create") {
            live.push(await createExpense(admin, group.id, step.input(ids)));
            continue;
          }
          const target = live[step.pick % Math.max(1, live.length)];
          if (target === undefined) continue;
          const path = `/groups/${group.id}/expenses/${target.id}`;
          if (step.kind === "edit") {
            const res = await send(admin, "PATCH", path, step.input(ids), {
              "If-Match": String(target.updatedAt),
            });
            expect(res.status).toBe(200);
            live.splice(live.indexOf(target), 1, await res.json<Expense>());
          } else {
            expect((await send(admin, "DELETE", path)).status).toBe(204);
            live.splice(live.indexOf(target), 1);
          }
        }

        const stored = await balances(admin, group.id);
        expect([...stored.values()].reduce((s, b) => s + b, 0)).toBe(0);
        const rebuilt = new Map(ids.map((id) => [id, 0]));
        for (const e of live) {
          for (const p of e.payers)
            rebuilt.set(p.memberId, (rebuilt.get(p.memberId) ?? 0) + p.settlementAmount);
          for (const s of e.splits)
            rebuilt.set(s.memberId, (rebuilt.get(s.memberId) ?? 0) - s.settlementAmount);
        }
        expect(stored).toEqual(rebuilt);
      }),
      { numRuns: 15 },
    );
  }, 300_000);
});
