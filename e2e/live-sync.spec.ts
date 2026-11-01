import { expect, test } from "@playwright/test";

test.describe("Two-user live update via WebSocket (SPEC §5, Ticket 12)", () => {
  test("User A records an expense and User B sees it without reload", async ({
    page: pageA,
    browser,
    baseURL,
  }) => {
    // 1. User A visits root page and signs in
    await pageA.goto("/");
    await expect(pageA.getByRole("heading", { name: /一筆快分/ })).toBeVisible();
    await pageA.getByRole("link", { name: "登入開始使用" }).click();
    await expect(pageA).toHaveURL(/\/sign-in/);

    const testFormA = pageA.locator('form[aria-label="測試登入（僅限本機）"]');
    await expect(testFormA).toBeVisible();
    await testFormA.getByLabel("顯示名稱").fill("小凱");
    await testFormA.getByRole("button", { name: "測試登入" }).click();
    await expect(pageA.getByRole("heading", { name: /小凱/ })).toBeVisible();

    // 2. User A creates a group
    await pageA.goto("/groups/new");
    await pageA.getByLabel("群組名稱").fill("花蓮放空行");
    await pageA.getByRole("button", { name: "建立群組，繼續" }).click();

    // User A lands on members page and opens invite dialog to ensure invite token
    await expect(pageA).toHaveURL(/\/groups\/[^/]+\/members/);
    const groupId = new URL(pageA.url()).pathname.match(/^\/groups\/([^/]+)\/members$/)?.[1];
    if (!groupId) throw new Error("Expected a members URL with a group ID");

    const ensurePromise = pageA.waitForResponse(
      (res) => res.url().includes("/invite/ensure") && res.status() === 200,
    );
    await pageA.getByRole("button", { name: "邀請成員" }).click();
    const ensureRes = await ensurePromise;
    const { token: inviteToken } = (await ensureRes.json()) as { token: string };

    // User A goes to the group page
    await pageA.goto(`/groups/${groupId}`);
    await expect(pageA.getByRole("heading", { name: "花蓮放空行" })).toBeVisible();

    // 3. User B in an isolated browser context signs in and joins the group
    const contextB = await browser.newContext({
      locale: "zh-TW",
      ...(baseURL ? { baseURL } : {}),
    });
    const pageB = await contextB.newPage();

    await pageB.goto("/sign-in");
    const testFormB = pageB.locator('form[aria-label="測試登入（僅限本機）"]');
    await expect(testFormB).toBeVisible();
    await testFormB.getByLabel("顯示名稱").fill("阿明");
    await testFormB.getByRole("button", { name: "測試登入" }).click();
    await expect(pageB.getByRole("heading", { name: /阿明/ })).toBeVisible();

    // User B opens invite link and joins the group
    await pageB.goto(`/join/${inviteToken}`);
    await expect(pageB.getByRole("heading", { name: "花蓮放空行" })).toBeVisible();
    await pageB.getByRole("button", { name: "加入群組" }).click();
    await expect(pageB).toHaveURL(`/groups/${groupId}`);
    await expect(pageB.getByRole("heading", { name: "花蓮放空行" })).toBeVisible();

    // Verify initial empty expense state on User B's screen
    await expect(pageB.getByText("還沒有任何帳目，記下第一筆吧！")).toBeVisible();

    // 4. User A records a new expense
    await pageA.getByRole("link", { name: "新增支出" }).click();
    await expect(pageA).toHaveURL(`/groups/${groupId}/expenses/new`);
    await pageA.getByLabel("名稱").fill("包子豆漿");
    await pageA.getByRole("textbox", { name: "金額" }).fill("300");
    await pageA.getByRole("button", { name: "新增支出" }).click();

    // User A is redirected back to the group page and sees the expense
    await expect(pageA).toHaveURL(`/groups/${groupId}`);
    await expect(pageA.getByText("包子豆漿")).toBeVisible();
    await expect(pageA.getByText("NT$ 300", { exact: true })).toBeVisible();

    // 5. Without any reload or user interaction, User B's screen receives the WebSocket live update
    await expect(pageB.getByText("包子豆漿")).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByText("NT$ 300", { exact: true })).toBeVisible();
    await expect(pageB.getByText("還沒有任何帳目，記下第一筆吧！")).not.toBeVisible();

    // Clean up second browser context
    await contextB.close();
  });
});
