import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell.js";

function setVibrate(fn: (pattern: VibratePattern) => boolean): void {
  Object.defineProperty(navigator, "vibrate", { value: fn, configurable: true, writable: true });
}

describe("AppShell BottomBar", () => {
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

    // Verify onPointerDown triggers haptic vibration
    fireEvent.pointerDown(newLink);
    expect(vibrateMock).toHaveBeenCalledWith(15);

    // Verify jelly spring and mint halo classes on the button element
    const floatingButton = newLink.querySelector("span");
    expect(floatingButton).toHaveClass(
      "active:scale-[0.85]",
      "active:-rotate-3",
      "active:shadow-[0_0_0_8px_rgba(46,157,113,0.25)]",
      "duration-300",
      "ease-(--ease-spring)",
    );
  });

  it("shows 旅遊 in bottom navigation and triggers coming soon toast when clicked", () => {
    vi.useFakeTimers();

    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppShell>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>,
    );

    const bottomNav = screen.getByRole("navigation", { name: "底部導覽" });
    const tripButton = within(bottomNav).getByRole("button", { name: /旅遊/ });
    expect(tripButton).toBeVisible();

    // Clicking it does not navigate, but opens the coming soon toast
    fireEvent.click(tripButton);

    const toast = screen.getByRole("status");
    expect(toast).toBeVisible();
    expect(toast).toHaveTextContent("旅遊功能即將推出，敬請期待！");

    // Fast-forward 2500ms: toast starts leaving
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(toast).toHaveClass("is-leaving");

    // Fast-forward 200ms: toast is removed from DOM
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows 旅遊 in sidebar and triggers coming soon toast when clicked", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppShell>
          <div>Content</div>
        </AppShell>
      </MemoryRouter>,
    );

    const sidebar = screen.getByRole("navigation", { name: "側邊導覽" });
    const tripButton = within(sidebar).getByRole("button", { name: /旅遊/ });
    expect(tripButton).toBeVisible();

    fireEvent.click(tripButton);
    expect(screen.getByRole("status")).toHaveTextContent("旅遊功能即將推出，敬請期待！");
  });
});
