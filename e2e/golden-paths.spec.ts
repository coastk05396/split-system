import { expect, test } from "@playwright/test";

test.describe("Golden Path E2E (SPEC §7.3)", () => {
  test("sign in → create group → add member → add expense → settle balance", async ({ page }) => {
    // 1. Visit root page and navigate to sign-in
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /一筆快分/ })).toBeVisible();

    // Click "登入開始使用"
    await page.getByRole("link", { name: "登入開始使用" }).click();
    await expect(page).toHaveURL(/\/sign-in/);

    // 2. Sign in using the test identity form
    const testForm = page.locator('form[aria-label="測試登入（僅限本機）"]');
    await expect(testForm).toBeVisible();
    await testForm.getByLabel("顯示名稱").fill("小宇");
    await testForm.getByRole("button", { name: "測試登入" }).click();

    // 3. User lands on home page with personalized greeting
    await expect(page.getByRole("heading", { name: /小宇/ })).toBeVisible();

    // 4. Create a new group from the 快速分帳 start card (a first-time user has no groups)
    await page.getByRole("link", { name: /^快速分帳/ }).click();
    await expect(page).toHaveURL(/\/groups\/new/);
    await page.getByLabel("群組名稱").fill("台南吃透透");
    await page.getByRole("button", { name: "建立群組，繼續" }).click();

    // 5. Lands on the combined Members and Invite page, return to group page
    await expect(page).toHaveURL(/\/groups\/[^/]+\/members/);
    const groupId = new URL(page.url()).pathname.match(/^\/groups\/([^/]+)\/members$/)?.[1];
    if (!groupId) throw new Error("Expected a members URL with a group ID");
    await page.goto(`/groups/${groupId}`);
    await expect(page.getByRole("heading", { name: "台南吃透透" })).toBeVisible();

    // 6. Add a placeholder member
    await page.getByRole("link", { name: "只有你" }).click();
    await expect(page).toHaveURL(`/groups/${groupId}/members`);
    await page.getByRole("button", { name: "新增成員" }).click();
    await expect(page.getByText("成員1（未加入）")).toBeVisible();

    // Return to group page
    await page.goto(`/groups/${groupId}`);

    // 7. Add an expense: $200 equally split between 小宇 and 成員1
    await page.getByRole("link", { name: "新增支出" }).click();
    await expect(page).toHaveURL(`/groups/${groupId}/expenses/new`);
    await page.getByLabel("名稱").fill("度小月擔仔麵");
    await page.getByRole("textbox", { name: "金額" }).fill("200");
    await page.getByRole("button", { name: "新增支出" }).click();

    // 8. Returned to group page, switch to "結算" tab
    await expect(page).toHaveURL(`/groups/${groupId}`);
    await page.getByRole("tab", { name: "結算" }).click();

    // 9. Payment plan shows 成員1 owes 小宇 NT$ 100 (小宇 is "你" in the signed-in view)
    const planList = page.getByRole("list", { name: "要付給誰" });
    await expect(planList).toBeVisible({ timeout: 15_000 });
    const planItem = planList.getByRole("listitem").filter({ hasText: "成員1付給你" });
    await expect(planItem).toContainText("NT$ 100");

    // 10. Receiver confirms the settlement
    await planItem.getByRole("button", { name: "確認收款" }).click();
    const dialog = page.getByRole("dialog", { name: "這筆款項已付清嗎？" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "確認已結清" }).click();

    // 11. Verify debts are completely settled
    await expect(page.getByText("大家都結清了！")).toBeVisible({ timeout: 10_000 });
    // The confirmed payment is in the history, one line under its day.
    const historyList = page.getByRole("list", { name: "結算紀錄" });
    await expect(historyList).toContainText("成員1付給你");
    await expect(historyList).toContainText("NT$ 100");
  });
});
