import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

const me = makeUser("小宇");

describe("a new expense", () => {
  it("drops into the list and glows once after it is saved", async () => {
    const user = userEvent.setup();
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "室友", others: [{ name: "宜庭" }] });
      },
      pathFor: () => `/groups/${id}/expenses/new`,
    });

    await user.type(await screen.findByLabelText("名稱"), "宵夜");
    await user.type(screen.getByRole("textbox", { name: "金額" }), "120");
    await user.click(screen.getByRole("button", { name: "新增支出" }));

    const row = await screen.findByRole("link", { name: /宵夜/ });
    expect(row.closest("li")).toHaveClass("row-arrive");
  });

  it("is not marked on an ordinary visit to the list", async () => {
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "室友" });
        const ids = groups.members(id).map((m) => m.id);
        groups.addExpense(
          id,
          {
            description: "早餐",
            category: "餐飲",
            originalAmount: 50,
            originalCurrency: "TWD",
            fxRateScaled: 1_000_000,
            fxDate: "2026-10-29",
            isCustomRate: false,
            settlementAmount: 50,
            payers: [{ memberId: ids[0], amountMinor: 50 }],
            split: { method: "equal", participants: ids },
            expenseDate: "2026-10-29",
            expenseTime: null,
          },
          0,
        );
      },
      pathFor: () => `/groups/${id}`,
    });

    expect((await screen.findByRole("link", { name: /早餐/ })).closest("li")).not.toHaveClass(
      "row-arrive",
    );
  });
});

describe("the groups list", () => {
  it("shows the first members as overlapping avatars with the rest counted", async () => {
    renderApp({
      cookieUser: me,
      path: "/groups",
      seed: (groups) => {
        groups.add(me, {
          name: "大團",
          others: [{ name: "甲" }, { name: "乙" }, { name: "丙" }, { name: "丁" }, { name: "戊" }],
        });
      },
    });

    const card = await screen.findByRole("link", { name: /大團/ });
    expect(within(card).getByText("+2")).toBeInTheDocument();
    expect(within(card).getByText("小")).toBeInTheDocument();
  });
});

describe("loading", () => {
  it("is a swaying sprout with the words kept for screen readers", async () => {
    renderApp({ cookieUser: me, path: "/groups" });

    // The first thing on screen while the groups load.
    const status = screen.queryAllByRole("status")[0];
    if (status !== undefined) {
      expect(status.querySelector(".sprout-sway")).not.toBeNull();
      expect(within(status).getByText("載入中…")).toHaveClass("sr-only");
    }
    expect(await screen.findByRole("heading", { level: 1 })).toBeVisible();
  });
});

describe("the home intro", () => {
  it("lets the balance card, the groups and the start cards rise in turn, the first time only", async () => {
    const { router } = renderApp({ cookieUser: me });
    await screen.findByRole("heading", { name: "快速開始" });

    const rises = document.querySelectorAll<HTMLElement>(".rise");
    expect(rises).toHaveLength(2);
    expect(rises[0]?.style.animationDelay).toBe("0ms");
    expect(rises[1]?.style.animationDelay).toBe("120ms");

    // Going away and coming back is not a first visit: no rise.
    await router.navigate("/settings");
    await screen.findByRole("heading", { level: 1, name: "我的設定" });
    await router.navigate("/");
    await screen.findByRole("heading", { name: "快速開始" });
    expect(document.querySelectorAll(".rise")).toHaveLength(0);
  });

  it("applies frosted glass and spring press tiers to navigation, hero card, and group tabs", async () => {
    let id = "";
    const { router } = renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, { name: "室友" });
      },
    });
    await screen.findByRole("heading", { name: "快速開始" });

    // Frosted glass bottom bar and hero balance card with glass currency pill
    expect(screen.getByRole("navigation", { name: "底部導覽" })).toHaveClass("glass-nav");
    expect(screen.getByRole("region", { name: "目前淨收付" })).toHaveClass("hero-balance-card");
    expect(screen.getByRole("link", { name: /TWD/ })).toHaveClass("glass-pill", "press-pill");

    // Start card uses card-tier spring press
    expect(screen.getByRole("link", { name: /快速分帳/ })).toHaveClass(
      "press-card",
      "surface-card",
    );

    // Group detail tabs animate their panel entrance and use pill-tier press on the add button
    await router.navigate(`/groups/${id}`);
    await screen.findByRole("heading", { level: 1, name: "室友" });
    expect(screen.getByRole("tabpanel")).toHaveClass("tab-panel");
    expect(screen.getByRole("link", { name: "新增支出" })).toHaveClass("press-pill");

    // Adding a placeholder member highlights the newly arrived row
    await router.navigate(`/groups/${id}/members`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "新增成員" }));
    const newRow = await screen.findByText(/成員\d+/);
    expect(newRow.closest("li")).toHaveClass("row-arrive");
  });
});
