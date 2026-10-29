import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

const me = makeUser("小宇");

describe("＋ new entry", () => {
  it("asks which Group the Expense goes in", async () => {
    let first = "";
    renderApp({
      cookieUser: me,
      path: "/new",
      seed: (groups) => {
        first = groups.add(me, { name: "室友" });
        groups.add(me, { name: "台南" });
      },
    });

    expect(await screen.findByRole("heading", { name: "記在哪個群組？" })).toBeVisible();
    expect(screen.getByRole("link", { name: /室友/ })).toHaveAttribute(
      "href",
      `/groups/${first}/expenses/new`,
    );
    expect(screen.getByRole("link", { name: /台南/ })).toBeVisible();
  });

  it("goes straight to the form when there is one Group", async () => {
    let id = "";
    const { router } = renderApp({
      cookieUser: me,
      path: "/new",
      seed: (groups) => {
        id = groups.add(me, { name: "室友" });
      },
    });

    expect(await screen.findByRole("heading", { level: 1, name: "新增支出" })).toBeVisible();
    expect(router.state.location.pathname).toBe(`/groups/${id}/expenses/new`);
  });

  it("asks for a Group first when there is none", async () => {
    renderApp({ cookieUser: me, path: "/new" });

    expect(await screen.findByText("先建立一個群組，才能記帳。")).toBeVisible();
    expect(screen.getByRole("link", { name: "建立新群組" })).toHaveAttribute("href", "/groups/new");
  });
});
