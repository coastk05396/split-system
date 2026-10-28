import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, newApi } from "../src/api.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("error shape", () => {
  it("answers an unknown API route with 404 NOT_FOUND", async () => {
    const res = await exports.default.fetch("https://split.test/api/v1/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND" } });
  });

  it("sends a thrown ApiError as its status, code and details", async () => {
    const api = newApi().get("/groups/:id", () => {
      throw new ApiError("GROUP_FULL", { limit: 30 });
    });
    const res = await api.request("/api/v1/groups/g1", {}, env);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "GROUP_FULL", details: { limit: 30 } } });
  });

  it("hides an unexpected exception behind 500 INTERNAL", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const api = newApi().get("/boom", () => {
      throw new Error("secret detail");
    });
    const res = await api.request("/api/v1/boom", {}, env);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "INTERNAL" } });
  });
});

describe("request logging", () => {
  it("tags each response with a request ID and logs the route pattern, never the real path", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const api = newApi().get("/invites/:token", () => {
      throw new ApiError("INVITE_EXPIRED");
    });
    const res = await api.request("/api/v1/invites/secret-token-123", {}, env);

    const requestId = res.headers.get("x-request-id");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).not.toContain("secret-token-123");
    expect(JSON.parse(line)).toMatchObject({
      requestId,
      method: "GET",
      route: "/api/v1/invites/:token",
      status: 422,
      errorCode: "INVITE_EXPIRED",
    });
  });
});
