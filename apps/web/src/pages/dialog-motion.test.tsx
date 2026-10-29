import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

const me = makeUser("小宇");

describe("dialog motion", () => {
  it("gives the delete-group dialog the same enter and exit animation as the others", async () => {
    const user = userEvent.setup();
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "室友", role: "admin" });
      },
      pathFor: () => `/groups/${id}`,
    });

    await user.click(await screen.findByRole("button", { name: "刪除群組" }));

    expect(await screen.findByRole("dialog")).toHaveClass("dialog-content");
  });

  it("gives the delete-expense dialog the shared animation too", async () => {
    const user = userEvent.setup();
    let id = "";
    let eid = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "室友", role: "admin", others: [{ name: "宜庭" }] });
        const ids = groups.members(id).map((m) => m.id);
        eid = groups.addExpense(
          id,
          {
            description: "晚餐",
            category: "餐飲",
            originalAmount: 200,
            originalCurrency: "TWD",
            fxRateScaled: 1_000_000,
            fxDate: "2026-10-29",
            isCustomRate: false,
            settlementAmount: 200,
            payers: [{ memberId: ids[0], amountMinor: 200 }],
            split: { method: "equal", participants: ids },
            expenseDate: "2026-10-29",
            expenseTime: null,
          },
          0,
        );
      },
      pathFor: () => `/groups/${id}/expenses/${eid}`,
    });

    await user.click(await screen.findByRole("button", { name: "刪除" }));

    expect(await screen.findByRole("dialog", { name: "刪除「晚餐」？" })).toHaveClass(
      "dialog-content",
    );
  });
});
