import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { newApi } from "../src/api.js";
import { assertIfMatch, requireIdempotencyKey, requireIfMatch } from "../src/request-guards.js";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("requireIdempotencyKey", () => {
  const api = newApi().post("/things", (c) => c.json({ key: requireIdempotencyKey(c) }));
  const post = (headers: Record<string, string>) =>
    api.request("/api/v1/things", { method: "POST", headers }, env);

  it("returns the Idempotency-Key header", async () => {
    const res = await post({ "Idempotency-Key": "0192f3a4-7b1c-7000-8000-000000000001" });
    expect(await res.json()).toEqual({ key: "0192f3a4-7b1c-7000-8000-000000000001" });
  });

  it.each([
    ["missing", {}],
    ["empty", { "Idempotency-Key": "" }],
    ["too long", { "Idempotency-Key": "k".repeat(129) }],
    ["with spaces", { "Idempotency-Key": "a b" }],
  ])("rejects a %s key with 400 IDEMPOTENCY_KEY_REQUIRED", async (_label, headers) => {
    const res = await post(headers);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "IDEMPOTENCY_KEY_REQUIRED" } });
  });
});

describe("If-Match", () => {
  const current = { id: "e1", updatedAt: 1_750_000_000_000 };
  const api = newApi().patch("/things/:id", (c) => {
    assertIfMatch(requireIfMatch(c), current);
    return c.json({ saved: true });
  });
  const patch = (headers: Record<string, string>) =>
    api.request("/api/v1/things/e1", { method: "PATCH", headers }, env);

  it("lets the edit through when If-Match equals the row's updated_at", async () => {
    const res = await patch({ "If-Match": "1750000000000" });
    expect(res.status).toBe(200);
  });

  it("answers 409 EDIT_CONFLICT with the current row when someone changed it first", async () => {
    const res = await patch({ "If-Match": "1749999999999" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "EDIT_CONFLICT", details: { current } } });
  });

  it.each([
    ["missing", {}],
    ["not a number", { "If-Match": "abc" }],
    ["quoted", { "If-Match": '"1750000000000"' }],
  ])("rejects a %s If-Match with 400 IF_MATCH_REQUIRED", async (_label, headers) => {
    const res = await patch(headers);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "IF_MATCH_REQUIRED" } });
  });
});
