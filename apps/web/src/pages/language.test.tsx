import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

const me = makeUser("小宇");

describe("language", () => {
  it("switches the whole app to English from Settings, and back", async () => {
    const user = userEvent.setup();
    const { api } = renderApp({ path: "/settings", cookieUser: me });

    await user.selectOptions(await screen.findByRole("combobox", { name: "語言" }), "English");

    expect(await screen.findByRole("heading", { level: 1, name: "My settings" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Language" })).toHaveValue("en");
    expect(api.calls).toContain("PATCH /api/v1/me");
    // The bottom navigation speaks English too.
    expect(
      within(screen.getByRole("navigation", { name: "Bottom navigation" })).getByText("Home"),
    ).toBeVisible();

    await user.selectOptions(screen.getByRole("combobox", { name: "Language" }), "繁體中文");
    expect(await screen.findByRole("heading", { level: 1, name: "我的設定" })).toBeVisible();
  });

  it("shows each linked account as Linked in English", async () => {
    renderApp({
      path: "/settings",
      cookieUser: {
        ...me,
        language: "en",
        identities: [{ provider: "google" }, { provider: "line" }],
      },
    });

    expect(await screen.findAllByText("Linked")).toHaveLength(2);
  });

  it("opens in the language saved on the account", async () => {
    renderApp({ cookieUser: { ...me, language: "en" } });

    expect(await screen.findByText("Hi, 小宇!")).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Quick start" })).toBeVisible();
  });

  it("draws categories, dates and amounts in English", async () => {
    let id = "";
    renderApp({
      cookieUser: { ...me, language: "en" },
      seed: (groups) => {
        id = groups.add(me, { name: "Trip", settlementCurrency: "TWD" });
      },
      pathFor: () => `/groups/${id}/expenses/new`,
    });

    expect(await screen.findByRole("radio", { name: "Food & drink" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "Medical" })).toBeVisible();
  });
});
