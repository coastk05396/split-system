import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Progress } from "./ui.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("Progress", () => {
  it("offers a way out only after a long wait, and says the outcome is unknown", () => {
    const onLeave = vi.fn();
    render(<Progress message="建立群組中…" onLeave={onLeave} />);

    advance(19_000);
    expect(screen.queryByRole("button")).toBeNull();

    advance(1_000);
    expect(screen.getByText(/還在處理/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "先離開" }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("counts the wait from when the screen appeared, however often its owner redraws", () => {
    const { rerender } = render(<Progress message="建立群組中…" onLeave={() => {}} />);

    advance(19_000);
    rerender(<Progress message="建立群組中…" onLeave={() => {}} />);
    advance(1_000);

    expect(screen.getByRole("button", { name: "先離開" })).toBeVisible();
  });

  it("never offers it where leaving is not possible", () => {
    render(<Progress message="建立群組中…" />);
    advance(60_000);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
