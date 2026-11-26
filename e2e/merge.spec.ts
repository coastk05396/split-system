import { expect, test } from "@playwright/test";

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

test.describe("User Merge on Link code path E2E (#227)", () => {
  test("LINE User redeems Link code with a Google that owns another User, confirms Merge, and lands in Settings with both linked", async ({
    browser,
    baseURL,
    page,
  }) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const googleSub = `e2e-google-${suffix}`;

    // 1. Seed a Google User with their own Group.
    const googleContext = await browser.newContext({
      locale: "zh-TW",
      ...(baseURL ? { baseURL } : {}),
    });
    const signInGoogle = await googleContext.request.post("/api/v1/auth/test-sign-in", {
      data: { provider: "google", sub: googleSub, displayName: "Google小宇" },
    });
    expect(signInGoogle.status()).toBe(200);
    const { accessToken: googleToken } = (await signInGoogle.json()) as { accessToken: string };
    const createGoogleGroup = await googleContext.request.post("/api/v1/groups", {
      headers: { Authorization: `Bearer ${googleToken}` },
      data: { name: "Google旅遊群" },
    });
    expect(createGoogleGroup.status()).toBe(201);
    await googleContext.close();

    // 2. Test-signed-in LINE User creates a Group and issues a Link code.
    const lineName = `LINE小宇-${suffix}`;
    await page.goto("/sign-in");
    const testForm = page.locator('form[aria-label="測試登入（僅限本機）"]');
    await testForm.getByLabel("顯示名稱").fill(lineName);
    await testForm.getByLabel("身分來源").selectOption("line");
    await testForm.getByRole("button", { name: "測試登入" }).click();
    await expect(page.getByRole("heading", { name: new RegExp(lineName) })).toBeVisible();

    await page.getByRole("link", { name: /^快速分帳/ }).click();
    await expect(page).toHaveURL(/\/groups\/new/);
    await page.getByLabel("群組名稱").fill("LINE吃飯群");
    await page.getByRole("button", { name: "建立群組，繼續" }).click();
    await expect(page).toHaveURL(/\/groups\/[^/]+\/members/);

    const lineContext = await browser.newContext({
      locale: "zh-TW",
      ...(baseURL ? { baseURL } : {}),
    });
    const signInLine = await lineContext.request.post("/api/v1/auth/test-sign-in", {
      data: { provider: "line", sub: `dev-line-${lineName}`, displayName: lineName },
    });
    expect(signInLine.status()).toBe(200);
    const { accessToken: lineToken } = (await signInLine.json()) as { accessToken: string };
    const codeRes = await lineContext.request.post("/api/v1/auth/link-code", {
      headers: { Authorization: `Bearer ${lineToken}` },
    });
    expect(codeRes.status()).toBe(200);
    const { code } = (await codeRes.json()) as { code: string };
    await lineContext.close();

    // 3. Outside browser opens /link?code=... and returns from fake Google with the owned Google User.
    const outsideContext = await browser.newContext({
      locale: "zh-TW",
      ...(baseURL ? { baseURL } : {}),
    });
    const outsidePage = await outsideContext.newPage();
    await outsidePage.route("https://accounts.google.com/o/oauth2/v2/auth**", async (route) => {
      const authUrl = new URL(route.request().url());
      const state = authUrl.searchParams.get("state") ?? "";
      const nonce = authUrl.searchParams.get("nonce") ?? "";
      const redirectUri = authUrl.searchParams.get("redirect_uri") ?? "";
      const fakeJwt = `fake.${base64urlJson({
        nonce,
        sub: googleSub,
        name: "Google小宇",
        email: "merge@example.com",
      })}.sig`;
      const target = `${redirectUri}#state=${encodeURIComponent(state)}&id_token=${encodeURIComponent(fakeJwt)}`;
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><script>location.replace(${JSON.stringify(target)});</script>`,
      });
    });

    await outsidePage.goto(`/link?code=${encodeURIComponent(code)}`);

    // 4. Lands on Merge confirmation screen, ticks "both are me", confirms, and lands in Settings.
    await expect(outsidePage.getByRole("heading", { level: 1, name: "確認合併帳號" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(outsidePage.getByText("LINE吃飯群")).toBeVisible();
    await expect(outsidePage.getByText("Google旅遊群")).toBeVisible();

    const mergeButton = outsidePage.getByRole("button", { name: "合併帳號" });
    await expect(mergeButton).toBeDisabled();
    await outsidePage.getByRole("checkbox", { name: "這兩個帳號都是我本人" }).check();
    await expect(mergeButton).toBeEnabled();
    await mergeButton.click();

    await expect(outsidePage).toHaveURL(/\/settings/);
    await expect(outsidePage.getByRole("heading", { level: 1, name: "我的設定" })).toBeVisible();
    const accounts = outsidePage.getByRole("list", { name: "已連結的帳號" });
    await expect(accounts.getByText("LINE").locator("..")).toContainText("已連結");
    await expect(accounts.getByText("Google").locator("..")).toContainText("已連結");

    await outsidePage.goto("/groups");
    await expect(outsidePage.getByText("LINE吃飯群")).toBeVisible();
    await expect(outsidePage.getByText("Google旅遊群")).toBeVisible();

    await outsideContext.close();
  });
});
