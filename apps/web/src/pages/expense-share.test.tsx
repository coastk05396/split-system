import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp, type RenderAppOptions } from "../../test/render-app.js";

const me = makeUser("小宇");
const friends = [{ name: "宜庭" }, { name: "阿哲" }];

function openNewExpense(options: RenderAppOptions = {}) {
  let id = "";
  const app = renderApp({
    cookieUser: me,
    seed: (groups) => {
      id = groups.add(me, { name: "室友", others: friends });
    },
    pathFor: () => `/groups/${id}/expenses/new`,
    ...options,
  });
  return { ...app, id: () => id };
}

async function recordDinner(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("名稱"), "火鍋");
  await user.type(screen.getByLabelText("金額"), "2160");
  await user.click(screen.getByRole("button", { name: "新增支出" }));
}

describe("sharing a new Expense", () => {
  it("offers Share after saving, and the dialog previews the card with LINE and Telegram links", async () => {
    const user = userEvent.setup();
    const { id, router } = openNewExpense();

    await recordDinner(user);

    expect(await screen.findByText(/已新增 ✓/)).toBeVisible();
    // The note is not kept in the history entry, so a reload does not show it again.
    await waitFor(() => {
      expect((router.state.location.state as { share?: unknown } | null)?.share).toBeUndefined();
    });
    await user.click(screen.getByRole("button", { name: "分享" }));

    const dialog = within(await screen.findByRole("dialog", { name: "分享這筆開銷" }));
    expect(dialog.getByText("室友")).toBeVisible();
    expect(dialog.getByText(/火鍋/)).toBeVisible();
    expect(dialog.getByText("NT$ 2,160")).toBeVisible();
    expect(dialog.getByText("3 人一起分")).toBeVisible();
    expect(dialog.getByText("小宇先付")).toBeVisible();
    expect(dialog.getByText("每人約 NT$ 720")).toBeVisible();
    expect(dialog.getByText(/查看這筆開銷/)).toBeVisible();
    const link = `${window.location.origin}/groups/${id()}/expenses/`;
    expect(dialog.getByRole("button", { name: "透過 LINE 分享" })).toBeVisible();
    await user.click(dialog.getByRole("button", { name: "複製訊息" }));
    expect(await navigator.clipboard.readText()).toContain(link);
    expect(await navigator.clipboard.readText()).toContain("火鍋");
    expect(dialog.queryByRole("button", { name: "更多方式…" })).toBeNull();
    expect(dialog.getByRole("link", { name: "透過 Telegram 分享" })).toHaveAttribute(
      "href",
      expect.stringContaining("https://t.me/share/url?url="),
    );
  });

  it("shares the Flex card through the LINE picker inside LINE", async () => {
    const user = userEvent.setup();
    const { lineShareMessages } = openNewExpense({ insideLine: { idToken: null } });

    await recordDinner(user);
    await user.click(await screen.findByRole("button", { name: "分享" }));
    await user.click(await screen.findByRole("button", { name: "透過 LINE 分享" }));

    expect(lineShareMessages).toHaveLength(1);
    expect(lineShareMessages[0]).toMatchObject({ type: "flex", altText: "火鍋 NT$ 2,160" });
  });
});

describe("posting into the current LINE chat", () => {
  it("shows the checkbox only in a chat, off by default", async () => {
    openNewExpense({ insideLine: { idToken: null }, lineChat: true });

    const box = await screen.findByRole("checkbox", { name: /同時發送至當前 LINE 對話框/ });
    expect(box).not.toBeChecked();
  });

  it("hides the checkbox outside a chat", async () => {
    openNewExpense({ insideLine: { idToken: null }, lineChat: false });

    await screen.findByLabelText("名稱");
    expect(screen.queryByRole("checkbox", { name: /LINE 對話框/ })).toBeNull();
  });

  it("posts the card into the chat when ticked", async () => {
    const user = userEvent.setup();
    const { lineChatMessages } = openNewExpense({ insideLine: { idToken: null }, lineChat: true });

    await user.click(await screen.findByRole("checkbox", { name: /LINE 對話框/ }));
    await recordDinner(user);

    expect(await screen.findByText("已新增，並發送到對話框 ✓")).toBeVisible();
    expect(lineChatMessages).toHaveLength(1);
    expect(lineChatMessages[0]).toMatchObject({ type: "flex", altText: "火鍋 NT$ 2,160" });
  });

  it("posts nothing when left unticked", async () => {
    const user = userEvent.setup();
    const { lineChatMessages } = openNewExpense({ insideLine: { idToken: null }, lineChat: true });

    await screen.findByRole("checkbox", { name: /LINE 對話框/ });
    await recordDinner(user);

    expect(await screen.findByText(/已新增 ✓/)).toBeVisible();
    expect(screen.queryByText(/發送到對話框/)).toBeNull();
    expect(lineChatMessages).toHaveLength(0);
  });

  it("keeps the saved Expense and points to Share when the chat refuses it", async () => {
    const user = userEvent.setup();
    const { api, id } = openNewExpense({
      insideLine: { idToken: null },
      lineChat: true,
      lineChatFails: true,
    });

    await user.click(await screen.findByRole("checkbox", { name: /LINE 對話框/ }));
    await recordDinner(user);

    expect(await screen.findByText(/沒能發送到對話框/)).toBeVisible();
    expect(api.groups.expenses.list(id())).toHaveLength(1);
  });
});

describe("sharing an older Expense", () => {
  it("shares it from the detail page", async () => {
    const user = userEvent.setup();
    let id = "";
    renderApp({
      cookieUser: me,
      seed: (groups) => {
        id = groups.add(me, {
          name: "室友",
          others: friends,
          expenses: [{ description: "火鍋", amount: 2160 }],
        });
      },
      pathFor: () => `/groups/${id}/expenses/e-火鍋`,
    });

    await user.click(await screen.findByRole("button", { name: "分享" }));

    const dialog = within(await screen.findByRole("dialog", { name: "分享這筆開銷" }));
    expect(dialog.getByText("室友")).toBeVisible();
    expect(dialog.getByText(/火鍋/)).toBeVisible();
  });
});
