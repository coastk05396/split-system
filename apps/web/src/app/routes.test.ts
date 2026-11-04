import { describe, expect, it } from "vitest";
import { safeNext } from "./routes.js";

describe("safeNext", () => {
  it.each([String.raw`/\evil.com`, "//evil.com", "https://evil.com", null])(
    "rejects an external sign-in return path %s",
    (next) => {
      expect(safeNext(next)).toBe("/");
    },
  );
  it("accepts a same-origin group path", () => {
    expect(safeNext("/groups/1")).toBe("/groups/1");
  });
});
