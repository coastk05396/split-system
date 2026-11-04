import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

const SWITCH = "POST /api/v1/auth/switch-to-line";

/** A User who signed in with Google and has LINE linked as well (or not). */
function googleUser(withLine: boolean) {
  const user = makeUser("小宇", "google");
  return withLine
    ? { ...user, identities: [...user.identities, { provider: "line" as const, email: null }] }
    : user;
}

describe("a Google session inside LINE", () => {
  it("is switched to LINE, with a notice that must be acknowledged", async () => {
    const user = userEvent.setup();
    const { api } = renderApp({
      cookieUser: googleUser(true),
      insideLine: { idToken: "fake|line-1|小宇" },
    });

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("已改用 LINE 登入");
    expect(api.calls).toContain(SWITCH);

    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "知道了" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(await screen.findByRole("heading", { name: /小宇/ })).toBeVisible();
  });

  it("stays signed in with a notice when LINE is not linked to this User", async () => {
    const user = userEvent.setup();
    const { api } = renderApp({
      cookieUser: googleUser(false),
      insideLine: { idToken: "fake|line-1|小宇" },
    });

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("還沒連結 LINE");
    expect(api.calls).toContain(SWITCH);

    await user.click(screen.getByRole("button", { name: "知道了" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(await screen.findByRole("heading", { name: /小宇/ })).toBeVisible();
  });

  it("is left alone outside LINE", async () => {
    const { api } = renderApp({ cookieUser: googleUser(true) });

    expect(await screen.findByRole("heading", { name: /小宇/ })).toBeVisible();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.calls).not.toContain(SWITCH);
  });

  it("does not bother a LINE session inside LINE", async () => {
    const { api } = renderApp({
      cookieUser: makeUser("阿芽", "line"),
      insideLine: { idToken: "fake|line-1|阿芽" },
    });

    expect(await screen.findByRole("heading", { name: /阿芽/ })).toBeVisible();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.calls).not.toContain(SWITCH);
  });
});
