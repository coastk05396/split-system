import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as newVersion from "./new-version.js";
import { RouteError } from "./RouteError.js";

function renderFailingRoute(error: Error) {
  const router = createMemoryRouter([
    { path: "/", lazy: () => Promise.reject(error), ErrorBoundary: RouteError },
  ]);
  render(<RouterProvider router={router} />);
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("RouteError", () => {
  it("reloads at once for a file a deploy removed, showing the splash meanwhile", async () => {
    const reload = vi.spyOn(newVersion, "reloadForNewVersion").mockReturnValue(true);

    renderFailingRoute(new TypeError("Failed to fetch dynamically imported module: x.js"));

    expect(await screen.findByRole("status")).toBeVisible();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("explains the new version, with a button, when a reload just happened", async () => {
    window.sessionStorage.setItem("split.reloadedForNewVersion", String(Date.now()));
    const reload = vi.spyOn(newVersion, "reloadForNewVersion");

    renderFailingRoute(new TypeError("Failed to fetch dynamically imported module: x.js"));

    expect(await screen.findByRole("heading", { name: "小芽分帳有新版本了" })).toBeVisible();
    expect(screen.getByRole("button", { name: "重新整理" })).toBeVisible();
    expect(reload).not.toHaveBeenCalled();
  });

  it("says something went wrong, with a button, for any other error", async () => {
    renderFailingRoute(new Error("boom"));

    expect(await screen.findByRole("heading", { name: "出了點問題" })).toBeVisible();
    expect(screen.getByRole("button", { name: "重新整理" })).toBeVisible();
  });
});
