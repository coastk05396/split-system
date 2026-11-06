import { act, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
  it("shows a claimed share even when its Invite arrives after the retention window", async () => {
    const user = userEvent.setup();
    const { api, id } = openNewExpense();
    const release = api.holdResponses(`POST /api/v1/groups/${id()}/invite/ensure`);
    try {
      await recordDinner(user);
      await screen.findByRole("region", { name: "帳目" });
      vi.useFakeTimers();
      await act(async () => vi.advanceTimersByTimeAsync(60_001));
      await act(async () => {
        release();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText(/已新增 ✓/)).toBeVisible();
    } finally {
      release();
      vi.useRealTimers();
    }
  });

  it("keeps a saved share through StrictMode's effect replay", async () => {
    const user = userEvent.setup();
    const { api, id } = openNewExpense({ strictMode: true });
    const release = api.holdResponses(`POST /api/v1/groups/${id()}/invite/ensure`);
    try {
      await recordDinner(user);
      await screen.findByRole("region", { name: "帳目" });
      act(() => {
        release();
      });
      expect(await screen.findByText(/已新增 ✓/)).toBeVisible();
    } finally {
      release();
    }
  });

  it.each(["chosen", "forced"])(
    "does not post a saved Expense whose Invite arrives after %s sign-out",
    async (kind) => {
      const user = userEvent.setup();
      const { api, id, router, lineChatMessages, queryClient } = openNewExpense({
        insideLine: { idToken: null },
        lineChat: true,
      });
      const release = api.holdResponses(`POST /api/v1/groups/${id()}/invite/ensure`);
      try {
        await screen.findByRole("checkbox", { name: /LINE 對話框/ });
        await recordDinner(user);
        await waitFor(() => {
          expect(router.state.location.pathname).toBe(`/groups/${id()}`);
        });
        if (kind === "chosen") {
          await act(async () => {
            await router.navigate("/settings");
          });
          await user.click(await screen.findByRole("button", { name: "登出" }));
        } else {
          api.expireAccessToken();
          api.setCookieUser(null);
          await act(async () => {
            await queryClient.invalidateQueries({ queryKey: ["groups", id()] });
          });
        }
        await waitFor(() => {
          expect(router.state.location.pathname).toBe(kind === "chosen" ? "/" : "/sign-in");
        });
        await act(async () => {
          release();
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(lineChatMessages).toHaveLength(0);
        expect(screen.queryByText(/已新增/)).toBeNull();
        expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
      } finally {
        release();
      }
    },
  );

  it("opens the Group while invite and chat delivery are pending, then shows a late chat failure", async () => {
    const user = userEvent.setup();
    let rejectChat: (reason: Error) => void = () => undefined;
    let chatCalls = 0;
    const { api, id, router } = openNewExpense({
      insideLine: { idToken: null },
      lineChat: true,
      sendToChat: () => {
        chatCalls++;
        return new Promise<void>((_resolve, reject) => {
          rejectChat = reject;
        });
      },
    });
    const releaseInvite = api.holdResponses(`POST /api/v1/groups/${id()}/invite/ensure`);
    try {
      await screen.findByRole("checkbox", { name: /LINE 對話框/ });
      await recordDinner(user);
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/groups/${id()}`);
      });
      expect(chatCalls).toBe(0);
      expect(api.groups.expenses.list(id())).toHaveLength(1);
      releaseInvite();
      await waitFor(() => {
        expect(chatCalls).toBe(1);
      });
      expect(router.state.location.pathname).toBe(`/groups/${id()}`);
      await act(async () => {
        await Promise.resolve();
        rejectChat(new Error("chat unavailable"));
      });
      expect(await screen.findByText(/沒能發送到對話框/)).toBeVisible();
    } finally {
      releaseInvite();
    }
  });

  it("asks for the Invite once when saving before the warm-up has answered", async () => {
    const user = userEvent.setup();
    const { api, id, router } = openNewExpense();
    const ensure = `POST /api/v1/groups/${id()}/invite/ensure`;
    const asked = () => api.requests.filter((r) => r.route === ensure).length;
    const release = api.holdResponses(ensure);
    try {
      await waitFor(() => {
        expect(asked()).toBe(1);
      });
      await recordDinner(user);
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/groups/${id()}`);
      });
      expect(asked()).toBe(1);
    } finally {
      release();
    }
  });

  it("shares an in-flight warm-up with the Invite dialog after navigating to Members", async () => {
    const user = userEvent.setup();
    const { api, id, router } = openNewExpense();
    const ensure = `POST /api/v1/groups/${id()}/invite/ensure`;
    const asked = () => api.requests.filter((request) => request.route === ensure).length;
    const release = api.holdResponses(ensure);
    try {
      await waitFor(() => {
        expect(asked()).toBe(1);
      });
      await act(async () => {
        await router.navigate(`/groups/${id()}/members`);
      });
      await user.click(await screen.findByRole("button", { name: "邀請成員" }));
      expect(asked()).toBe(1);
      release();
      expect(await screen.findByRole("img", { name: /QR Code/ })).toBeVisible();
    } finally {
      release();
    }
  });

  it("offers an existing-Member link when an Invite cannot be prepared", async () => {
    const user = userEvent.setup();
    const { api, id } = openNewExpense();
    const ensure = `POST /api/v1/groups/${id()}/invite/ensure`;
    // Opening the screen already asks for the Invite once; fail that and the retry at save time.
    api.failNext(ensure);
    await waitFor(() => {
      expect(api.requests.some((r) => r.route === ensure)).toBe(true);
    });
    api.failNext(ensure);
    await recordDinner(user);
    await user.click(await screen.findByRole("button", { name: "分享" }));
    const dialog = within(await screen.findByRole("dialog", { name: "分享這筆開銷" }));
    await user.click(dialog.getByRole("button", { name: "複製訊息" }));
    expect(await navigator.clipboard.readText()).toContain(`/groups/${id()}/expenses/`);
    expect(await navigator.clipboard.readText()).not.toContain("/join/");
  });
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
    expect(dialog.getByText(/查看明細/)).toBeVisible();
    // The card opens through the Group's Invite, so someone outside the Group can get in.
    const link = `${window.location.origin}/join/`;
    const next = encodeURIComponent(`/groups/${id()}/expenses/`);
    expect(dialog.getByRole("button", { name: "透過 LINE 分享" })).toBeVisible();
    await user.click(dialog.getByRole("button", { name: "複製訊息" }));
    expect(await navigator.clipboard.readText()).toContain(link);
    expect(await navigator.clipboard.readText()).toContain(`?next=${next}`);
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
  it("shows the checkbox only in a chat, ticked by default", async () => {
    openNewExpense({ insideLine: { idToken: null }, lineChat: true });

    const box = await screen.findByRole("checkbox", { name: /同時發送至當前 LINE 對話框/ });
    expect(box).toBeChecked();
  });

  it("hides the checkbox outside a chat", async () => {
    openNewExpense({ insideLine: { idToken: null }, lineChat: false });

    await screen.findByLabelText("名稱");
    expect(screen.queryByRole("checkbox", { name: /LINE 對話框/ })).toBeNull();
  });

  it("posts the card into the chat by default", async () => {
    const user = userEvent.setup();
    const { lineChatMessages } = openNewExpense({ insideLine: { idToken: null }, lineChat: true });

    await screen.findByRole("checkbox", { name: /LINE 對話框/ });
    await recordDinner(user);

    expect(await screen.findByText("已新增，並發送到對話框 ✓")).toBeVisible();
    expect(lineChatMessages).toHaveLength(1);
    expect(lineChatMessages[0]).toMatchObject({ type: "flex", altText: "火鍋 NT$ 2,160" });
  });

  it("posts nothing when unticked", async () => {
    const user = userEvent.setup();
    const { lineChatMessages } = openNewExpense({ insideLine: { idToken: null }, lineChat: true });

    await user.click(await screen.findByRole("checkbox", { name: /LINE 對話框/ }));
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

    await screen.findByRole("checkbox", { name: /LINE 對話框/ });
    await recordDinner(user);

    expect(await screen.findByText(/沒能發送到對話框/)).toBeVisible();
    expect(api.groups.expenses.list(id())).toHaveLength(1);
  });
});

describe("sharing an older Expense", () => {
  it("opens sharing with an existing-Member link when Invite preparation fails", async () => {
    const user = userEvent.setup();
    let id = "";
    const { api } = renderApp({
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
    api.failNext(`POST /api/v1/groups/${id}/invite/ensure`);
    await user.click(await screen.findByRole("button", { name: "分享" }));
    const dialog = within(await screen.findByRole("dialog", { name: "分享這筆開銷" }));
    await user.click(dialog.getByRole("button", { name: "複製訊息" }));
    expect(await navigator.clipboard.readText()).toContain(`/groups/${id}/expenses/e-火鍋`);
    expect(await navigator.clipboard.readText()).not.toContain("/join/");
  });
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
