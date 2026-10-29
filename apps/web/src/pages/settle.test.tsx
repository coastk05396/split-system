import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import type { FakeGroups, SeedGroup } from "../../test/fake-groups.js";
import { renderApp } from "../../test/render-app.js";

const me = makeUser("小宇");

/** Opens the 結算 tab of a seeded Group; `after` seeds Settlements once the Group exists. */
async function openSettle(seed: SeedGroup, after?: (groups: FakeGroups, id: string) => void) {
  let id = "";
  const app = renderApp({
    cookieUser: me,
    seed: (groups) => {
      id = groups.add(me, seed);
      after?.(groups, id);
    },
    pathFor: () => `/groups/${id}`,
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

describe("Balances and the Payment plan", () => {
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
        .map((li) => li.textContent),
    ).toEqual(["小宇（你）+NT$ 300", "宜庭-NT$ 100", "阿哲-NT$ 200"]);
    expect(screen.getByText("其他 1 人已結清")).toBeVisible();
    expect(screen.getByText("紅色是要付，綠色是可收")).toBeVisible();
  });

  it("leaves the chart out when everyone is settled", async () => {
    await openSettle({ name: "室友", others: [{ name: "宜庭" }] });

    expect(await screen.findByText("大家都結清了！")).toBeVisible();
    expect(screen.queryByRole("list", { name: "大家的結餘" })).toBeNull();
  });

  it("shows my Balance and the fewest-payments plan in whole dollars", async () => {
    await openSettle(owedToMe);

    expect(await screen.findByText("NT$ 300")).toBeVisible();
    expect(screen.getByRole("heading", { name: "你可收" })).toBeVisible();
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
  it("records 我已付款 as pending: no Balance moves, the row waits, and I can cancel it", async () => {
    const { user, api, id } = await openSettle({
      name: "室友",
      role: "member",
      myBalance: -200,
      others: [{ name: "宜庭", balance: 200 }],
    });

    await user.click(
      (await row("要付給誰", "你付給宜庭")).getByRole("button", { name: "我已付款" }),
    );

    const pending = await row("待確認", "你付給宜庭");
    expect(pending.getByText("NT$ 200")).toBeVisible();
    // The sent payment shows once, under 待確認; 要付給誰 no longer lists it.
    expect(screen.queryByRole("list", { name: "要付給誰" })).toBeNull();
    expect(api.groups.members(id())[0]?.balance).toBe(-200);
    const post = api.requests.find((r) => r.route === `POST /api/v1/groups/${id()}/settlements`);
    expect(post?.headers.get("Idempotency-Key")).toBeTruthy();

    await user.click(pending.getByRole("button", { name: "取消" }));
    await user.click(await screen.findByRole("button", { name: "已取消／已撤銷 1 筆" }));
    expect(await (await row("已取消與已撤銷", "你付給宜庭")).findByText("已取消")).toBeVisible();
    expect(screen.queryByRole("list", { name: "待確認" })).toBeNull();
  });

  it("lets the receiver confirm a partial payment; the rest stays a debt", async () => {
    const { user, api, id } = await openSettle(owedToMe);

    await user.click(
      (await row("要付給誰", "阿哲付給你")).getByRole("button", { name: "確認收款" }),
    );
    const dialog = within(await screen.findByRole("dialog", { name: "這筆款項已付清嗎？" }));
    const amount = dialog.getByLabelText("實收金額（TWD）");
    expect(amount).toHaveValue("200");
    await user.clear(amount);
    await user.type(amount, "250");
    expect(dialog.getByRole("button", { name: "確認已結清" })).toBeDisabled();
    await user.clear(amount);
    await user.type(amount, "150");
    await user.click(dialog.getByRole("button", { name: "確認已結清" }));

    expect(await (await row("結算紀錄", "阿哲付給你")).findByText("NT$ 150")).toBeVisible();
    expect(await (await row("要付給誰", "阿哲付給你")).findByText("NT$ 50")).toBeVisible();
    expect(await (await row("結算紀錄", "阿哲付給你")).findByText("NT$ 150")).toBeVisible();
    expect(api.groups.settlements.list(id())[0]).toMatchObject({
      amount: 150,
      status: "confirmed",
    });
  });

  it("confirms a payer's pending Settlement for the receiver", async () => {
    const { user, api, id } = await openSettle(owedToMe, (groups, gid) => {
      groups.addSettlement(gid, { payer: 1, receiver: 0, amount: 100 }, 1);
    });

    const waitingList = within(await screen.findByRole("list", { name: "要付給誰" }));
    expect(waitingList.queryByText("宜庭付給你")).toBeNull();
    await user.click((await row("待確認", "宜庭付給你")).getByRole("button", { name: "確認" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "確認已結清" }));

    expect(await (await row("結算紀錄", "宜庭付給你")).findByText("NT$ 100")).toBeVisible();
    const sid = api.groups.settlements.list(id())[0]?.id ?? "";
    expect(api.calls).toContain(`POST /api/v1/settlements/${sid}/confirm`);
  });

  it("tags the cards that are mine with 你要付 or 你可收 and says 你 in every list", async () => {
    await openSettle(owedToMe, (groups, gid) => {
      groups.addSettlement(gid, { payer: 1, receiver: 0, amount: 50 }, 1);
    });

    const planned = within(await screen.findByRole("list", { name: "要付給誰" }));
    expect(planned.getAllByText("你可收").length).toBeGreaterThan(0);
    expect(planned.queryByText("你要付")).toBeNull();
    const pending = within(await screen.findByRole("list", { name: "待確認" }));
    expect(pending.getByText("宜庭付給你", { selector: ".sr-only" })).toBeInTheDocument();
    expect(pending.getByText("你可收")).toBeVisible();
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
    expect(await screen.findByText("NT$ 300")).toBeVisible();
    expect(api.groups.members(id())[2]?.balance).toBe(-200);
  });

  it("lets an Admin confirm a payment between two other Members", async () => {
    const { user } = await openSettle({
      name: "室友",
      others: [
        { name: "宜庭", balance: -80 },
        { name: "阿哲", balance: 80 },
      ],
    });

    await user.click(
      (await row("要付給誰", "宜庭付給阿哲")).getByRole("button", { name: "確認收款" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "確認已結清" }),
    );
    expect(await row("結算紀錄", "宜庭付給阿哲")).toBeDefined();
  });

  it("offers no actions on other people's payments to a plain Member", async () => {
    await openSettle({
      name: "室友",
      role: "member",
      others: [
        { name: "宜庭", balance: -80, role: "admin" },
        { name: "阿哲", balance: 80 },
      ],
    });

    const planned = await row("要付給誰", "宜庭付給阿哲");
    expect(planned.queryByRole("button")).toBeNull();
  });
});
