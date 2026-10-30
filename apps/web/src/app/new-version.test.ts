import { beforeEach, describe, expect, it, vi } from "vitest";
import { isStaleFileError, reloadedRecently, reloadForNewVersion } from "./new-version.js";

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("isStaleFileError", () => {
  it("recognises the message each browser gives for a removed file", () => {
    for (const message of [
      "Failed to fetch dynamically imported module: https://x/assets/Page-abc.js",
      "error loading dynamically imported module",
      "Importing a module script failed.",
    ]) {
      expect(isStaleFileError(new TypeError(message))).toBe(true);
    }
  });

  it("leaves other errors alone", () => {
    expect(isStaleFileError(new Error("Network request failed"))).toBe(false);
    expect(isStaleFileError("Failed to fetch dynamically imported module")).toBe(false);
  });
});

describe("reloadForNewVersion", () => {
  it("reloads once, then refuses for a while so it can never loop", () => {
    const reload = vi.fn();

    expect(reloadForNewVersion(1_000_000, reload)).toBe(true);
    expect(reloadForNewVersion(1_005_000, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadedRecently(1_005_000)).toBe(true);

    expect(reloadForNewVersion(1_011_000, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("does not reload when it cannot remember having done so", () => {
    const reload = vi.fn();
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(reloadForNewVersion(1_000_000, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
