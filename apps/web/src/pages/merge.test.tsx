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

  it("does not sign in as the kept User before confirmation on the Link code path, and cancelling goes to sign-in", async () => {
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
    expect(screen.queryByRole("navigation")).toBeNull();
    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(await screen.findByRole("button", { name: "使用 LINE 快速登入" })).toBeVisible();
    expect(api.calls).not.toContain("POST /api/v1/auth/merge/confirm");
    expect(screen.queryByRole("heading", { level: 1, name: "我的設定" })).toBeNull();
  });

  it("cancelling on the Settings path returns to Settings with no confirm-merge call", async () => {
    const user = userEvent.setup();
    const kept = makeUser("Google小宇", "google");
    const other = makeUser("LINE小宇", "line");
    const { api } = renderApp({
      path: "/settings",
      cookieUser: kept,
      lineLink: { idToken: "fake|l-other|LINE小宇" },
    });
    api.lineOwners.set("l-other", other);

    const list = await screen.findByRole("list", { name: "已連結的帳號" });
    await user.click(within(accountRow(list, "LINE")).getByRole("button", { name: "連接" }));
    await screen.findByRole("heading", { level: 1, name: "確認合併帳號" });
    await user.click(screen.getByRole("button", { name: "取消" }));

    await screen.findByRole("heading", { level: 1, name: "我的設定" });
    expect(api.calls).not.toContain("POST /api/v1/auth/merge/confirm");
    const accounts = within(screen.getByRole("list", { name: "已連結的帳號" }));
    expect(accounts.getByText("LINE").closest("li")).not.toHaveTextContent("已連結");
  });

  it("shows the translated error and stays on MergePage when cancel fails, then navigates after retry succeeds", async () => {
    const user = userEvent.setup();
    const kept = makeUser("Google小宇", "google");
    const other = makeUser("LINE小宇", "line");
    const { api } = renderApp({
      path: "/settings",
      cookieUser: kept,
      lineLink: { idToken: "fake|l-other|LINE小宇" },
    });
    api.lineOwners.set("l-other", other);

    const list = await screen.findByRole("list", { name: "已連結的帳號" });
    await user.click(within(accountRow(list, "LINE")).getByRole("button", { name: "連接" }));
    await screen.findByRole("heading", { level: 1, name: "確認合併帳號" });

    api.failNext("POST /api/v1/auth/merge/cancel", "INTERNAL", 500);
    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("出了點狀況");
    expect(screen.getByRole("heading", { level: 1, name: "確認合併帳號" })).toBeVisible();
    const cancelButton = screen.getByRole("button", { name: "取消" });
    expect(cancelButton).toBeEnabled();

    await user.click(cancelButton);
    await screen.findByRole("heading", { level: 1, name: "我的設定" });
  });

  it("shows a translated message when the pending Merge is missing or expired", async () => {
    renderApp({
      path: "/merge",
      cookieUser: makeUser("LINE小宇", "line"),
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("失效或過期");
    expect(screen.getByRole("link", { name: "回到設定" })).toHaveAttribute("href", "/settings");
  });

  it("ignores any preview cached in route history and refuses /merge under another Session", async () => {
    const userA = makeUser("帳號A", "line");
    const other = makeUser("帳號A的Google", "google");
    const userB = makeUser("另一位使用者B", "google");
    const { api } = renderApp({
      path: "/merge",
      cookieUser: userB,
      initialState: {
        merge: {
          mergeId: "m-user-a",
          path: "settings",
          expiresAt: Date.now() + 600_000,
          kept: {
            id: userA.id,
            displayName: userA.displayName,
            pictureUrl: null,
            providers: ["line"],
            profileProvider: "line",
            groupCount: 1,
            groups: [{ id: "g-secret", name: "私密群組", shared: false }],
          },
          other: {
            id: other.id,
            displayName: other.displayName,
            pictureUrl: null,
            providers: ["google"],
            profileProvider: "google",
            groupCount: 0,
            groups: [],
          },
        },
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("失效或過期");
    expect(screen.queryByText("帳號A")).toBeNull();
    expect(screen.queryByText("私密群組")).toBeNull();
    expect(screen.queryByRole("button", { name: "合併帳號" })).toBeNull();
    expect(api.calls).toContain("GET /api/v1/auth/merge");
    expect(screen.getByRole("link", { name: "回到設定" })).toHaveAttribute("href", "/settings");
  });

  it("refuses an expired scoped confirmation credential on arrival at /merge instead of showing a cached preview", async () => {
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
    api.googleOwners = new Map([["g-1", other]]);
    api.failNext("GET /api/v1/auth/merge", "UNAUTHORIZED", 401);

    expect(await screen.findByRole("alert")).toHaveTextContent("失效或過期");
    expect(screen.queryByText("LINE聚餐")).toBeNull();
    expect(screen.queryByText("Google旅遊")).toBeNull();
    expect(screen.queryByRole("button", { name: "合併帳號" })).toBeNull();
    expect(screen.queryByRole("button", { name: "取消" })).toBeNull();
    expect(api.calls).toContain("GET /api/v1/auth/merge");
    expect(screen.getByRole("link", { name: "回到登入" })).toHaveAttribute("href", "/sign-in");
  });

  it("refuses a Link-code preview restored without a confirmation credential and offers an exit to sign-in", async () => {
    const kept = makeUser("LINE小宇", "line");
    const other = makeUser("Google小宇", "google");
    renderApp({
      path: "/merge",
      initialState: {
        merge: {
          mergeId: "m-lost",
          path: "linkCode",
          expiresAt: Date.now() + 600_000,
          kept: {
            id: kept.id,
            displayName: kept.displayName,
            pictureUrl: null,
            providers: ["line"],
            profileProvider: "line",
            groupCount: 0,
            groups: [],
          },
          other: {
            id: other.id,
            displayName: other.displayName,
            pictureUrl: null,
            providers: ["google"],
            profileProvider: "google",
            groupCount: 0,
            groups: [],
          },
        },
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("失效或過期");
    expect(screen.queryByRole("button", { name: "合併帳號" })).toBeNull();
    expect(screen.queryByRole("button", { name: "取消" })).toBeNull();
    expect(screen.getByRole("link", { name: "回到登入" })).toHaveAttribute("href", "/sign-in");
  });

  it("replaces an expired Link-code confirmation attempt with the translated expired-Merge refusal and exit", async () => {
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
    await user.click(screen.getByRole("checkbox", { name: "這兩個帳號都是我本人" }));
    api.failNext("POST /api/v1/auth/merge/confirm", "UNAUTHORIZED", 401);
    await user.click(screen.getByRole("button", { name: "合併帳號" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("失效或過期");
    expect(screen.queryByRole("button", { name: "合併帳號" })).toBeNull();
    expect(screen.queryByRole("button", { name: "取消" })).toBeNull();
    expect(screen.getByRole("link", { name: "回到登入" })).toHaveAttribute("href", "/sign-in");
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

  it("marks shared Groups on both User cards", async () => {
    const kept = makeUser("LINE小宇", "line");
    const other = makeUser("Google小宇", "google");
    const { api } = renderApp({
      path: "/link?code=code-1",
      seed: (groups) => {
        groups.add(kept, { name: "共同旅遊", others: [{ name: "Google小宇" }] });
        groups.add(kept, { name: "LINE聚餐" });
        groups.add(other, { name: "Google單獨" });
      },
    });
    api.linkCodes.set("code-1", kept);
    api.googleOwners = new Map([["g-1", other]]);

    await screen.findByRole("heading", { level: 1, name: "確認合併帳號" });

    const keptCard = screen.getByRole("region", { name: "保留的帳號" });
    const otherCard = screen.getByRole("region", { name: "將被合併的帳號" });

    expect(within(keptCard).getByText("共同旅遊").closest("li")).toHaveTextContent(
      "將合併為同一位成員",
    );
    expect(within(keptCard).getByText("LINE聚餐").closest("li")).not.toHaveTextContent(
      "將合併為同一位成員",
    );
    expect(within(otherCard).getByText("共同旅遊").closest("li")).toHaveTextContent(
      "將合併為同一位成員",
    );
    expect(within(otherCard).getByText("Google單獨").closest("li")).not.toHaveTextContent(
      "將合併為同一位成員",
    );
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

function accountRow(list: HTMLElement, provider: "LINE" | "Google") {
  const row = within(list).getByText(provider).closest("li");
  if (row === null) throw new Error(`No account row for ${provider}`);
  return row;
}

describe("/merge (confirming a Merge on the Settings connect-LINE path)", () => {
  it("shows no warning or tick, enables Merge at once, and merges LINE into the Google User", async () => {
    const user = userEvent.setup();
    const kept = makeUser("Google小宇", "google");
    const other = makeUser("LINE小宇", "line");
    const { api } = renderApp({
      path: "/settings",
      cookieUser: kept,
      lineLink: { idToken: "fake|l-other|LINE小宇" },
      seed: (groups) => {
        groups.add(kept, { name: "Google旅遊" });
        groups.add(other, { name: "LINE聚餐" });
        groups.add(kept, { name: "共同群組", others: [{ name: other.displayName }] });
      },
    });
    api.lineOwners.set("l-other", other);

    const list = await screen.findByRole("list", { name: "已連結的帳號" });
    await user.click(within(accountRow(list, "LINE")).getByRole("button", { name: "連接" }));

    expect(await screen.findByRole("heading", { level: 1, name: "確認合併帳號" })).toBeVisible();

    const keptCard = screen.getByRole("region", { name: "保留的帳號" });
    const otherCard = screen.getByRole("region", { name: "將被合併的帳號" });
    expect(within(keptCard).getByText("Google小宇")).toBeVisible();
    expect(within(keptCard).getByText("Google旅遊")).toBeVisible();
    expect(within(keptCard).getByText("共同群組")).toBeVisible();
    expect(within(keptCard).getByText("將合併為同一位成員")).toBeVisible();

    expect(within(otherCard).getByText("LINE小宇")).toBeVisible();
    expect(within(otherCard).getByText("LINE聚餐")).toBeVisible();
    expect(within(otherCard).getByText("共同群組")).toBeVisible();

    expect(screen.getByText(/無法復原/)).toBeVisible();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/不是你.*請按取消/)).toBeNull();

    const mergeButton = screen.getByRole("button", { name: "合併帳號" });
    expect(mergeButton).toBeEnabled();
    await user.click(mergeButton);

    await screen.findByRole("heading", { level: 1, name: "我的設定" });
    const accounts = screen.getByRole("list", { name: "已連結的帳號" });
    const mergedLineRow = accountRow(accounts, "LINE");
    expect(mergedLineRow).toHaveTextContent("已連結");
    expect(mergedLineRow.querySelector(".linked-pop")).not.toBeNull();
    expect(accountRow(accounts, "Google")).toHaveTextContent("已連結");
    expect(screen.getByText("Google小宇@example.com")).toBeVisible();
    expect(api.calls).toContain("POST /api/v1/auth/merge/confirm");
  });

  it("supports connecting LINE and confirming Merge in English without a checkbox", async () => {
    setLocale("en");
    const user = userEvent.setup();
    const kept = { ...makeUser("Google Xiaoyu", "google"), language: "en" as const };
    const other = makeUser("LINE Xiaoyu", "line");
    const { api } = renderApp({
      path: "/settings",
      cookieUser: kept,
      lineLink: { idToken: "fake|l-other|LINE Xiaoyu" },
      seed: (groups) => {
        groups.add(kept, { name: "Google Trip" });
        groups.add(other, { name: "LINE Dinner" });
      },
    });
    api.lineOwners.set("l-other", other);

    const list = await screen.findByRole("list", { name: "Linked accounts" });
    await user.click(within(accountRow(list, "LINE")).getByRole("button", { name: "Connect" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Confirm account merge" }),
    ).toBeVisible();
    expect(screen.queryByRole("checkbox")).toBeNull();
    const mergeButton = screen.getByRole("button", { name: "Merge accounts" });
    expect(mergeButton).toBeEnabled();

    await user.click(mergeButton);
    await screen.findByRole("heading", { level: 1, name: "My settings" });
    const accounts = screen.getByRole("list", { name: "Linked accounts" });
    expect(accountRow(accounts, "LINE")).toHaveTextContent("Linked");
    expect(accountRow(accounts, "Google")).toHaveTextContent("Linked");
  });

  it("keeps the User signed out when an explicit sign-out happens while a Settings confirm is in flight", async () => {
    const user = userEvent.setup();
    const kept = makeUser("Google小宇", "google");
    const other = makeUser("LINE小宇", "line");
    const { api } = renderApp({
      path: "/settings",
      cookieUser: kept,
      lineLink: { idToken: "fake|l-other|LINE小宇" },
    });
    api.lineOwners.set("l-other", other);

    const list = await screen.findByRole("list", { name: "已連結的帳號" });
    await user.click(within(accountRow(list, "LINE")).getByRole("button", { name: "連接" }));
    expect(await screen.findByRole("heading", { level: 1, name: "確認合併帳號" })).toBeVisible();

    const release = api.holdResponses("POST /api/v1/auth/merge/confirm");
    await user.click(screen.getByRole("button", { name: "合併帳號" }));

    const settingsLink = screen.getAllByRole("link", { name: "設定" })[0];
    if (settingsLink === undefined) throw new Error("No settings nav link");
    await user.click(settingsLink);
    await screen.findByRole("heading", { level: 1, name: "我的設定" });
    await user.click(screen.getByRole("button", { name: "登出" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: /搶低價機票/ }, { timeout: 3000 }),
    ).toBeVisible();

    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole("heading", { level: 1, name: /搶低價機票/ })).toBeVisible();
    expect(screen.queryByRole("heading", { level: 1, name: "我的設定" })).toBeNull();
  });
});
