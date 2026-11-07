import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpenseSavedToast } from "../expenses/ExpenseSavedToast.js";
import type { SavedShare } from "../expenses/expense-sharing.js";
import { AppShell } from "./AppShell.js";

const sampleSavedShare: SavedShare = {
  chat: "failed",
  card: {
    groupName: "Weekend Trip",
    title: "Dinner",
    emoji: "🍲",
    amount: "NT$ 1200",
    split: "3 people",
    payer: "Rick",
    each: null,
    url: "https://example.com",
    lineUrl: "https://example.com",
  },
};

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

  it("stacks trip notice dynamically above real ExpenseSavedToast based on actual height with zero overlap and independent timers", () => {
    vi.useFakeTimers();

    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppShell>
          <ExpenseSavedToast saved={sampleSavedShare} />
        </AppShell>
      </MemoryRouter>,
    );

    const expenseToast = screen.getByRole("status");
    expect(expenseToast).toBeVisible();

    // Mock real measured geometry: height = 76px, top = 628px on 800px viewport
    vi.spyOn(expenseToast, "getBoundingClientRect").mockReturnValue({
      top: 628,
      bottom: 704,
      left: 20,
      right: 300,
      width: 280,
      height: 76,
      x: 20,
      y: 628,
      toJSON: () => {},
    });

    const bottomNav = screen.getByRole("navigation", { name: "底部導覽" });
    const tripButton = within(bottomNav).getByRole("button", { name: /旅遊/ });

    fireEvent.click(tripButton);

    const tripNotice = screen.getByTestId("trip-notice");
    expect(tripNotice).toBeVisible();
    expect(tripNotice).toHaveClass("is-stacked");

    // Dynamic calculated bottom: (768 - 628) + 8 = 148px (jsdom default window.innerHeight = 768)
    const expectedBottom = `${window.innerHeight - 628 + 8}px`;
    expect(tripNotice).toHaveStyle({ bottom: expectedBottom });

    // Both notices coexist in the document
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(2);

    // Fast-forward 2500ms: trip notice starts leaving while expense toast is untouched
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(tripNotice).toHaveClass("is-leaving");
    expect(expenseToast).not.toHaveClass("is-leaving");

    // Fast-forward 200ms: trip notice is removed, expense toast remains
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByTestId("trip-notice")).toBeNull();
    expect(expenseToast).toBeVisible();

    // Fast-forward to 6000ms: expense toast now starts leaving independently
    act(() => {
      vi.advanceTimersByTime(3300);
    });
    expect(expenseToast).toHaveClass("is-leaving");
  });

  it("accounts for transient translateY transform during toast entrance and calculates settled top with 8px clearance", () => {
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      writable: true,
      configurable: true,
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppShell>
          <ExpenseSavedToast saved={sampleSavedShare} />
        </AppShell>
      </MemoryRouter>,
    );

    const expenseToast = screen.getByRole("status");
    expect(expenseToast).toBeVisible();

    // Simulate entrance animation: rect.top is at 620px due to translateY(12px)
    // Settled top should be 620 - 12 = 608px
    vi.spyOn(expenseToast, "getBoundingClientRect").mockReturnValue({
      top: 620,
      bottom: 716,
      left: 20,
      right: 300,
      width: 280,
      height: 96,
      x: 20,
      y: 620,
      toJSON: () => {},
    });

    const origGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((elt) => {
      const style = origGetComputedStyle(elt);
      if (elt === expenseToast) {
        return new Proxy(style, {
          get(target, prop, receiver) {
            if (prop === "bottom") return "96px";
            if (prop === "transform") return "matrix(1, 0, 0, 1, 0, 12)";
            return Reflect.get(target, prop, receiver) as unknown;
          },
        });
      }
      return style;
    });

    const bottomNav = screen.getByRole("navigation", { name: "底部導覽" });
    const tripButton = within(bottomNav).getByRole("button", { name: /旅遊/ });
    fireEvent.click(tripButton);

    const tripNotice = screen.getByTestId("trip-notice");
    expect(tripNotice).toBeVisible();
    expect(tripNotice).toHaveClass("is-stacked");

    // Settled dist from bottom: 800 - (620 - 12) = 192px.
    // With 8px clearance: 192 + 8 = 200px.
    expect(tripNotice).toHaveStyle({ bottom: "200px" });
  });

  it("dynamically detects later toast insertion via MutationObserver while trip notice is already visible", async () => {
    function Host() {
      const [showToast, setShowToast] = useState(false);
      return (
        <AppShell>
          <button
            type="button"
            onClick={() => {
              setShowToast(true);
            }}
          >
            Add Toast
          </button>
          {showToast && <ExpenseSavedToast saved={sampleSavedShare} />}
        </AppShell>
      );
    }

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Host />
      </MemoryRouter>,
    );

    const bottomNav = screen.getByRole("navigation", { name: "底部導覽" });
    const tripButton = within(bottomNav).getByRole("button", { name: /旅遊/ });

    // Step 1: Open trip notice FIRST when no expense toast exists
    fireEvent.click(tripButton);
    const tripNotice = screen.getByTestId("trip-notice");
    expect(tripNotice).toBeVisible();
    expect(tripNotice).not.toHaveClass("is-stacked");
    expect(tripNotice).toHaveClass("bottom-24");

    // Step 2: Later, an expense toast is added to the DOM while trip notice is still visible
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Add Toast" }));
    });
    expect(screen.getByRole("button", { name: "分享" })).toBeVisible();

    // Verify trip notice dynamically stacks above the newly added toast via MutationObserver
    await waitFor(() => {
      expect(tripNotice).toHaveClass("is-stacked");
    });

    // Step 3: Clicking trip button again re-triggers and maintains proper stacking
    fireEvent.click(tripButton);
    expect(tripNotice).toHaveClass("is-stacked");
  });
});
