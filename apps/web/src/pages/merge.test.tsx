import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";
import { setLocale } from "../i18n/messages.js";

afterEach(() => {
  setLocale("zh-TW");
});

describe("/merge (confirming a Merge on the Link code path)", () => {
  it("shows both User cards and each User's Groups, keeps Merge disabled until ticked, and merges into Settings", async () => {
    const user = userEvent.setup();
    const kept = makeUser("LINE小宇", "line");
    const other = makeUser("Google小宇", "google");
    const { api } = renderApp({
      path: "/link?code=code-1",
      seed: (groups) => {
        groups.add(kept, { name: "LINE聚餐" });
        groups.add(other, { name: "Google旅遊" });
      },
    });
    api.linkCodes.set("code-1", kept);
    // Fake Google returns token "fake|g-1|Google 小宇" by default.
    api.googleOwners = new Map([["g-1", other]]);

    expect(await screen.findByRole("heading", { level: 1, name: "確認合併帳號" })).toBeVisible();

    const keptCard = screen.getByRole("region", { name: "保留的帳號" });
    const otherCard = screen.getByRole("region", { name: "將被合併的帳號" });
    expect(within(keptCard).getByText("LINE小宇")).toBeVisible();
    expect(within(keptCard).getByText("LINE")).toBeVisible();
    expect(within(keptCard).getByText("LINE聚餐")).toBeVisible();

    expect(within(otherCard).getByText("Google小宇")).toBeVisible();
    expect(within(otherCard).getByText("Google")).toBeVisible();
    expect(within(otherCard).getByText("Google旅遊")).toBeVisible();

    expect(screen.getByText(/無法復原/)).toBeVisible();
    expect(screen.getByText(/不是你.*請按取消/)).toBeVisible();

    const mergeButton = screen.getByRole("button", { name: "合併帳號" });
    expect(mergeButton).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "這兩個帳號都是我本人" }));
    expect(mergeButton).toBeEnabled();

    await user.click(mergeButton);

    await screen.findByRole("heading", { level: 1, name: "我的設定" });
    const accounts = within(screen.getByRole("list", { name: "已連結的帳號" }));
    expect(accounts.getByText("LINE").closest("li")).toHaveTextContent("已連結");
    expect(accounts.getByText("Google").closest("li")).toHaveTextContent("已連結");
    expect(api.calls).toContain("POST /api/v1/auth/merge/confirm");
  });

  it("cancelling returns to Settings with no confirm-merge call", async () => {
    const user = userEvent.setup();
    const kept = makeUser("LINE小宇", "line");
    const other = makeUser("Google小宇", "google");
    const { api } = renderApp({
      path: "/link?code=code-1",
      seed: () => undefined,
    });
    api.linkCodes.set("code-1", kept);
    api.googleOwners = new Map([["g-1", other]]);

    await screen.findByRole("heading", { level: 1, name: "確認合併帳號" });
    await user.click(screen.getByRole("button", { name: "取消" }));

    await screen.findByRole("heading", { level: 1, name: "我的設定" });
    expect(api.calls).not.toContain("POST /api/v1/auth/merge/confirm");
    const accounts = within(screen.getByRole("list", { name: "已連結的帳號" }));
    expect(accounts.getByText("Google").closest("li")).not.toHaveTextContent("已連結");
  });

  it("shows a translated message when the pending Merge is missing or expired", async () => {
    renderApp({
      path: "/merge",
      cookieUser: makeUser("LINE小宇", "line"),
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("失效或過期");
    expect(screen.getByRole("link", { name: "回到設定" })).toHaveAttribute("href", "/settings");
  });

  it("renders English strings when Language is English", async () => {
    setLocale("en");
    const kept = { ...makeUser("LINE Xiaoyu", "line"), language: "en" as const };
    const other = makeUser("Google Xiaoyu", "google");
    const { api } = renderApp({
      path: "/link?code=code-1",
      seed: (groups) => {
        groups.add(kept, { name: "LINE Dinner" });
        groups.add(other, { name: "Google Trip" });
      },
    });
    api.linkCodes.set("code-1", kept);
    api.googleOwners = new Map([["g-1", other]]);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Confirm account merge" }),
    ).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Both accounts are me" })).toBeVisible();
    });
    expect(screen.getByText(/cannot be undone/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Merge accounts" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  it("marks a Group that is already merging in the Merge screen preview", async () => {
    const kept = makeUser("LINE小宇", "line");
    const other = makeUser("Google小宇", "google");
    const { api } = renderApp({
      path: "/link?code=code-1",
      seed: (groups) => {
        groups.add(kept, { name: "卡住群組", merging: true });
        groups.add(other, { name: "Google旅遊" });
      },
    });
    api.linkCodes.set("code-1", kept);
    api.googleOwners = new Map([["g-1", other]]);

    await screen.findByRole("heading", { level: 1, name: "確認合併帳號" });
    const keptCard = screen.getByRole("region", { name: "保留的帳號" });
    expect(within(keptCard).getByText("合併中")).toBeVisible();
  });

  it("keeps Groups that failed during confirm marked as merging on the Merge screen", async () => {
    const user = userEvent.setup();
    const kept = makeUser("LINE小宇", "line");
    const other = makeUser("Google小宇", "google");
    let flakyGroupId = "";
    const { api } = renderApp({
      path: "/link?code=code-1",
      seed: (groups) => {
        groups.add(other, { name: "順利群組" });
        flakyGroupId = groups.add(other, { name: "卡住群組" });
      },
    });
    api.linkCodes.set("code-1", kept);
    api.googleOwners = new Map([["g-1", other]]);
    api.failMergeGroups.add(flakyGroupId);

    await screen.findByRole("heading", { level: 1, name: "確認合併帳號" });
    await user.click(screen.getByRole("checkbox", { name: "這兩個帳號都是我本人" }));
    await user.click(screen.getByRole("button", { name: "合併帳號" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/合併中/);
    const otherCard = screen.getByRole("region", { name: "將被合併的帳號" });
    expect(within(otherCard).getByText("合併中")).toBeVisible();
    expect(screen.getByRole("link", { name: "前往我的群組" })).toHaveAttribute("href", "/groups");
    expect(screen.getByRole("link", { name: "回到設定" })).toHaveAttribute("href", "/settings");
  });
});
