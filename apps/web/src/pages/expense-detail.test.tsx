import { act, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import type { FakeGroups, SeedGroup } from "../../test/fake-groups.js";
import { renderApp } from "../../test/render-app.js";

const me = makeUser("小宇");

/** A Group of me, 宜庭 and 阿哲 with one Expense created by Member `creator` (0 is me). */
function withExpense(options: {
  role?: SeedGroup["role"];
  creator?: number;
  body?: (memberIds: string[]) => Record<string, unknown>;
  path: (groupId: string, expenseId: string) => string;
  also?: (groups: FakeGroups, groupId: string) => void;
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
      options.also?.(groups, id);
    },
    pathFor: () => options.path(id, eid),
  });
  return { ...app, id: () => id, eid: () => eid };
}

describe("Expense list and detail", () => {
  it("stamps the receipt only when the group has no outstanding balances", async () => {
    withExpense({ path: (id, eid) => `/groups/${id}/expenses/${eid}` });
    await screen.findByRole("heading", { name: "晚餐" });
    expect(screen.queryByRole("status", { name: "已結清 · SETTLED" })).toBeNull();
  });

  it("embosses a settled receipt when the payer covered only their own share", async () => {
    withExpense({
      path: (id, eid) => `/groups/${id}/expenses/${eid}`,
      body: (ids) => ({
        description: "自己的午餐",
        category: "餐飲",
        originalAmount: 100,
        originalCurrency: "TWD",
        fxRateScaled: 1_000_000,
        fxDate: "2026-05-17",
        isCustomRate: false,
        settlementAmount: 100,
        payers: [{ memberId: ids[0], amountMinor: 100 }],
        split: { method: "equal", participants: [ids[0]] },
        expenseDate: "2026-05-17",
        expenseTime: null,
      }),
    });
    expect(await screen.findByRole("status", { name: "已結清 · SETTLED" })).toBeVisible();
  });

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

  it("edits only the title of an old foreign-currency expense without requesting rates", async () => {
    const user = userEvent.setup();
    const { api, id, eid } = withExpense({
      path: (groupId, expenseId) => `/groups/${groupId}/expenses/${expenseId}/edit`,
      body: (ids) => ({
        description: "Old dinner",
        category: "餐飲",
        originalAmount: 1000,
        originalCurrency: "USD",
        fxRateScaled: 32_000_000,
        fxDate: "2010-05-17",
        isCustomRate: false,
        settlementAmount: 320,
        payers: [{ memberId: ids[0], amountMinor: 1000 }],
        split: { method: "equal", participants: ids },
        expenseDate: "2010-05-17",
        expenseTime: null,
      }),
    });
    api.failNext("GET /api/v1/rates", "VALIDATION_FAILED", 400);
    const title = await screen.findByLabelText("名稱");
    await user.clear(title);
    await user.type(title, "Updated dinner");
    expect(screen.getByRole("button", { name: "儲存變更" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "儲存變更" }));
    await screen.findByRole("heading", { name: "Updated dinner" });
    expect(api.requests.filter((r) => r.route === "GET /api/v1/rates")).toHaveLength(0);
    expect(api.groups.expenses.list(id()).find((expense) => expense.id === eid())).toMatchObject({
      description: "Updated dinner",
      fxRateScaled: 32_000_000,
      fxDate: "2010-05-17",
      isCustomRate: false,
      settlementAmount: 320,
    });
  });

  it("keeps the typed converted amount when editing a custom-rate expense's original amount", async () => {
    const user = userEvent.setup();
    const { api, id, eid } = withExpense({
      path: (groupId, expenseId) => `/groups/${groupId}/expenses/${expenseId}/edit`,
      body: (ids) => ({
        description: "Custom dinner",
        category: "餐飲",
        originalAmount: 1000,
        originalCurrency: "USD",
        fxRateScaled: 32_000_000,
        fxDate: "2026-05-17",
        isCustomRate: true,
        settlementAmount: 320,
        payers: [{ memberId: ids[0], amountMinor: 1000 }],
        split: { method: "equal", participants: ids },
        expenseDate: "2026-05-17",
        expenseTime: null,
      }),
    });
    const amount = await screen.findByLabelText("金額");
    await user.clear(amount);
    await user.type(amount, "20");
    await user.click(screen.getByRole("button", { name: "儲存變更" }));
    await screen.findByRole("heading", { level: 1, name: "開銷詳情" });
    expect(api.groups.expenses.list(id()).find((expense) => expense.id === eid())).toMatchObject({
      originalAmount: 2000,
      settlementAmount: 320,
      fxRateScaled: 16_000_000,
      isCustomRate: true,
    });
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

    expect(await screen.findByText("喝杯咖啡？記下第一筆吧 ☕️")).toBeVisible();
    expect(api.groups.expenses.list(id())).toHaveLength(0);
  });

  it("returns to the Group after deletion while its refetch is still pending", async () => {
    const user = userEvent.setup();
    const { api, router, id } = withExpense({ path: (id, eid) => `/groups/${id}/expenses/${eid}` });
    await user.click(await screen.findByRole("button", { name: "刪除" }));
    const release = api.holdResponses(`GET /api/v1/groups/${id()}`);
    try {
      const dialog = await screen.findByRole("dialog", { name: "刪除「晚餐」？" });
      await user.click(within(dialog).getByRole("button", { name: "刪除這筆" }));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/groups/${id()}`);
      });
      expect(api.groups.expenses.list(id())).toHaveLength(0);
    } finally {
      release();
    }
  });

  it("leaves the Expense at once, before the server answers the delete", async () => {
    const user = userEvent.setup();
    const { api, router, id, eid } = withExpense({
      path: (groupId, expenseId) => `/groups/${groupId}/expenses/${expenseId}`,
    });
    await user.click(await screen.findByRole("button", { name: "刪除" }));
    const release = api.holdResponses(`DELETE /api/v1/groups/${id()}/expenses/${eid()}`);
    try {
      const dialog = await screen.findByRole("dialog", { name: "刪除「晚餐」？" });
      await user.click(within(dialog).getByRole("button", { name: "刪除這筆" }));
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/groups/${id()}`);
      });
      expect(await screen.findByText("喝杯咖啡？記下第一筆吧 ☕️")).toBeVisible();
    } finally {
      release();
    }
  });

  it("puts the Expense back and says why when deletion fails", async () => {
    const user = userEvent.setup();
    const { api, id, eid } = withExpense({
      path: (groupId, expenseId) => `/groups/${groupId}/expenses/${expenseId}`,
    });
    api.failNext(`DELETE /api/v1/groups/${id()}/expenses/${eid()}`);
    await user.click(await screen.findByRole("button", { name: "刪除" }));
    const dialog = await screen.findByRole("dialog", { name: "刪除「晚餐」？" });
    await user.click(within(dialog).getByRole("button", { name: "刪除這筆" }));

    expect(await screen.findByText(/刪除失敗/)).toBeVisible();
    expect(await screen.findByText("晚餐")).toBeVisible();
    expect(api.groups.expenses.list(id())).toHaveLength(1);
  });

  it("hides the Expense while its delete is pending, and shows it again when the delete fails", async () => {
    const user = userEvent.setup();
    const { api, id, eid } = withExpense({ path: (groupId) => `/groups/${groupId}` });
    const route = `DELETE /api/v1/groups/${id()}/expenses/${eid()}`;
    await user.click(await screen.findByRole("link", { name: /晚餐/ }));
    await user.click(await screen.findByRole("button", { name: "刪除" }));
    api.failNext(route);
    const release = api.holdResponses(route);
    try {
      const dialog = await screen.findByRole("dialog", { name: "刪除「晚餐」？" });
      await user.click(within(dialog).getByRole("button", { name: "刪除這筆" }));
      expect(await screen.findByText("喝杯咖啡？記下第一筆吧 ☕️")).toBeVisible();
      expect(screen.queryByRole("link", { name: /晚餐/ })).toBeNull();
    } finally {
      release();
    }
    expect(await screen.findByText(/刪除失敗/)).toBeVisible();
    expect(await screen.findByRole("link", { name: /晚餐/ })).toBeVisible();
  });

  it("keeps the overview totals unchanged while a delete is pending", async () => {
    const user = userEvent.setup();
    const { api, id, eid } = withExpense({
      path: (groupId) => `/groups/${groupId}`,
      also: (groups, groupId) => {
        const ids = groups.members(groupId).map((m) => m.id);
        groups.addExpense(groupId, {
          description: "早餐",
          category: "餐飲",
          originalAmount: 100,
          originalCurrency: "TWD",
          fxRateScaled: 1_000_000,
          fxDate: "2026-05-17",
          isCustomRate: false,
          settlementAmount: 100,
          payers: [{ memberId: ids[0], amountMinor: 100 }],
          split: { method: "equal", participants: ids },
          expenseDate: "2026-05-17",
          expenseTime: null,
        });
      },
    });
    const route = `DELETE /api/v1/groups/${id()}/expenses/${eid()}`;
    await user.click(await screen.findByRole("link", { name: /晚餐/ }));
    await user.click(await screen.findByRole("button", { name: "刪除" }));
    api.failNext(route);
    const release = api.holdResponses(route);
    try {
      const dialog = await screen.findByRole("dialog", { name: "刪除「晚餐」？" });
      await user.click(within(dialog).getByRole("button", { name: "刪除這筆" }));
      await waitFor(() => {
        expect(screen.queryByRole("link", { name: /晚餐/ })).toBeNull();
      });
      expect(screen.getByText(/本群累計 NT\$ 2,260/)).toBeVisible();
    } finally {
      release();
    }
  });

  it("settles an edit whose answer was lost instead of reporting a conflict on retry", async () => {
    const user = userEvent.setup();
    const { api, id, eid } = withExpense({
      path: (groupId, expenseId) => `/groups/${groupId}/expenses/${expenseId}/edit`,
    });
    const route = `PATCH /api/v1/groups/${id()}/expenses/${eid()}`;
    api.dropNextResponse(route);
    const name = await screen.findByLabelText("名稱");
    await user.clear(name);
    await user.type(name, "宵夜");
    await user.click(screen.getByRole("button", { name: /儲存/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("網路連線不穩");
    await user.click(screen.getByRole("button", { name: "重試" }));

    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
    expect(api.groups.expenses.list(id())[0]?.description).toBe("宵夜");
  });

  it("still reports a conflict when the Expense does not hold our edit", async () => {
    const user = userEvent.setup();
    const { api, id, eid } = withExpense({
      path: (groupId, expenseId) => `/groups/${groupId}/expenses/${expenseId}/edit`,
    });
    const route = `PATCH /api/v1/groups/${id()}/expenses/${eid()}`;
    const name = await screen.findByLabelText("名稱");
    await user.clear(name);
    await user.type(name, "宵夜");
    api.failNext(route, "EDIT_CONFLICT", 409);
    await user.click(screen.getByRole("button", { name: /儲存/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("剛被其他人修改過");
  });

  it("shows a rejected edit on the Expense page it returned to", async () => {
    const user = userEvent.setup();
    const { api, id, eid, router } = withExpense({
      path: (groupId, expenseId) => `/groups/${groupId}/expenses/${expenseId}/edit`,
    });
    api.failNext(`PATCH /api/v1/groups/${id()}/expenses/${eid()}`);
    const name = await screen.findByLabelText("名稱");
    await user.clear(name);
    await user.type(name, "宵夜");
    await user.click(screen.getByRole("button", { name: /儲存/ }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/groups/${id()}/expenses/${eid()}`);
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("沒有儲存成功");
    expect(screen.getByRole("button", { name: "重試" })).toBeVisible();
  });

  it("does not show a failed delete from one Group in another Group", async () => {
    const user = userEvent.setup();
    let other = "";
    const { api, router, id, eid } = withExpense({
      path: (groupId, expenseId) => `/groups/${groupId}/expenses/${expenseId}`,
      also: (groups) => {
        other = groups.add(me, { name: "旅伴", others: [{ name: "宜庭" }] });
      },
    });
    api.failNext(`DELETE /api/v1/groups/${id()}/expenses/${eid()}`);
    await user.click(await screen.findByRole("button", { name: "刪除" }));
    const dialog = await screen.findByRole("dialog", { name: "刪除「晚餐」？" });
    await user.click(within(dialog).getByRole("button", { name: "刪除這筆" }));
    expect(await screen.findByText(/刪除失敗/)).toBeVisible();

    await router.navigate(`/groups/${other}`);

    expect(await screen.findByRole("heading", { name: "旅伴" })).toBeVisible();
    expect(screen.queryByText(/刪除失敗/)).toBeNull();
  });

  it("sends one delete when the confirm button is pressed twice at once", async () => {
    const user = userEvent.setup();
    const { api, id, eid } = withExpense({
      path: (groupId, expenseId) => `/groups/${groupId}/expenses/${expenseId}`,
    });
    const route = `DELETE /api/v1/groups/${id()}/expenses/${eid()}`;
    await user.click(await screen.findByRole("button", { name: "刪除" }));
    const release = api.holdResponses(route);
    try {
      const dialog = await screen.findByRole("dialog", { name: "刪除「晚餐」？" });
      const confirm = within(dialog).getByRole("button", { name: "刪除這筆" });
      await act(async () => {
        confirm.click();
        confirm.click();
        await Promise.resolve();
      });
      expect(api.requests.filter((r) => r.route === route)).toHaveLength(1);
    } finally {
      release();
    }
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
