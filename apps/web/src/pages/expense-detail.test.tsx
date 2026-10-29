import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import type { SeedGroup } from "../../test/fake-groups.js";
import { renderApp } from "../../test/render-app.js";

const me = makeUser("小宇");

/** A Group of me, 宜庭 and 阿哲 with one Expense created by Member `creator` (0 is me). */
function withExpense(options: {
  role?: SeedGroup["role"];
  creator?: number;
  body?: (memberIds: string[]) => Record<string, unknown>;
  path: (groupId: string, expenseId: string) => string;
}) {
  let id = "";
  let eid = "";
  const app = renderApp({
    cookieUser: me,
    seed: (groups) => {
      id = groups.add(me, {
        name: "室友",
        settlementCurrency: "TWD",
        role: options.role ?? "admin",
        others: [{ name: "宜庭", role: "admin" }, { name: "阿哲" }],
      });
      const ids = groups.members(id).map((m) => m.id);
      eid = groups.addExpense(
        id,
        options.body?.(ids) ?? {
          description: "晚餐",
          category: "餐飲",
          originalAmount: 2160,
          originalCurrency: "TWD",
          fxRateScaled: 1_000_000,
          fxDate: "2026-05-17",
          isCustomRate: false,
          settlementAmount: 2160,
          payers: [{ memberId: ids[0], amountMinor: 2160 }],
          split: { method: "equal", participants: ids },
          expenseDate: "2026-05-17",
          expenseTime: "19:30",
        },
        options.creator ?? 0,
      );
    },
    pathFor: () => options.path(id, eid),
  });
  return { ...app, id: () => id, eid: () => eid };
}

describe("Expense list and detail", () => {
  it("lists the Group's Expenses on the 帳目 tab and opens one", async () => {
    const user = userEvent.setup();
    withExpense({ path: (id) => `/groups/${id}` });

    const row = await screen.findByRole("link", { name: /晚餐/ });
    expect(row).toHaveTextContent("NT$ 2,160");
    expect(row).toHaveTextContent("小宇 先付");
    expect(screen.getByRole("link", { name: "新增支出" })).toBeVisible();

    await user.click(row);
    expect(await screen.findByRole("heading", { level: 1, name: "開銷詳情" })).toBeVisible();
    expect(screen.getByText("先付 NT$ 2,160")).toBeVisible();
    const lines = within(screen.getByRole("list", { name: "分帳明細" }));
    const items = lines.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("小宇（你）");
    expect(items[1]).toHaveTextContent("宜庭");
    expect(items[1]).not.toHaveTextContent("（你）");
    for (const item of items) expect(item).toHaveTextContent("NT$ 720");
    // The header names the Expense first, with its category and a plain Chinese date.
    expect(screen.getByRole("heading", { level: 2, name: "晚餐" })).toBeVisible();
    expect(screen.getByText("2026年5月17日 19:30")).toBeVisible();
  });

  it("shows a foreign-currency Expense's rate, its date, the edited flag and the converted amount", async () => {
    withExpense({
      path: (id, eid) => `/groups/${id}/expenses/${eid}`,
      body: (ids) => ({
        description: "門票",
        category: "娛樂",
        originalAmount: 1000,
        originalCurrency: "USD",
        fxRateScaled: 32_000_000,
        fxDate: "2026-05-17",
        isCustomRate: true,
        settlementAmount: 320,
        payers: [{ memberId: ids[0], amountMinor: 1000 }],
        split: { method: "equal", participants: ids },
        expenseDate: "2026-05-17",
      }),
    });

    expect(await screen.findByText("US$ 10.00")).toBeVisible();
    expect(screen.getByText(/1 USD ≈ 32\.0000 TWD（2026-05-17）/)).toBeVisible();
    expect(screen.getByText("已自訂")).toBeVisible();
    expect(screen.getByText("換算後 NT$ 320")).toBeVisible();
  });

  it("edits the Expense under If-Match", async () => {
    const user = userEvent.setup();
    const { api, id, eid } = withExpense({ path: (id, eid) => `/groups/${id}/expenses/${eid}` });

    await user.click(await screen.findByRole("link", { name: "編輯" }));
    const amount = await screen.findByLabelText("金額");
    expect(amount).toHaveValue("2160");
    expect(screen.getByLabelText("名稱")).toHaveValue("晚餐");
    await user.clear(amount);
    await user.type(amount, "2400");
    await user.click(screen.getByRole("button", { name: "儲存變更" }));

    expect(await screen.findByRole("heading", { level: 1, name: "開銷詳情" })).toBeVisible();
    expect(await screen.findByText("NT$ 2,400")).toBeVisible();
    const patch = api.requests.find(
      (r) => r.route === `PATCH /api/v1/groups/${id()}/expenses/${eid()}`,
    );
    expect(patch?.headers.get("If-Match")).toBe(String(api.groups.now));
  });

  it("warns about altering debts when editing an Expense in a Group with Settlements", async () => {
    let id = "";
    let eid = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, {
          name: "室友",
          settlementCurrency: "TWD",
          role: "admin",
          others: [{ name: "宜庭", role: "admin" }],
        });
        const ids = groups.members(id).map((m) => m.id);
        eid = groups.addExpense(
          id,
          {
            description: "晚餐",
            category: "餐飲",
            originalAmount: 1000,
            originalCurrency: "TWD",
            fxRateScaled: 1_000_000,
            fxDate: "2026-05-17",
            isCustomRate: false,
            settlementAmount: 1000,
            payers: [{ memberId: ids[0], amountMinor: 1000 }],
            split: { method: "equal", participants: ids },
            expenseDate: "2026-05-17",
          },
          0,
        );
        groups.addSettlement(id, { payer: 1, receiver: 0, amount: 500 });
      },
      pathFor: () => `/groups/${id}/expenses/${eid}/edit`,
    });

    expect(await screen.findByText("此群組已有結算紀錄，修改會改變債務")).toBeVisible();
  });

  it("deletes the Expense after confirming", async () => {
    const user = userEvent.setup();
    const { api, id } = withExpense({ path: (id, eid) => `/groups/${id}/expenses/${eid}` });

    await user.click(await screen.findByRole("button", { name: "刪除" }));
    const dialog = await screen.findByRole("dialog", { name: "刪除「晚餐」？" });
    await user.click(within(dialog).getByRole("button", { name: "刪除這筆" }));

    expect(await screen.findByText("還沒有任何帳目，記下第一筆吧！")).toBeVisible();
    expect(api.groups.expenses.list(id())).toHaveLength(0);
  });

  it("offers edit and delete only to the creator or an Admin", async () => {
    withExpense({
      role: "member",
      creator: 1,
      path: (id, eid) => `/groups/${id}/expenses/${eid}`,
    });

    expect(await screen.findByRole("heading", { level: 1, name: "開銷詳情" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "編輯" })).toBeNull();
    expect(screen.queryByRole("button", { name: "刪除" })).toBeNull();
  });
});
