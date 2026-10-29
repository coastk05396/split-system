import { describe, expect, it } from "vitest";
import { bearer, call, json, signIn, uniqueSub } from "./auth-harness.js";

describe("PATCH /me language", () => {
  it("saves the interface language with the account", async () => {
    const yu = await signIn("google", uniqueSub("lg"), "小宇");
    const res = await call("/me", {
      ...json({ language: "en" }, bearer(yu.accessToken)),
      method: "PATCH",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ language: "en", preferredCurrency: "TWD" });

    const me = await call("/me", { headers: bearer(yu.accessToken) });
    expect(await me.json()).toMatchObject({ language: "en" });
  });

  it("refuses a language the app does not have, and an empty change", async () => {
    const yu = await signIn("google", uniqueSub("lg"), "小宇");
    for (const body of [{ language: "ja" }, {}]) {
      const res = await call("/me", { ...json(body, bearer(yu.accessToken)), method: "PATCH" });
      expect(res.status).toBe(400);
    }
  });
});

describe("PATCH /me", () => {
  it("saves the Preferred currency and answers with the updated User", async () => {
    const yu = await signIn("google", uniqueSub("pc"), "小宇");
    const res = await call("/me", {
      ...json({ preferredCurrency: "USD" }, bearer(yu.accessToken)),
      method: "PATCH",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ preferredCurrency: "USD" });

    const me = await call("/me", { headers: bearer(yu.accessToken) });
    expect(await me.json()).toMatchObject({ preferredCurrency: "USD" });
  });

  it("takes every shipped currency", async () => {
    const yu = await signIn("google", uniqueSub("pc"), "小宇");
    for (const preferredCurrency of ["JPY", "THB"]) {
      const res = await call("/me", {
        ...json({ preferredCurrency }, bearer(yu.accessToken)),
        method: "PATCH",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ preferredCurrency });
    }
  });

  it("refuses a currency the app does not ship", async () => {
    const yu = await signIn("google", uniqueSub("pc"), "小宇");
    const res = await call("/me", {
      ...json({ preferredCurrency: "GBP" }, bearer(yu.accessToken)),
      method: "PATCH",
    });
    expect(res.status).toBe(400);
  });

  it("needs a signed-in User", async () => {
    const res = await call("/me", { ...json({ preferredCurrency: "USD" }), method: "PATCH" });
    expect(res.status).toBe(401);
  });
});
