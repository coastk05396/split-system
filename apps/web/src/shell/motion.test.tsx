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

  it("counts up from 0 to the value and ends exactly on it", () => {
    allowMotion();
    render(<CountUp value={3000} format={money} />);

    // Mid-flight it is somewhere between, never past the target.
    act(() => {
      vi.advanceTimersByTime(120);
    });
    const middle = Number(/\d+/.exec(screen.getByText(/NT\$/).textContent)?.[0]);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(3000);

    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(screen.getByText("NT$ 3000")).toBeVisible();
  });

  it("still runs under StrictMode, which tries every effect twice in development", () => {
    allowMotion();
    render(
      <StrictMode>
        <CountUp value={3000} format={money} />
      </StrictMode>,
    );

    act(() => {
      vi.advanceTimersByTime(120);
    });
    const middle = Number(/\d+/.exec(screen.getByText(/NT\$/).textContent)?.[0]);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(3000);

    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(screen.getByText("NT$ 3000")).toBeVisible();
  });

  it("starts from what it showed when the value changes", () => {
    allowMotion();
    const { rerender } = render(<CountUp value={1000} format={money} />);
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    rerender(<CountUp value={500} format={money} />);

    act(() => {
      vi.advanceTimersByTime(60);
    });
    const now = Number(/\d+/.exec(screen.getByText(/NT\$/).textContent)?.[0]);
    expect(now).toBeLessThan(1000);
    expect(now).toBeGreaterThanOrEqual(500);
  });

  it("shows the value at once for a user who asked for reduced motion", () => {
    render(<CountUp value={3000} format={money} />);

    expect(screen.getByText("NT$ 3000")).toBeVisible();
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

  it("is green while it counts to good news and gone when it stops", () => {
    allowMotion();
    render(<CountUp value={3000} format={money} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(tint()).toBe("good");

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(tint()).toBeUndefined();
  });

  it("is red when more is bad news, as a growing debt is", () => {
    allowMotion();
    render(<CountUp value={3000} format={money} goodWhen="down" />);
    act(() => {
      vi.advanceTimersByTime(100);
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
