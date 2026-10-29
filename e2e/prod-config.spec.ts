import { expect, test } from "@playwright/test";

test.describe("Production configuration safeguards (SPEC §7.3)", () => {
  test("answers 404 on test-sign-in endpoint in the production environment", async ({
    request,
  }) => {
    // Port 8788 runs the production configuration where TEST_SIGN_IN is not enabled
    const res = await request.post("http://[::1]:8788/api/v1/auth/test-sign-in", {
      data: {
        provider: "google",
        sub: "prod-attacker-sub",
        displayName: "駭客",
      },
    });

    expect(res.status()).toBe(404);
    const body = (await res.json()) as unknown;
    expect(body).toEqual({ error: { code: "NOT_FOUND" } });
  });
});
