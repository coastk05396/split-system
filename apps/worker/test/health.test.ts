import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("GET /api/v1/health", () => {
  it("answers 200 with ok status", async () => {
    const res = await exports.default.fetch("https://split.test/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
