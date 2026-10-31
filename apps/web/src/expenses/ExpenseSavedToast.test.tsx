import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExpenseSavedToast } from "./ExpenseSavedToast.js";
import type { SavedShare } from "./expense-sharing.js";

vi.mock("./ExpenseShareDialog.js", () => ({
  ExpenseShareDialog: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <button
        onClick={() => {
          onOpenChange(false);
        }}
      >
        Close dialog
      </button>
    ) : null,
}));

const saved: SavedShare = {
  chat: "none",
  card: {
    groupName: "Group",
    title: "Lunch",
    emoji: "🍽️",
    amount: "NT$ 100",
    split: "2 people",
    payer: "Payer",
    each: null,
    url: "https://example.com",
    lineUrl: "https://example.com",
  },
};

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("saved expense toast", () => {
  it("reverses an exit on hover, then dismisses after a fresh visible period", () => {
    render(<ExpenseSavedToast saved={saved} />);
    const toast = screen.getByRole("status");
    advance(6000);
    expect(toast).toHaveClass("is-leaving");
    advance(90);
    fireEvent.mouseEnter(toast);
    expect(toast).not.toHaveClass("is-leaving");
    advance(1000);
    expect(screen.getByRole("status")).toBeVisible();
    fireEvent.mouseLeave(toast);
    advance(5999);
    expect(toast).not.toHaveClass("is-leaving");
    advance(1);
    expect(toast).toHaveClass("is-leaving");
    advance(180);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps the toast while either focus or hover remains", () => {
    render(<ExpenseSavedToast saved={saved} />);
    const toast = screen.getByRole("status");
    const share = screen.getByRole("button");
    advance(6000);
    fireEvent.focus(share);
    fireEvent.mouseEnter(toast);
    fireEvent.mouseLeave(toast);
    advance(7000);
    expect(toast).not.toHaveClass("is-leaving");
    fireEvent.blur(share);
    advance(6000);
    advance(180);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps the toast while its share dialog is open, even if opened during exit", () => {
    render(<ExpenseSavedToast saved={saved} />);
    advance(6000);
    fireEvent.click(screen.getByRole("button"));
    advance(7000);
    expect(screen.getByRole("status")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    advance(6000);
    advance(180);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
