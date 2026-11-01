import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShareBar, ShareRing } from "../expenses/ShareRing.js";
import { CountUp } from "./CountUp.js";
import { Odometer } from "./Odometer.js";
import { SelectionPill } from "./SelectionPill.js";

const original = window.matchMedia.bind(window);

/** Runs as a user who has not asked for reduced motion. */
function allowMotion() {
  // Any query that is not the reduced-motion one comes back as "no", which is what is wanted.
  window.matchMedia = () => original("(min-width: 0px)");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
});
afterEach(() => {
  vi.useRealTimers();
  window.matchMedia = original;
});

describe("CountUp", () => {
  const money = (n: number) => `NT$ ${String(n)}`;

  it("never displays any intermediate value when amount changes", () => {
    allowMotion();
    const { rerender } = render(<CountUp value={1000} format={money} />);
    expect(screen.getByText("NT$ 1000")).toBeVisible();

    rerender(<CountUp value={500} format={money} />);

    // Mid-flight fade-out: still the old value
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(screen.getByText("NT$ 1000")).toBeVisible();

    // Mid-flight slide-in: new value, never intermediate
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByText("NT$ 500")).toBeVisible();

    // After animation finishes
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.getByText("NT$ 500")).toBeVisible();
  });

  it("still runs under StrictMode without flashing intermediate numbers", () => {
    allowMotion();
    render(
      <StrictMode>
        <CountUp value={3000} format={money} />
      </StrictMode>,
    );

    expect(screen.getByText("NT$ 3000")).toBeVisible();
  });

  it("swaps at once when amount changes for a user who asked for reduced motion", () => {
    const { rerender } = render(<CountUp value={1000} format={money} />);
    expect(screen.getByText("NT$ 1000")).toBeVisible();

    rerender(<CountUp value={500} format={money} />);
    expect(screen.getByText("NT$ 500")).toBeVisible();
  });

  it("shows the updating state and becomes solid only after confirmation", () => {
    const { rerender } = render(<CountUp value={500} format={money} updating={true} />);
    const el = screen.getByText("NT$ 500");
    expect(el.dataset.updating).toBe("true");

    rerender(<CountUp value={500} format={money} updating={false} />);
    expect(el.dataset.updating).toBeUndefined();
  });
});

describe("SelectionPill", () => {
  it("slides in from where the previous pill was, and not at all under reduced motion", () => {
    const animate = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
    const box = (left: number) =>
      ({ left, top: 0, width: 56, height: 36, right: left + 56, bottom: 36 }) as DOMRect;
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");

    allowMotion();
    spy.mockReturnValue(box(0));
    const first = render(<SelectionPill layoutId="t1" className="x" />);
    first.unmount();
    spy.mockReturnValue(box(120));
    render(<SelectionPill layoutId="t1" className="x" />);

    expect(animate).toHaveBeenCalledTimes(1);
    const [frames] = animate.mock.calls[0] as [{ transform: string }[]];
    expect(frames[0]?.transform).toContain("translate(-120px");

    window.matchMedia = original;
    animate.mockClear();
    spy.mockReturnValue(box(240));
    render(<SelectionPill layoutId="t1" className="x" />);
    expect(animate).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("CountUp tint", () => {
  const money = (n: number) => `NT$ ${String(n)}`;
  const tint = () => screen.getByText(/NT\$/).dataset.count;

  it("is green while it transitions to good news and gone when it stops", () => {
    allowMotion();
    const { rerender } = render(<CountUp value={1000} format={money} />);
    rerender(<CountUp value={3000} format={money} />);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(tint()).toBe("good");

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(tint()).toBeUndefined();
  });

  it("is red when more is bad news, as a growing debt is", () => {
    allowMotion();
    const { rerender } = render(<CountUp value={1000} format={money} goodWhen="down" />);
    rerender(<CountUp value={3000} format={money} goodWhen="down" />);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(tint()).toBe("bad");
  });

  it("uses the light tints on a dark card", () => {
    render(<CountUp value={3000} format={money} onDark />);

    expect(screen.getByText(/NT\$/)).toHaveClass("count-dark");
  });
});

describe("Odometer", () => {
  it("rolls only the characters that changed, and not on the first draw", () => {
    const { rerender } = render(<Odometer text="= NT$ 120" />);
    expect(document.querySelectorAll(".digit-roll")).toHaveLength(0);

    rerender(<Odometer text="= NT$ 180" />);
    const rolled = [...document.querySelectorAll(".digit-roll")].map((n) => n.textContent);
    expect(rolled).toEqual(["8"]);
    expect(screen.getByLabelText("= NT$ 180")).toBeInTheDocument();
  });
});

describe("ShareRing", () => {
  it("draws one arc per person, sized by their share, and nothing without an amount", () => {
    const { container, rerender } = render(<ShareRing shares={[300, 100]} />);
    const arcs = [...container.querySelectorAll("circle")].slice(1);
    const length = (c: Element) => Number(c.getAttribute("stroke-dasharray")?.split(" ")[0]);
    expect(arcs).toHaveLength(2);
    expect(length(arcs[0] as Element) / length(arcs[1] as Element)).toBeCloseTo(3, 5);

    rerender(<ShareRing shares={[0, 0]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("draws a proportional ShareBar segment for each positive share", () => {
    const { container, rerender } = render(<ShareBar shares={[300, 100, 0]} />);
    const segments = [...container.querySelectorAll("span")];
    expect(segments).toHaveLength(2);
    expect((segments[0] as HTMLElement).style.flexGrow).toBe("300");
    expect((segments[1] as HTMLElement).style.flexGrow).toBe("100");

    rerender(<ShareBar shares={[0, 0]} />);
    expect(container.firstChild).toBeNull();
  });
});
