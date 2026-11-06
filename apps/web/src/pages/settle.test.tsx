import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryObserver } from "@tanstack/react-query";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import type { FakeGroups, SeedGroup } from "../../test/fake-groups.js";
import type { SettlementPage } from "@split/shared";
import type { InfiniteData } from "@tanstack/react-query";
import { handleGroupSignal } from "../groups/data.js";
import { settlementKeys } from "../groups/data.js";
import { renderApp, type RenderAppOptions } from "../../test/render-app.js";

const me = makeUser("小宇");

/** Opens the 結算 tab of a seeded Group; `after` seeds Settlements once the Group exists. */
async function openSettle(
  seed: SeedGroup,
  after?: (groups: FakeGroups, id: string) => void,
  options: RenderAppOptions = {},
) {
  let id = "";
  const app = renderApp({
    cookieUser: me,
    seed: (groups) => {
      id = groups.add(me, seed);
      after?.(groups, id);
    },
    pathFor: () => `/groups/${id}`,
    ...options,
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("tab", { name: "結算" }));
  return { ...app, user, id: () => id };
}

/** 小宇 is owed NT$ 300: 宜庭 owes 100, 阿哲 owes 200. */
const owedToMe: SeedGroup = {
  name: "台南小旅行",
  myBalance: 300,
  others: [
    { name: "宜庭", balance: -100 },
    { name: "阿哲", balance: -200 },
  ],
};

const plan = () => screen.findByRole("list", { name: "要付給誰" });
const rows = async () =>
  within(await plan())
    .getAllByRole("listitem")
    .map((li) => li.textContent);

describe("When the other person confirms a payment", () => {
  /** The payer's own screen records the payment; this client hears of it by the live signal. */
  const heardOf = (
    api: { groups: FakeGroups },
    queryClient: Parameters<typeof handleGroupSignal>[0],
    id: string,
  ) => {
    api.groups.addSettlement(id, { payer: 2, receiver: 0, amount: 200 }, 2);
    return act(() => handleGroupSignal(queryClient, id, 9_999));
  };

  it("takes that payment off this screen's plan without a reload", async () => {
    const { api, id, queryClient } = await openSettle(owedToMe);
    expect(await rows()).toHaveLength(2);

    await heardOf(api, queryClient, id());

    await waitFor(async () => {
      expect(await rows()).toEqual([expect.stringContaining("宜庭")]);
    });
  });

  it("closes the open confirm dialog and records nothing a second time", async () => {
    const { user, api, id, queryClient } = await openSettle(owedToMe);
    await user.click(
      (await row("要付給誰", "阿哲付給你")).getByRole("button", { name: "確認收款" }),
    );
    await screen.findByRole("dialog", { name: "這筆款項已付清嗎？" });

    await heardOf(api, queryClient, id());

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "這筆款項已付清嗎？" })).toBeNull();
    });
    expect(
      api.requests.filter((r) => r.route === `POST /api/v1/groups/${id()}/settlements`),
    ).toEqual([]);
    expect(api.groups.settlements.list(id())).toHaveLength(1);
  });
});

describe("Balances and the Payment plan", () => {
  it("makes the collapsed chart inert", async () => {
    const { user } = await openSettle(owedToMe);
    const chart = await screen.findByRole("list", { name: "大家的結餘" });
    const container = chart.closest(".collapse-grid");
    expect(container).not.toHaveAttribute("inert");
    await user.click(screen.getByRole("button", { name: "大家的結餘" }));
    expect(container).toHaveAttribute("inert");
    await user.click(screen.getByRole("button", { name: "大家的結餘" }));
    expect(container).not.toHaveAttribute("inert");
  });
  it("draws everyone's Balance as bars, the biggest receiver first, settled people folded away", async () => {
    await openSettle({
      name: "台南小旅行",
      myBalance: 300,
      others: [
        { name: "宜庭", balance: -100 },
        { name: "阿哲", balance: -200 },
        { name: "Gulu", balance: 0 },
      ],
    });

    const chart = await screen.findByRole("list", { name: "大家的結餘" });
    expect(
      within(chart)
        .getAllByRole("listitem")
        .map((li) => [
          within(li).getByRole("button").getAttribute("aria-label"),
          within(li).getByText(/^(小宇|宜庭|阿哲)$/).textContent,
          li.textContent.match(/[+-]NT\$ \d+/)?.[0],
        ]),
    ).toEqual([
      ["小宇（你）", "小宇", "+NT$ 300"],
      ["宜庭", "宜庭", "-NT$ 100"],
      ["阿哲", "阿哲", "-NT$ 200"],
    ]);
    expect(screen.getByText("其他 1 人已結清")).toBeVisible();
    expect(screen.queryByText("紅色是要付，綠色是可收")).toBeNull();
  });

  it("leaves the chart out when everyone is settled", async () => {
    await openSettle({ name: "室友", others: [{ name: "宜庭" }] });

    expect(await screen.findByText("大家都結清了！")).toBeVisible();
    expect(screen.queryByRole("list", { name: "大家的結餘" })).toBeNull();
  });

  it("shows my Balance and the fewest-payments plan in whole dollars", async () => {
    await openSettle(owedToMe);

    expect(await screen.findByText("NT$ 200")).toBeVisible();
    expect(await screen.findAllByText("你可收")).toHaveLength(2);
    expect(screen.queryByText("最少筆數")).toBeNull();
    expect(await rows()).toEqual([
      expect.stringContaining("阿哲付給你NT$ 200"),
      expect.stringContaining("宜庭付給你NT$ 100"),
    ]);
  });

  it("labels the plan 至多 N−1 筆 from 21 non-zero Balances on", async () => {
    const debtors = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ name: `成員${String(i + 1)}`, balance: -10 }));
    await openSettle({ name: "大團", myBalance: 200, others: debtors(20) });

    expect(await screen.findByText("至多 20 筆")).toBeVisible();
    expect(screen.queryByText("最少筆數")).toBeNull();
    expect(await rows()).toHaveLength(20);
  });

  it("shows no approximate-plan label at exactly 20 non-zero Balances", async () => {
    const debtors = Array.from({ length: 19 }, (_, i) => ({
      name: `成員${String(i + 1)}`,
      balance: -10,
    }));
    await openSettle({ name: "大團", myBalance: 190, others: debtors });

    expect(await rows()).toHaveLength(19);
    expect(screen.queryByText(/至多/)).toBeNull();
  });

  it("says everyone is settled when every Balance is zero", async () => {
    await openSettle({ name: "室友", others: [{ name: "宜庭" }] });

    expect(await screen.findByText("大家都結清了！")).toBeVisible();
    expect(screen.queryByRole("list", { name: "要付給誰" })).toBeNull();
  });
});

const row = async (list: string, text: string) => {
  const items = within(await screen.findByRole("list", { name: list })).getAllByRole("listitem");
  const found = items.find((li) => li.textContent.includes(text));
  if (found === undefined) throw new Error(`no row "${text}" in ${list}`);
  return within(found);
};

describe("Recording and confirming Settlements", () => {
  it("lets the payer confirm payment with a warm clay button: Balances move at once and the record can be undone", async () => {
    const { user, api, id } = await openSettle({
      name: "室友",
      role: "member",
      myBalance: -200,
      others: [{ name: "宜庭", balance: 200 }],
    });

    expect(screen.getByText("剩 1 筆")).toBeVisible();

    const payButton = (await row("要付給誰", "你付給宜庭")).getByRole("button", {
      name: "確認付款",
    });
    expect(payButton).toHaveClass("bg-terracotta-soft", "text-terracotta-ink");
    await user.click(payButton);

    const dialog = within(await screen.findByRole("dialog", { name: "這筆款項已付清嗎？" }));
    expect(dialog.queryByLabelText("💬 通知目前聊天室（發送已結清卡片）")).toBeNull();
    await user.click(dialog.getByRole("button", { name: "確認已結清" }));

    expect(await (await row("結算紀錄", "你付給宜庭")).findByText("NT$ 200")).toBeVisible();
    expect(screen.queryByRole("list", { name: "要付給誰" })).toBeNull();
    expect(api.groups.members(id())[0]?.balance).toBe(0);
    const post = api.requests.find((r) => r.route === `POST /api/v1/groups/${id()}/settlements`);
    expect(post?.headers.get("Idempotency-Key")).toBeTruthy();

    await user.click((await row("結算紀錄", "你付給宜庭")).getByRole("button", { name: "撤銷" }));
    await user.click(await screen.findByRole("button", { name: "已取消／已撤銷 1 筆" }));
    expect(await (await row("已取消與已撤銷", "你付給宜庭")).findByText("已撤銷")).toBeVisible();
    expect(api.groups.members(id())[0]?.balance).toBe(-200);
  });

  it.each([
    { trigger: "確認收款", label: "阿哲付給你", seed: owedToMe },
    {
      trigger: "代為確認",
      label: "阿哲付給宜庭",
      seed: {
        name: "代為確認",
        myBalance: 0,
        role: "admin" as const,
        others: [
          { name: "宜庭", balance: 200 },
          { name: "阿哲", balance: -200 },
        ],
      },
    },
  ])(
    "uses a new key for an edited settlement retry ($trigger)",
    async ({ trigger, label, seed }) => {
      const { user, api, id } = await openSettle(seed);
      await user.click((await row("要付給誰", label)).getByRole("button", { name: trigger }));
      let dialog = within(await screen.findByRole("dialog", { name: "這筆款項已付清嗎？" }));
      const route = `POST /api/v1/groups/${id()}/settlements`;
      api.failNext(route, "INTERNAL", 500);
      await user.click(dialog.getByRole("button", { name: "確認已結清" }));
      expect(await screen.findByRole("alert")).toBeVisible();
      await user.click((await row("要付給誰", label)).getByRole("button", { name: trigger }));
      dialog = within(await screen.findByRole("dialog", { name: "這筆款項已付清嗎？" }));
      const amount = dialog.getByLabelText("結算金額（TWD）");
      await user.clear(amount);
      await user.type(amount, "150");
      await user.click(dialog.getByRole("button", { name: "確認已結清" }));
      await waitFor(() => {
        expect(api.groups.settlements.list(id())).toHaveLength(1);
      });
      const requests = api.requests.filter((r) => r.route === route);
      expect(requests).toHaveLength(2);
      expect(requests[0]?.headers.get("Idempotency-Key")).toBeTruthy();
      expect(requests[1]?.headers.get("Idempotency-Key")).not.toBe(
        requests[0]?.headers.get("Idempotency-Key"),
      );
      expect(api.groups.settlements.list(id())[0]?.amount).toBe(150);
    },
  );

  it("refreshes Stats after recording a settlement once its projection becomes available", async () => {
    const { user, api, id, queryClient } = await openSettle(owedToMe);
    await user.click(
      (await row("要付給誰", "阿哲付給你")).getByRole("button", { name: "確認收款" }),
    );
    const dialog = within(await screen.findByRole("dialog", { name: "這筆款項已付清嗎？" }));
    let projected = false;
    const key = ["stats", "spending", me.id];
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => Promise.resolve(projected ? 200 : 100),
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await observer.refetch();
      vi.useFakeTimers();
      act(() => {
        fireEvent.click(dialog.getByRole("button", { name: "確認已結清" }));
      });
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(api.groups.settlements.list(id())).toHaveLength(1);
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(queryClient.getQueryData(key)).toBe(100);
      projected = true;
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(queryClient.getQueryData(key)).toBe(200);
    } finally {
      unsubscribe();
      vi.useRealTimers();
    }
  });

  it("lets the receiver confirm a partial payment; the rest stays a debt", async () => {
    const { user, api, id } = await openSettle(owedToMe);

    await user.click(
      (await row("要付給誰", "阿哲付給你")).getByRole("button", { name: "確認收款" }),
    );
    const dialog = within(await screen.findByRole("dialog", { name: "這筆款項已付清嗎？" }));
    const amount = dialog.getByLabelText("結算金額（TWD）");
    expect(amount).toHaveValue("200");
    await user.clear(amount);
    await user.type(amount, "250");
    expect(dialog.getByRole("button", { name: "確認已結清" })).toBeDisabled();
    await user.clear(amount);
    await user.type(amount, "150");
    await user.click(dialog.getByRole("button", { name: "確認已結清" }));

    expect(await (await row("結算紀錄", "阿哲付給你")).findByText("NT$ 150")).toBeVisible();
    expect(await (await row("要付給誰", "阿哲付給你")).findByText("NT$ 50")).toBeVisible();
    expect(api.groups.settlements.list(id())[0]).toMatchObject({
      amount: 150,
      status: "confirmed",
    });
  });

  it("tags the cards that are mine with 你要付 or 你可收 and says 你 in every list", async () => {
    await openSettle(owedToMe);

    const planned = within(await screen.findByRole("list", { name: "要付給誰" }));
    expect(planned.getAllByText("你可收").length).toBeGreaterThan(0);
    expect(planned.queryByText("你要付")).toBeNull();
  });

  it("opens a ring around the tick when the last payment settles", async () => {
    const { user } = await openSettle({
      name: "台南小旅行",
      myBalance: 100,
      others: [{ name: "宜庭", balance: -100 }],
    });

    await user.click(
      (await row("要付給誰", "宜庭付給你")).getByRole("button", { name: "確認收款" }),
    );
    const dialog = within(await screen.findByRole("dialog", { name: "這筆款項已付清嗎？" }));
    expect(dialog.queryByLabelText("💬 通知目前聊天室（發送已結清卡片）")).toBeNull();
    await user.click(dialog.getByRole("button", { name: "確認已結清" }));

    expect(await screen.findByText("大家都結清了！")).toBeVisible();
    expect(document.querySelector(".settle-ring")).not.toBeNull();
  });

  it("shows one line per Settlement under a day heading, 5 first and 5 more each time", async () => {
    const { user } = await openSettle(owedToMe, (groups, gid) => {
      for (let i = 0; i < 7; i++) {
        groups.addSettlement(gid, { payer: 1, receiver: 0, amount: 10 });
      }
    });

    const history = await screen.findByRole("list", { name: "結算紀錄" });
    expect(within(history).getAllByRole("listitem")).toHaveLength(5);
    // One heading for the day, not a card per payment.
    expect(within(history).getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(within(history).getAllByText(/^\d{2}:\d{2}$/)).toHaveLength(5);

    await user.click(screen.getByRole("button", { name: "查看更多" }));
    expect(within(history).getAllByRole("listitem")).toHaveLength(7);
    expect(screen.queryByRole("button", { name: "查看更多" })).toBeNull();
  });

  it("folds cancelled and undone records away until asked", async () => {
    await openSettle(owedToMe, (groups, gid) => {
      groups.addSettlement(gid, { payer: 1, receiver: 0, amount: 10 });
    });

    expect(await screen.findByRole("list", { name: "結算紀錄" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /已取消／已撤銷/ })).toBeNull();
  });

  it("undoes a confirmed Settlement and keeps an 已撤銷 line", async () => {
    const { user, api, id } = await openSettle(owedToMe, (groups, gid) => {
      groups.addSettlement(gid, { payer: 2, receiver: 0, amount: 200 });
    });

    expect(await screen.findByText("NT$ 100")).toBeVisible();
    await user.click((await row("結算紀錄", "阿哲付給你")).getByRole("button", { name: "撤銷" }));

    await user.click(await screen.findByRole("button", { name: "已取消／已撤銷 1 筆" }));
    expect(await (await row("已取消與已撤銷", "阿哲付給你")).findByText("已撤銷")).toBeVisible();
    // The folded list is dated like the main one: a day heading and the time of each record.
    const dropped = screen.getByRole("list", { name: "已取消與已撤銷" });
    expect(within(dropped).getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(within(dropped).getByText(/^\d{2}:\d{2}$/)).toBeVisible();
    expect(within(dropped).getByText("NT$ 200")).toBeVisible();
    expect(api.groups.members(id())[2]?.balance).toBe(-200);
  });

  it("finishes undo after the server answers while refetches remain pending, without offering Undo again", async () => {
    const { user, api, id } = await openSettle(owedToMe, (groups, gid) => {
      groups.addSettlement(gid, { payer: 2, receiver: 0, amount: 200 });
    });
    const button = (await row("結算紀錄", "阿哲付給你")).getByRole("button", { name: "撤銷" });
    const releaseGroup = api.holdResponses(`GET /api/v1/groups/${id()}`);
    const releaseHistory = api.holdResponses(`GET /api/v1/groups/${id()}/settlements`);
    try {
      await user.click(button);
      await waitFor(() => {
        expect(api.groups.settlements.list(id())[0]?.status).toBe("undone");
      });
      // The undone Settlement must not offer Undo again while the history is still stale.
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "撤銷" })).not.toBeInTheDocument();
      });
    } finally {
      releaseGroup();
      releaseHistory();
    }
  });

  it("moves the balances back and hides Undo before the server answers an undo", async () => {
    const { user, api, id } = await openSettle(owedToMe, (groups, gid) => {
      groups.addSettlement(gid, { payer: 2, receiver: 0, amount: 200 });
    });
    expect(await screen.findByText("NT$ 100")).toBeVisible();
    const release = api.holdResponses(
      `POST /api/v1/settlements/${api.groups.settlements.list(id())[0]?.id}/undo`,
    );
    try {
      await user.click((await row("結算紀錄", "阿哲付給你")).getByRole("button", { name: "撤銷" }));
      await waitFor(() => {
        const mine = within(screen.getByRole("list", { name: "大家的結餘" })).getAllByRole(
          "listitem",
        )[0];
        expect(mine?.textContent).toMatch(/\+NT\$ 300/);
      });
      expect(screen.queryByRole("button", { name: "撤銷" })).not.toBeInTheDocument();
    } finally {
      release();
    }
  });

  it("puts the balances and the Undo button back when an undo fails", async () => {
    const { user, api, id } = await openSettle(owedToMe, (groups, gid) => {
      groups.addSettlement(gid, { payer: 2, receiver: 0, amount: 200 });
    });
    expect(await screen.findByText("NT$ 100")).toBeVisible();
    api.failNext(`POST /api/v1/settlements/${api.groups.settlements.list(id())[0]?.id}/undo`);

    await user.click((await row("結算紀錄", "阿哲付給你")).getByRole("button", { name: "撤銷" }));

    expect(await screen.findByRole("alert")).toBeVisible();
    const mine = within(screen.getByRole("list", { name: "大家的結餘" })).getAllByRole(
      "listitem",
    )[0];
    expect(mine?.textContent).toMatch(/\+NT\$ 100/);
    expect(screen.getByRole("button", { name: "撤銷" })).toBeVisible();
  });

  it("keeps a payment confirmed while an undo was waiting when that undo is refused", async () => {
    const { user, api, id, queryClient } = await openSettle(owedToMe, (groups, gid) => {
      groups.addSettlement(gid, { payer: 1, receiver: 0, amount: 100 });
    });
    const undo = `POST /api/v1/settlements/${api.groups.settlements.list(id())[0]?.id}/undo`;
    api.failNext(undo);
    const releaseUndo = api.holdResponses(undo);
    // No refetch may repair the screen: what is shown comes from the rollback alone.
    const releaseReads = [
      `GET /api/v1/groups/${id()}`,
      `GET /api/v1/groups/${id()}/balances`,
      `GET /api/v1/groups/${id()}/settlements`,
    ].map((route) => api.holdResponses(route));
    try {
      await user.click((await row("結算紀錄", "宜庭付給你")).getByRole("button", { name: "撤銷" }));
      await user.click(
        (await row("要付給誰", "阿哲付給你")).getByRole("button", { name: "確認收款" }),
      );
      const dialog = within(await screen.findByRole("dialog", { name: "這筆款項已付清嗎？" }));
      await user.click(dialog.getByRole("button", { name: "確認已結清" }));
      await waitFor(() => {
        expect(api.groups.settlements.list(id())).toHaveLength(2);
      });
      releaseUndo();
      expect(await screen.findByRole("alert")).toBeVisible();

      const mine = api.groups.members(id()).find((m) => m.userId === me.id);
      const shown = queryClient
        .getQueryData<{ balances: { memberId: string; balance: number }[] }>(
          settlementKeys.balances(id()),
        )
        ?.balances.find((b) => b.memberId === mine?.id)?.balance;
      expect(mine?.balance).toBe(0);
      expect(shown).toBe(mine?.balance);
    } finally {
      releaseUndo();
      for (const release of releaseReads) release();
    }
  });

  it("takes back only the refused payment from the Balances shown", async () => {
    const { user, api, id, queryClient } = await openSettle(owedToMe);
    api.failNext(`POST /api/v1/groups/${id()}/settlements`);
    const releaseReads = [
      `GET /api/v1/groups/${id()}`,
      `GET /api/v1/groups/${id()}/balances`,
      `GET /api/v1/groups/${id()}/settlements`,
    ].map((route) => api.holdResponses(route));
    try {
      await user.click(
        (await row("要付給誰", "阿哲付給你")).getByRole("button", { name: "確認收款" }),
      );
      const dialog = within(await screen.findByRole("dialog", { name: "這筆款項已付清嗎？" }));
      await user.click(dialog.getByRole("button", { name: "確認已結清" }));
      expect(await screen.findByRole("alert")).toBeVisible();

      const mine = api.groups.members(id()).find((m) => m.userId === me.id);
      const shown = queryClient
        .getQueryData<{ balances: { memberId: string; balance: number }[] }>(
          settlementKeys.balances(id()),
        )
        ?.balances.find((b) => b.memberId === mine?.id)?.balance;
      expect(mine?.balance).toBe(300);
      expect(shown).toBe(300);
    } finally {
      for (const release of releaseReads) release();
    }
  });

  it.each([
    {
      name: "an undo",
      seed: (groups: FakeGroups, gid: string) => {
        groups.addSettlement(gid, { payer: 1, receiver: 0, amount: 100 });
      },
      start: async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(
          (await row("結算紀錄", "宜庭付給你")).getByRole("button", { name: "撤銷" }),
        );
      },
      route: (api: { groups: FakeGroups }, gid: string) =>
        `POST /api/v1/settlements/${api.groups.settlements.list(gid)[0]?.id}/undo`,
      balance: 200,
    },
    {
      name: "a payment",
      seed: undefined,
      start: async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(
          (await row("要付給誰", "阿哲付給你")).getByRole("button", { name: "確認收款" }),
        );
        const dialog = within(await screen.findByRole("dialog", { name: "這筆款項已付清嗎？" }));
        await user.click(dialog.getByRole("button", { name: "確認已結清" }));
      },
      route: (_api: { groups: FakeGroups }, gid: string) =>
        `POST /api/v1/groups/${gid}/settlements`,
      balance: 300,
    },
  ])(
    "keeps the server's answer when $name is refused after a fresh read replaced the guess",
    async ({ seed, start, route, balance }) => {
      const { user, api, id, queryClient } = await openSettle(owedToMe, seed);
      const write = route(api, id());
      api.failNext(write);
      const releaseWrite = api.holdResponses(write);
      let releaseReads: (() => void)[] = [];
      try {
        await start(user);
        // A read that lands while the write still waits (live update, reconnect, focus).
        await queryClient.refetchQueries({ queryKey: settlementKeys.balances(id()) });
        releaseReads = [
          `GET /api/v1/groups/${id()}`,
          `GET /api/v1/groups/${id()}/balances`,
          `GET /api/v1/groups/${id()}/settlements`,
        ].map((r) => api.holdResponses(r));
        releaseWrite();
        expect(await screen.findByRole("alert")).toBeVisible();

        const mine = api.groups.members(id()).find((m) => m.userId === me.id);
        const shown = queryClient
          .getQueryData<{ balances: { memberId: string; balance: number }[] }>(
            settlementKeys.balances(id()),
          )
          ?.balances.find((b) => b.memberId === mine?.id)?.balance;
        expect(mine?.balance).toBe(balance);
        expect(shown).toBe(balance);
      } finally {
        releaseWrite();
        for (const release of releaseReads) release();
      }
    },
  );

  it("puts a refused undo's row back even though older history was loaded meanwhile", async () => {
    const { user, api, id, queryClient } = await openSettle(owedToMe, (groups, gid) => {
      groups.addSettlement(gid, { payer: 1, receiver: 0, amount: 100 });
    });
    const settlementId = api.groups.settlements.list(id())[0]?.id;
    const undo = `POST /api/v1/settlements/${settlementId}/undo`;
    api.failNext(undo);
    const releaseUndo = api.holdResponses(undo);
    let releaseReads: (() => void)[] = [];
    try {
      await user.click((await row("結算紀錄", "宜庭付給你")).getByRole("button", { name: "撤銷" }));
      // The fake serves one page, so give the cached first page a next cursor to load from.
      queryClient.setQueryData<InfiniteData<SettlementPage>>(settlementKeys.list(id()), (data) =>
        data === undefined
          ? data
          : { ...data, pages: data.pages.map((page) => ({ ...page, nextCursor: "older" })) },
      );
      await user.click(await screen.findByRole("button", { name: "載入更多" }));
      releaseReads = [
        `GET /api/v1/groups/${id()}`,
        `GET /api/v1/groups/${id()}/balances`,
        `GET /api/v1/groups/${id()}/settlements`,
      ].map((r) => api.holdResponses(r));
      releaseUndo();
      expect(await screen.findByRole("alert")).toBeVisible();

      const shown = queryClient
        .getQueryData<InfiniteData<SettlementPage>>(settlementKeys.list(id()))
        ?.pages[0]?.settlements.find((s) => s.id === settlementId)?.status;
      expect(shown).toBe("confirmed");
    } finally {
      releaseUndo();
      for (const release of releaseReads) release();
    }
  });

  it("keeps the server's undone row when the undo's answer is lost after a fresh read", async () => {
    const { user, api, id, queryClient } = await openSettle(owedToMe, (groups, gid) => {
      groups.addSettlement(gid, { payer: 1, receiver: 0, amount: 100 });
    });
    const settlementId = api.groups.settlements.list(id())[0]?.id;
    const undo = `POST /api/v1/settlements/${settlementId}/undo`;
    api.dropNextResponse(undo);
    const releaseUndo = api.holdResponses(undo);
    let releaseReads: (() => void)[] = [];
    try {
      await user.click((await row("結算紀錄", "宜庭付給你")).getByRole("button", { name: "撤銷" }));
      // The server has done the undo; a read brings its answer in while ours is still on the way.
      await waitFor(() => {
        expect(api.groups.settlements.list(id())[0]?.status).toBe("undone");
      });
      await queryClient.refetchQueries({ queryKey: settlementKeys.list(id()) });
      releaseReads = [
        `GET /api/v1/groups/${id()}`,
        `GET /api/v1/groups/${id()}/balances`,
        `GET /api/v1/groups/${id()}/settlements`,
      ].map((r) => api.holdResponses(r));
      releaseUndo();
      expect(await screen.findByRole("alert")).toBeVisible();

      const shown = queryClient
        .getQueryData<InfiniteData<SettlementPage>>(settlementKeys.list(id()))
        ?.pages[0]?.settlements.find((s) => s.id === settlementId)?.status;
      expect(shown).toBe("undone");
    } finally {
      releaseUndo();
      for (const release of releaseReads) release();
    }
  });

  it("asks the server for the real balances again after an undo fails", async () => {
    const { user, api, id } = await openSettle(owedToMe, (groups, gid) => {
      groups.addSettlement(gid, { payer: 2, receiver: 0, amount: 200 });
    });
    expect(await screen.findByText("NT$ 100")).toBeVisible();
    const route = `GET /api/v1/groups/${id()}/balances`;
    const asked = () => api.requests.filter((r) => r.route === route).length;
    const before = asked();
    api.failNext(`POST /api/v1/settlements/${api.groups.settlements.list(id())[0]?.id}/undo`);

    await user.click((await row("結算紀錄", "阿哲付給你")).getByRole("button", { name: "撤銷" }));

    expect(await screen.findByRole("alert")).toBeVisible();
    await waitFor(() => {
      expect(asked()).toBeGreaterThan(before);
    });
  });

  it("uses warm clay tones for negative balances and outgoing payments", async () => {
    await openSettle({
      name: "室友",
      myBalance: -200,
      others: [{ name: "宜庭", balance: 200 }],
    });

    const plannedRow = await row("要付給誰", "你付給宜庭");
    expect(plannedRow.getByText("NT$ 200")).toHaveClass("text-terracotta-ink");
    expect(plannedRow.getByText("你要付")).toHaveClass("bg-terracotta-soft", "text-terracotta-ink");
    expect(plannedRow.getByRole("button", { name: "確認付款" })).toHaveClass(
      "bg-terracotta-soft",
      "text-terracotta-ink",
    );
  });

  it("draws the full Group Payment plan matching Everyone's balance, sorting my rows first", async () => {
    await openSettle({
      name: "明天去哪玩",
      role: "member",
      myBalance: 2947,
      others: [
        { name: "成員A", balance: 2996 },
        { name: "成員B", balance: -1127 },
        { name: "成員C", balance: -2250 },
        { name: "成員D", balance: -2566 },
      ],
    });

    expect(await rows()).toEqual([
      expect.stringContaining("成員C付給你NT$ 2,250"),
      expect.stringContaining("成員B付給你NT$ 697"),
      expect.stringContaining("成員D付給成員ANT$ 2,566"),
      expect.stringContaining("成員B付給成員ANT$ 430"),
    ]);
    expect(screen.queryByRole("list", { name: "待確認" })).toBeNull();
    // As a non-admin Member, I can confirm my own rows, while rows between others have no button.
    const otherRow = await row("要付給誰", "成員D付給成員A");
    expect(otherRow.queryByRole("button", { name: /確認/ })).toBeNull();
  });

  it("renders a compact dashed 代為確認 button for an Admin on payments between other Members", async () => {
    await openSettle({
      name: "明天去哪玩",
      role: "admin",
      myBalance: 2947,
      others: [
        { name: "成員A", balance: 2996 },
        { name: "成員B", balance: -1127 },
        { name: "成員C", balance: -2250 },
        { name: "成員D", balance: -2566 },
      ],
    });

    const myRow = await row("要付給誰", "成員C付給你");
    const myBtn = myRow.getByRole("button", { name: "確認收款" });
    expect(myBtn).toHaveClass("bg-sprout-600", "w-full");

    const otherRow = await row("要付給誰", "成員D付給成員A");
    expect(otherRow.queryByRole("button", { name: "確認收款" })).toBeNull();
    const behalfBtn = otherRow.getByRole("button", { name: "代為確認" });
    expect(behalfBtn).toHaveClass("border-dashed", "self-end");
  });

  it("shows pending state on the confirm button while recording a settlement (Ticket 11)", async () => {
    const user = userEvent.setup();
    await openSettle({
      name: "台南之旅",
      role: "admin",
      myBalance: 500,
      others: [{ name: "阿哲", balance: -500 }],
    });

    const myRow = await row("要付給誰", "阿哲付給你");
    await user.click(myRow.getByRole("button", { name: "確認收款" }));

    const submitBtn = await screen.findByRole("button", { name: "確認已結清" });
    expect(submitBtn).toBeEnabled();

    // Clicking it triggers the submission and closes upon confirmation
    await user.click(submitBtn);
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "這筆款項已付清嗎？" })).toBeNull();
    });
  });

  it("shows notify chat checkbox checked by default in LINE chat and sends settled card upon confirm", async () => {
    const { user, lineChatMessages } = await openSettle(
      {
        name: "室友",
        role: "member",
        myBalance: -200,
        others: [{ name: "宜庭", balance: 200 }],
      },
      undefined,
      {
        insideLine: { idToken: null },
        lineChat: true,
      },
    );

    expect(screen.getByText("剩 1 筆")).toBeVisible();

    const payButton = (await row("要付給誰", "你付給宜庭")).getByRole("button", {
      name: "確認付款",
    });
    await user.click(payButton);

    const dialog = within(await screen.findByRole("dialog", { name: "這筆款項已付清嗎？" }));
    const checkbox = await dialog.findByRole("checkbox", {
      name: "💬 通知目前聊天室（發送已結清卡片）",
    });
    expect(checkbox).toBeChecked();

    await user.click(dialog.getByRole("button", { name: "確認已結清" }));

    expect(lineChatMessages).toHaveLength(1);
    expect(lineChatMessages[0]).toMatchObject({
      type: "flex",
    });
    const json = JSON.stringify(lineChatMessages[0]);
    expect(json).toContain("已結清");
  });
});

describe("Notifying the Group of the Payment plan", () => {
  it("supports keyboard navigation and restores focus when dismissed", async () => {
    const { user } = await openSettle(owedToMe);
    const trigger = await screen.findByRole("button", { name: "通知款項 ▾" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const first = await screen.findByRole("menuitem", { name: "當前對話框" });
    expect(first).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "通知好友" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });
  it("hides the notify buttons when everyone is settled", async () => {
    await openSettle({ name: "室友", others: [{ name: "宜庭" }] });

    expect(await screen.findByText("大家都結清了！")).toBeVisible();
    expect(screen.queryByRole("button", { name: "通知款項 ▾" })).toBeNull();
    expect(screen.queryByRole("button", { name: "LINE 通知" })).toBeNull();
    expect(screen.queryByRole("button", { name: "通知款項" })).toBeNull();
    expect(screen.queryByRole("button", { name: "傳到對話框" })).toBeNull();
  });

  it("shares the Payment plan Flex card with real Member Nicknames through the LINE picker", async () => {
    const { user, lineShareMessages } = await openSettle(owedToMe, undefined, {
      insideLine: { idToken: null },
    });

    await user.click(await screen.findByRole("button", { name: "通知款項 ▾" }));
    await user.click(await screen.findByRole("menuitem", { name: "通知好友" }));

    expect(await screen.findByText("已分享到 LINE ✓")).toBeVisible();
    expect(lineShareMessages).toHaveLength(1);
    expect(lineShareMessages[0]).toMatchObject({
      type: "flex",
      altText: "「台南小旅行」的結算通知",
    });
    const json = JSON.stringify(lineShareMessages[0]);
    expect(json).toContain("阿哲 ➔ 小宇");
    expect(json).toContain("宜庭 ➔ 小宇");
    expect(json).not.toContain("➔ 你");
  });

  it("posts the Payment plan Flex card into the current LINE chat when opened from a chat", async () => {
    const { user, lineChatMessages } = await openSettle(owedToMe, undefined, {
      insideLine: { idToken: null },
      lineChat: true,
    });

    await user.click(await screen.findByRole("button", { name: "通知款項 ▾" }));
    await user.click(await screen.findByRole("menuitem", { name: "當前對話框" }));

    expect(await screen.findByText("已發送到對話框 ✓")).toBeVisible();
    expect(lineChatMessages).toHaveLength(1);
    expect(lineChatMessages[0]).toMatchObject({
      type: "flex",
      altText: "「台南小旅行」的結算通知",
    });
  });
});
