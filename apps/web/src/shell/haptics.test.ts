import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hapticTick } from "./haptics.js";

function setVibrate(fn: (pattern: VibratePattern) => boolean): void {
  Object.defineProperty(navigator, "vibrate", { value: fn, configurable: true, writable: true });
}

describe("hapticTick", () => {
  beforeEach(() => {
    // Reset mock before each test
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "vibrate");
  });

  it("calls navigator.vibrate with the specified milliseconds (default 15ms)", () => {
    const vibrateMock = vi.fn().mockReturnValue(true);
    setVibrate(vibrateMock);

    const result = hapticTick(15);
    expect(vibrateMock).toHaveBeenCalledWith(15);
    expect(result).toBe(true);

    hapticTick();
    expect(vibrateMock).toHaveBeenCalledWith(15);
  });

  it("safely returns false when navigator.vibrate is undefined", () => {
    Reflect.deleteProperty(navigator, "vibrate");

    expect(() => hapticTick(15)).not.toThrow();
    expect(hapticTick(15)).toBe(false);
  });

  it("safely handles exceptions thrown by navigator.vibrate without throwing", () => {
    setVibrate(
      vi.fn().mockImplementation(() => {
        throw new Error("SecurityError: vibrate blocked by policy");
      }),
    );

    expect(() => hapticTick(15)).not.toThrow();
    expect(hapticTick(15)).toBe(false);
  });
});
