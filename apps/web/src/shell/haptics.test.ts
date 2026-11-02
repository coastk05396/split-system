import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hapticTick } from "./haptics.js";

describe("hapticTick", () => {
  const originalVibrate = navigator.vibrate;

  beforeEach(() => {
    // Reset mock before each test
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalVibrate !== undefined) {
      navigator.vibrate = originalVibrate;
    } else {
      // @ts-expect-error - clean up mock
      delete navigator.vibrate;
    }
  });

  it("calls navigator.vibrate with the specified milliseconds (default 15ms)", () => {
    const vibrateMock = vi.fn().mockReturnValue(true);
    navigator.vibrate = vibrateMock;

    const result = hapticTick(15);
    expect(vibrateMock).toHaveBeenCalledWith(15);
    expect(result).toBe(true);

    hapticTick();
    expect(vibrateMock).toHaveBeenCalledWith(15);
  });

  it("safely returns false when navigator.vibrate is undefined", () => {
    // @ts-expect-error - test environment without vibrate
    delete navigator.vibrate;

    expect(() => hapticTick(15)).not.toThrow();
    expect(hapticTick(15)).toBe(false);
  });

  it("safely handles exceptions thrown by navigator.vibrate without throwing", () => {
    navigator.vibrate = vi.fn().mockImplementation(() => {
      throw new Error("SecurityError: vibrate blocked by policy");
    });

    expect(() => hapticTick(15)).not.toThrow();
    expect(hapticTick(15)).toBe(false);
  });
});
