import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell.js";

function setVibrate(fn: (pattern: VibratePattern) => boolean): void {
  Object.defineProperty(navigator, "vibrate", { value: fn, configurable: true, writable: true });
}

describe("AppShell navigation", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "vibrate");
    vi.useRealTimers();
  });

  it("triggers 15ms haptic vibration and applies jelly spring with mint halo styling on the + Add button", () => {
    const vibrateMock = vi.fn().mockReturnValue(true);
    setVibrate(vibrateMock);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppShell>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>,
    );

    const bottomNav = screen.getByRole("navigation", { name: "底部導覽" });
    const newLink = within(bottomNav).getByRole("link", { name: /新增/ });
    expect(newLink).toHaveAttribute("href", "/new");

    fireEvent.pointerDown(newLink);
    expect(vibrateMock).toHaveBeenCalledWith(15);

    const floatingButton = newLink.querySelector("span");
    expect(floatingButton).toHaveClass(
      "active:scale-[0.85]",
      "active:-rotate-3",
      "active:shadow-[0_0_0_8px_rgba(46,157,113,0.25)]",
      "duration-300",
      "ease-(--ease-spring)",
    );
  });

  it("links to 機票 (/flights) in both bottom navigation and sidebar with no maintenance toast", () => {
    render(
      <MemoryRouter initialEntries={["/flights"]}>
        <AppShell>
          <div>Flights Content</div>
        </AppShell>
      </MemoryRouter>,
    );

    const bottomNav = screen.getByRole("navigation", { name: "底部導覽" });
    const bottomFlightLink = within(bottomNav).getByRole("link", { name: "機票" });
    expect(bottomFlightLink).toHaveAttribute("href", "/flights");
    expect(bottomFlightLink).toHaveAttribute("aria-current", "page");

    const sidebar = screen.getByRole("navigation", { name: "側邊導覽" });
    const sideFlightLink = within(sidebar).getByRole("link", { name: "機票" });
    expect(sideFlightLink).toHaveAttribute("href", "/flights");
    expect(sideFlightLink).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
