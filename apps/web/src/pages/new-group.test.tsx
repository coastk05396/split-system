import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

const me = makeUser("小宇");

describe("create Group", () => {
  it("creates a Trip with its Settlement and default Expense currencies, then opens the Invite", async () => {
    const user = userEvent.setup();
    const { api, router } = renderApp({ path: "/groups/new?usage=trip", cookieUser: me });

    await user.type(await screen.findByLabelText("群組名稱"), "週末台南小旅行");
    expect(screen.getByRole("radio", { name: /旅行分帳/ })).toBeChecked();
    await user.selectOptions(screen.getByLabelText("結算幣別"), "USD");
    await user.selectOptions(screen.getByLabelText("預設記帳幣別"), "USD");
    await user.click(screen.getByRole("button", { name: /建立群組，繼續/ }));

    expect(await screen.findByRole("heading", { name: "邀請成員" })).toBeVisible();
    const id = router.state.location.pathname.split("/")[2] ?? "";
    expect(router.state.location.pathname).toBe(`/groups/${id}/invite`);
    expect(api.groups.members(id)).toHaveLength(1);
    expect(api.groups.summary(id)).toEqual({
      name: "週末台南小旅行",
      isTrip: true,
      settlementCurrency: "USD",
      defaultExpenseCurrency: "USD",
    });
  });

  it("defaults to a TWD Running Tab and says the Settlement currency locks", async () => {
    renderApp({ path: "/groups/new", cookieUser: me });

    expect(await screen.findByRole("radio", { name: /快速分帳/ })).toBeChecked();
    expect(screen.getByLabelText("結算幣別")).toHaveValue("TWD");
    expect(screen.getByText("記下第一筆開銷後就不能再更改。")).toBeVisible();
    expect(screen.getByRole("button", { name: /建立群組，繼續/ })).toBeDisabled();
  });

  it("explains a refused create", async () => {
    const user = userEvent.setup();
    const { api } = renderApp({ path: "/groups/new", cookieUser: me });
    api.failNext("POST /api/v1/groups", "GROUP_LIMIT_REACHED", 409);

    await user.type(await screen.findByLabelText("群組名稱"), "室友");
    await user.click(screen.getByRole("button", { name: /建立群組，繼續/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("你最多只能加入 20 個群組。");
  });
});
