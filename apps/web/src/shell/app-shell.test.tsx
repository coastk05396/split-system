import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell.js";

function setVibrate(fn: (pattern: VibratePattern) => boolean): void {
  Object.defineProperty(navigator, "vibrate", { value: fn, configurable: true, writable: true });
}

describe("AppShell BottomBar", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "vibrate");
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
      "active:scale-[0.92]",
      "active:-rotate-2",
      "active:shadow-[0_0_0_8px_rgba(46,157,113,0.25)]",
      "duration-200",
      "ease-(--ease-spring)",
    );
  });
});
