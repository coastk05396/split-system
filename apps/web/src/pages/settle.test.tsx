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

const plan = () => screen.findByRole("list", { name: "還款計畫" });
const rows = async () =>
  within(await plan())
    .getAllByRole("listitem")
    .map((li) => li.textContent);

describe("Balances and the Payment plan", () => {
  it("shows my Balance and the fewest-payments plan in whole dollars", async () => {
    await openSettle(owedToMe);

    expect(await screen.findByText("NT$ 300")).toBeVisible();
    expect(screen.getByText("別人還欠你")).toBeVisible();
    expect(await screen.findByText("最少筆數")).toBeVisible();
    expect(await rows()).toEqual([
      expect.stringContaining("阿哲付給小宇NT$ 200"),
      expect.stringContaining("宜庭付給小宇NT$ 100"),
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

  it("keeps 最少筆數 at exactly 20 non-zero Balances", async () => {
    const debtors = Array.from({ length: 19 }, (_, i) => ({
      name: `成員${String(i + 1)}`,
      balance: -10,
    }));
    await openSettle({ name: "大團", myBalance: 190, others: debtors });

    expect(await screen.findByText("最少筆數")).toBeVisible();
    expect(await rows()).toHaveLength(19);
  });

  it("says everyone is settled when every Balance is zero", async () => {
    await openSettle({ name: "室友", others: [{ name: "宜庭" }] });

    expect(await screen.findByText("大家都結清了！")).toBeVisible();
    expect(screen.queryByRole("list", { name: "還款計畫" })).toBeNull();
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
      (await row("還款計畫", "小宇付給宜庭")).getByRole("button", { name: "我已付款" }),
    );

    const pending = await row("待確認", "小宇付給宜庭");
    expect(pending.getByText("NT$ 200")).toBeVisible();
    expect((await row("還款計畫", "小宇付給宜庭")).getByText("待確認")).toBeVisible();
    expect(
      (await row("還款計畫", "小宇付給宜庭")).queryByRole("button", { name: "我已付款" }),
    ).toBeNull();
    expect(api.groups.members(id())[0]?.balance).toBe(-200);
    const post = api.requests.find((r) => r.route === `POST /api/v1/groups/${id()}/settlements`);
    expect(post?.headers.get("Idempotency-Key")).toBeTruthy();

    await user.click(pending.getByRole("button", { name: "取消" }));
    expect(await (await row("結算紀錄", "小宇付給宜庭")).findByText("已取消")).toBeVisible();
    expect(screen.queryByRole("list", { name: "待確認" })).toBeNull();
  });

  it("lets the receiver confirm a partial payment; the rest stays a debt", async () => {
    const { user, api, id } = await openSettle(owedToMe);

    await user.click(
      (await row("還款計畫", "阿哲付給小宇")).getByRole("button", { name: "確認收款" }),
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

    expect(await (await row("結算紀錄", "阿哲付給小宇")).findByText("已確認")).toBeVisible();
    expect(await (await row("還款計畫", "阿哲付給小宇")).findByText("NT$ 50")).toBeVisible();
    expect(await (await row("結算紀錄", "阿哲付給小宇")).findByText("NT$ 150")).toBeVisible();
    expect(api.groups.settlements.list(id())[0]).toMatchObject({
      amount: 150,
      status: "confirmed",
    });
  });

  it("confirms a payer's pending Settlement for the receiver", async () => {
    const { user, api, id } = await openSettle(owedToMe, (groups, gid) => {
      groups.addSettlement(gid, { payer: 1, receiver: 0, amount: 100 }, 1);
    });

    expect((await row("還款計畫", "宜庭付給小宇")).getByText("待確認")).toBeVisible();
    await user.click((await row("待確認", "宜庭付給小宇")).getByRole("button", { name: "確認" }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: "確認已結清" }));

    expect(await (await row("結算紀錄", "宜庭付給小宇")).findByText("已確認")).toBeVisible();
    const sid = api.groups.settlements.list(id())[0]?.id ?? "";
    expect(api.calls).toContain(`POST /api/v1/settlements/${sid}/confirm`);
  });

  it("undoes a confirmed Settlement and keeps an 已撤銷 line", async () => {
    const { user, api, id } = await openSettle(owedToMe, (groups, gid) => {
      groups.addSettlement(gid, { payer: 2, receiver: 0, amount: 200 });
    });

    expect(await screen.findByText("NT$ 100")).toBeVisible();
    await user.click((await row("結算紀錄", "阿哲付給小宇")).getByRole("button", { name: "撤銷" }));

    expect(await (await row("結算紀錄", "阿哲付給小宇")).findByText("已撤銷")).toBeVisible();
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
      (await row("還款計畫", "宜庭付給阿哲")).getByRole("button", { name: "確認收款" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "確認已結清" }),
    );
    expect(await (await row("結算紀錄", "宜庭付給阿哲")).findByText("已確認")).toBeVisible();
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

    const planned = await row("還款計畫", "宜庭付給阿哲");
    expect(planned.queryByRole("button")).toBeNull();
  });
});
