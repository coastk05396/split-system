import { act, screen, waitFor } from "@testing-library/react";
import { QueryObserver } from "@tanstack/react-query";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

// The Trip module is under maintenance in the app; these tests run it switched on.
const trip = vi.hoisted(() => ({ enabled: true }));
vi.mock("../trip/enabled.js", () => ({
  get TRIP_ENABLED() {
    return trip.enabled;
  },
}));
afterEach(() => {
  trip.enabled = true;
});

const me = makeUser("小宇");

describe("create Group", () => {
  it("creates a Trip with its Settlement currency, then opens Members and Invites", async () => {
    const user = userEvent.setup();
    const { api, router } = renderApp({ path: "/groups/new?usage=trip", cookieUser: me });

    await user.type(await screen.findByLabelText("群組名稱"), "週末台南小旅行");
    expect(screen.getByRole("radio", { name: /旅行行程/ })).toBeChecked();
    await user.selectOptions(screen.getByLabelText("結算幣別"), "USD");
    await user.click(screen.getByRole("button", { name: /建立群組，繼續/ }));

    expect(await screen.findByRole("heading", { name: "成員與邀請" })).toBeVisible();
    const id = router.state.location.pathname.split("/")[2] ?? "";
    expect(router.state.location.pathname).toBe(`/groups/${id}/members`);
    expect(api.groups.members(id)).toHaveLength(1);
    expect(api.groups.summary(id)).toEqual({
      name: "週末台南小旅行",
      isTrip: true,
      settlementCurrency: "USD",
    });
  });

  it("opens the created Group without waiting for an active Group list refetch", async () => {
    const user = userEvent.setup();
    const { router, queryClient } = renderApp({ path: "/groups/new", cookieUser: me });
    await user.type(await screen.findByLabelText("群組名稱"), "Fast group");
    const observer = new QueryObserver(queryClient, {
      queryKey: ["groups"],
      initialData: [],
      staleTime: Infinity,
      queryFn: () => new Promise<never>(() => {}),
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await user.click(screen.getByRole("button", { name: /建立群組，繼續/ }));
      await waitFor(() => {
        expect(router.state.location.pathname).toMatch(/^\/groups\/[^/]+\/members$/);
      });
      const id = router.state.location.pathname.split("/")[2];
      expect(queryClient.getQueryData(["groups", id])).toMatchObject({ name: "Fast group" });
    } finally {
      unsubscribe();
    }
  });

  it("shows the new Member list and a way back to Home before the Members are fetched", async () => {
    const user = userEvent.setup();
    const { api, router } = renderApp({ path: "/groups/new", cookieUser: me });
    await user.type(await screen.findByLabelText("群組名稱"), "Quick start");
    const release = api.holdResponses("GET /api/v1/groups/g-1/members");
    try {
      await user.click(screen.getByRole("button", { name: /建立群組，繼續/ }));
      expect(await screen.findByRole("heading", { name: "成員與邀請" })).toBeVisible();
      expect(router.state.location.pathname).toBe("/groups/g-1/members");
      expect(screen.getByText(/小宇/)).toBeVisible();
      await user.click(screen.getByRole("link", { name: "回到首頁" }));
      expect(router.state.location.pathname).toBe("/");
    } finally {
      release();
    }
  });

  it("shows a full-screen creating message until the server answers", async () => {
    const user = userEvent.setup();
    const { api, router } = renderApp({ path: "/groups/new", cookieUser: me });
    await user.type(await screen.findByLabelText("群組名稱"), "Slow group");
    const release = api.holdResponses("POST /api/v1/groups");
    try {
      await user.click(screen.getByRole("button", { name: /建立群組，繼續/ }));
      expect(await screen.findByRole("dialog", { name: "建立群組中…" })).toBeVisible();
      expect(screen.queryByRole("textbox", { name: "群組名稱" })).toBeNull();
      expect(router.state.location.pathname).toBe("/groups/new");
    } finally {
      release();
    }
    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/groups\/[^/]+\/members$/);
    });
  });

  it("puts the keyboard back on the button after a slow refusal", async () => {
    const user = userEvent.setup();
    const { api } = renderApp({ path: "/groups/new", cookieUser: me });
    await user.type(await screen.findByLabelText("群組名稱"), "室友");
    api.failNext("POST /api/v1/groups", "GROUP_LIMIT_REACHED", 409);
    const release = api.holdResponses("POST /api/v1/groups");
    try {
      await user.click(screen.getByRole("button", { name: /建立群組，繼續/ }));
      const waiting = await screen.findByRole("dialog", { name: "建立群組中…" });
      expect(waiting).toContainElement(document.activeElement as HTMLElement);
    } finally {
      release();
    }
    expect(await screen.findByRole("alert")).toHaveTextContent("你最多只能加入 20 個群組。");
    expect(screen.getByRole("button", { name: /建立群組，繼續/ })).toHaveFocus();
  });

  it("stays on the creating screen when the User tries to leave before the server answers", async () => {
    const user = userEvent.setup();
    const { api, router } = renderApp({ path: "/groups/new", cookieUser: me });
    await user.type(await screen.findByLabelText("群組名稱"), "Slow group");
    const release = api.holdResponses("POST /api/v1/groups");
    try {
      await user.click(screen.getByRole("button", { name: /建立群組，繼續/ }));
      expect(await screen.findByRole("dialog", { name: "建立群組中…" })).toBeVisible();
      await act(async () => {
        await router.navigate("/groups");
      });
      expect(router.state.location.pathname).toBe("/groups/new");
    } finally {
      release();
    }
    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/groups\/[^/]+\/members$/);
    });
  });

  it("defaults to a TWD Running Tab and says the Settlement currency locks", async () => {
    renderApp({ path: "/groups/new", cookieUser: me });

    expect(await screen.findByRole("radio", { name: /快速分帳/ })).toBeChecked();
    expect(screen.getByLabelText("結算幣別")).toHaveValue("TWD");
    expect(screen.getByText("記下第一筆開銷後就不能再更改。")).toBeVisible();
    expect(screen.getByRole("button", { name: /建立群組，繼續/ })).toBeDisabled();
  });

  it("greys out the Trip option under maintenance and opens a Running Tab instead", async () => {
    trip.enabled = false;
    renderApp({ path: "/groups/new?usage=trip", cookieUser: me });

    expect(await screen.findByRole("radio", { name: /旅行行程/ })).toBeDisabled();
    expect(screen.getByText("保養中")).toBeVisible();
    expect(screen.getByRole("radio", { name: /快速分帳/ })).toBeChecked();
  });

  it("starts the Settlement currency at the Preferred currency", async () => {
    renderApp({ path: "/groups/new", cookieUser: { ...me, preferredCurrency: "USD" } });

    expect(await screen.findByLabelText("結算幣別")).toHaveValue("USD");
    expect(screen.queryByLabelText("預設記帳幣別")).toBeNull();
  });

  it("explains a refused create", async () => {
    const user = userEvent.setup();
    const { api } = renderApp({ path: "/groups/new", cookieUser: me });
    api.failNext("POST /api/v1/groups", "GROUP_LIMIT_REACHED", 409);

    await user.type(await screen.findByLabelText("群組名稱"), "室友");
    await user.click(screen.getByRole("button", { name: /建立群組，繼續/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("你最多只能加入 20 個群組。");
    // The wait is over: the keyboard is back on the button it pressed.
    expect(screen.getByRole("button", { name: /建立群組，繼續/ })).toHaveFocus();
  });

  it("updates live avatar glyph and rolls color with the dice button", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/groups/new", cookieUser: me });

    expect(await screen.findByRole("heading", { name: "建立群組" })).toBeVisible();

    // Subtitle is removed
    expect(screen.queryByText("同一個群組，可以快分，也可以開啟旅程。")).toBeNull();

    // Default glyph is "群"
    expect(screen.getByText("群")).toBeInTheDocument();

    // Type group name and check glyph updates in real-time
    const nameInput = screen.getByLabelText("群組名稱");
    await user.type(nameInput, "沖繩耍廢團");
    expect(screen.getByText("沖")).toBeInTheDocument();

    // Sprout mascot invite card is present
    expect(screen.getByText("邀請朋友，一起開始")).toBeVisible();
    expect(screen.getByText("建立後就能分享連結，同一份帳大家都看得到")).toBeVisible();

    // Clicking the 🎲 dice button changes the avatar styling
    const diceButton = screen.getAllByRole("button", { name: "隨機換色" })[1];
    if (diceButton === undefined) throw new Error("Missing dice button");
    const avatarEl = screen.getByText("沖").parentElement;
    const initialClass = avatarEl?.className;
    await user.click(diceButton);
    expect(avatarEl?.className).not.toBe(initialClass);
  });
});
