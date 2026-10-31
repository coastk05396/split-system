import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/app.js";

describe("maintenance gate", () => {
  it("refuses API writes while allowing reads and authorised bypasses", async () => {
    const bindings = { ...env, MAINTENANCE: "test-gate-value" };
    for (const method of ["POST", "PATCH", "DELETE"]) {
      const res = await app.request("/api/v1/unknown", { method }, bindings);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: { code: "MAINTENANCE" } });
      const wrong = await app.request(
        "/api/v1/unknown",
        { method, headers: { "X-Maintenance-Bypass": "wrong" } },
        bindings,
      );
      expect(wrong.status).toBe(503);
      const bypass = await app.request(
        "/api/v1/unknown",
        { method, headers: { "X-Maintenance-Bypass": "test-gate-value" } },
        bindings,
      );
      expect(bypass.status).toBe(404);
    }
    expect((await app.request("/api/v1", { method: "POST" }, bindings)).status).toBe(503);
    expect((await app.request("/api/v1/health", {}, bindings)).status).toBe(200);
    expect((await app.request("/api/v1/health", { method: "HEAD" }, bindings)).status).toBe(200);
    expect((await app.request("/api/v1/health", { method: "POST" }, bindings)).status).toBe(404);
    expect((await app.request("/api/v1/unknown", { method: "POST" }, env)).status).toBe(404);
  });
});
