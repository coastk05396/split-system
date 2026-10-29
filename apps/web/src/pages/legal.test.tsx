import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { renderApp } from "../../test/render-app.js";

describe("policy pages (decisions 26, 29)", () => {
  it("shows the privacy policy to a signed-out visitor, with contact and deadlines", async () => {
    renderApp({ path: "/privacy" });

    expect(await screen.findByRole("heading", { level: 1, name: "隱私權政策" })).toBeVisible();
    expect(screen.getByText(/版本 1\.0/)).toBeVisible();
    expect(screen.getAllByRole("link", { name: "privacy@rickchen.si" })[0]).toHaveAttribute(
      "href",
      "mailto:privacy@rickchen.si",
    );
    expect(screen.getByText(/15 天內/)).toBeVisible();
    expect(screen.getByText(/30 天內/)).toBeVisible();
    expect(screen.getByText(/Cloudflare/)).toBeVisible();
  });

  it("shows the terms with the age rule and that no money is moved", async () => {
    renderApp({ path: "/terms" });

    expect(await screen.findByRole("heading", { level: 1, name: "服務條款" })).toBeVisible();
    expect(screen.getByText(/18 歲/)).toBeVisible();
    expect(screen.getByText(/不經手、不保管任何款項/)).toBeVisible();
  });

  it("opens from the sign-in footer", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/sign-in" });

    await user.click(await screen.findByRole("link", { name: "服務條款" }));

    expect(await screen.findByRole("heading", { level: 1, name: "服務條款" })).toBeVisible();
  });

  it("stays readable when signed in", async () => {
    renderApp({ path: "/privacy", cookieUser: makeUser("小宇") });

    expect(await screen.findByRole("heading", { level: 1, name: "隱私權政策" })).toBeVisible();
  });
});
