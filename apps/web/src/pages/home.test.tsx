import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

const me = makeUser("小宇");

describe("home", () => {
  it("shows pending Balances side by side per currency, never summed", async () => {
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        groups.add(me, { name: "台南小旅行", settlementCurrency: "TWD", myBalance: 393 });
        groups.add(me, { name: "室友", settlementCurrency: "TWD", myBalance: -100 });
        groups.add(me, { name: "紐約", settlementCurrency: "USD", myBalance: 1250 });
        groups.add(me, { name: "已結清", settlementCurrency: "USD", myBalance: 0 });
      },
    });

    const card = await screen.findByRole("region", { name: "目前淨收付" });
    expect(await within(card).findByText("NT$ 293 · US$ 12.50")).toBeVisible();
    expect(within(card).getByText("你在 3 個群組有待結算款項")).toBeVisible();
  });

  it("says everything is settled when no Balance is pending", async () => {
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        groups.add(me, { name: "室友", settlementCurrency: "TWD", myBalance: 0 });
      },
    });

    const card = await screen.findByRole("region", { name: "目前淨收付" });
    expect(await within(card).findByText("NT$ 0")).toBeVisible();
    expect(within(card).getByText("目前沒有待結算的款項")).toBeVisible();
  });

  it("offers the two ways to start a Group", async () => {
    renderApp({ cookieUser: me });

    expect(await screen.findByRole("link", { name: /旅行分帳/ })).toHaveAttribute(
      "href",
      "/groups/new?usage=trip",
    );
    expect(screen.getByRole("link", { name: /快速分帳/ })).toHaveAttribute(
      "href",
      "/groups/new?usage=tab",
    );
    expect(screen.getByRole("link", { name: "查看群組" })).toHaveAttribute("href", "/groups");
  });
});
