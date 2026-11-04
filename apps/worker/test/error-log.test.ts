import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { errorLogLine } from "../src/api.js";

describe("errorLogLine", () => {
  it("never carries the bound values of a failed database query", () => {
    const error = new DrizzleQueryError(
      "update identities set email = ?",
      ["rick@example.com"],
      new Error("D1_ERROR: database is locked"),
    );
    const line = errorLogLine(error);
    expect(line).not.toContain("rick@example.com");
    expect(line).toContain("DrizzleQueryError");
    expect(line).toContain("database is locked");
  });

  it("keeps the stack of any other error", () => {
    expect(errorLogLine(new Error("boom"))).toContain("boom");
  });
});
