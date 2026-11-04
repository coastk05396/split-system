import { afterEach, describe, expect, it } from "vitest";
import { createGoogleSignIn, type GoogleErrand } from "./google.js";

function jwt(payload: object): string {
  const part = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, "");
  return `${part({ alg: "none" })}.${part(payload)}.sig`;
}

function arrive(token: string, errand: GoogleErrand | string) {
  const state = typeof errand === "string" ? errand : JSON.stringify(errand);
  const hash = new URLSearchParams({ id_token: token, state }).toString();
  window.history.replaceState(null, "", `/google-return#${hash}`);
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
});

describe("Google's redirect callback", () => {
  const google = createGoogleSignIn("client-id");
  const errand: GoogleErrand = { purpose: "linkCode", code: "code-1" };

  it("hands back the errand and the ID token whose nonce is the one we sent", () => {
    sessionStorage.setItem("split.googleNonce", "n-1");
    const token = jwt({ nonce: "n-1" });
    arrive(token, errand);

    expect(google.takeRedirectResult()).toEqual({ errand, idToken: token });
    expect(window.location.hash).toBe("");
  });

  it.each([
    ["a malformed token", "invalid", "n-1"],
    ["a token with another nonce", jwt({ nonce: "other" }), "n-1"],
    ["a token when no nonce was stored", jwt({ nonce: "n-1" }), null],
  ])("keeps the errand but drops %s", (_name, token, stored) => {
    if (stored !== null) sessionStorage.setItem("split.googleNonce", stored);
    arrive(token, errand);

    expect(google.takeRedirectResult()).toEqual({ errand, idToken: null });
  });

  it("keeps the errand when Google refused", () => {
    const state = JSON.stringify(errand);
    window.history.replaceState(null, "", `/google-return#error=access_denied&state=${state}`);

    expect(google.takeRedirectResult()).toEqual({ errand, idToken: null });
  });

  it.each([
    "not json",
    JSON.stringify({ purpose: "other" }),
    JSON.stringify({ purpose: "signIn" }),
  ])("is null when the state is not one of ours: %s", (state) => {
    arrive("x", state);

    expect(google.takeRedirectResult()).toBeNull();
  });

  it("is null when the address carries no callback", () => {
    expect(google.takeRedirectResult()).toBeNull();
  });
});
