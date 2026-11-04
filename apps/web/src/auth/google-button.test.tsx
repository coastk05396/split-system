import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "../../test/render-app.js";

describe("Google button's own feedback", () => {
  // Google's button is an iframe over ours: its tap never reaches the page, but the window loses
  // focus to the iframe, which is the only sign that the account chooser is opening.
  it("shows it is waiting once the tap moves focus to Google, and stops when focus returns", async () => {
    renderApp({ path: "/sign-in" });
    const real = await screen.findByRole("button", { name: "使用 Google 帳號登入" });
    const wrapper = real.closest("[data-google-button]");
    expect(wrapper).not.toHaveAttribute("aria-busy", "true");

    act(() => {
      real.focus();
    });
    fireEvent.blur(window);
    expect(wrapper).toHaveAttribute("aria-busy", "true");

    fireEvent.focus(window);
    expect(wrapper).not.toHaveAttribute("aria-busy", "true");
  });

  it("ignores a blur that did not come from tapping Google's button", async () => {
    renderApp({ path: "/sign-in" });
    const real = await screen.findByRole("button", { name: "使用 Google 帳號登入" });

    fireEvent.blur(window);

    expect(real.closest("[data-google-button]")).not.toHaveAttribute("aria-busy", "true");
  });
});
