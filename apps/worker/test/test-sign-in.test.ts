import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { bearer, call, json, uniqueSub } from "./auth-harness.js";

const body = (sub: string) => ({ provider: "line", sub, displayName: "測試用戶" });

describe("POST /auth/test-sign-in", () => {
  it("answers 404 in the deployed configuration, where the flag is not set", async () => {
    // The real Worker entry with wrangler.jsonc's vars: no TEST_SIGN_IN there.
    const res = await exports.default.fetch("https://split.test/api/v1/auth/test-sign-in", {
      ...json(body(uniqueSub("prod"))),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND" } });
  });

  it.each([undefined, "0", "true", ""])("answers 404 when the flag is %j", async (flag) => {
    const res = await call("/auth/test-sign-in", json(body(uniqueSub("off"))), {
      TEST_SIGN_IN: flag,
    });
    expect(res.status).toBe(404);
  });

  it("signs in without a provider token when the flag is 1", async () => {
    const res = await call("/auth/test-sign-in", json(body(uniqueSub("on"))), {
      TEST_SIGN_IN: "1",
    });
    expect(res.status).toBe(200);
    const { accessToken } = await res.json<{ accessToken: string }>();
    const me = await call("/me", { headers: bearer(accessToken) });
    expect(await me.json()).toMatchObject({
      displayName: "測試用戶",
      identities: [{ provider: "line" }],
    });
  });
});
