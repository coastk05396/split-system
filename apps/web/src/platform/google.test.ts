import { afterEach, describe, expect, it } from "vitest";
import { createGoogleSignIn } from "./google.js";

function jwt(payload: object): string {
  const part = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, "");
  return `${part({ alg: "none" })}.${part(payload)}.sig`;
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
});

describe("Google's redirect callback", () => {
  const google = createGoogleSignIn("client-id");

  it("hands back the ID token whose nonce is the one we sent", () => {
    sessionStorage.setItem("split.googleNonce", "n-1");
    const token = jwt({ nonce: "n-1" });
    window.history.replaceState(null, "", `/link#id_token=${token}&state=code-1`);

    expect(google.takeRedirectResult()).toEqual({ idToken: token, state: "code-1" });
    // Token out of the address; the code back in it, so a reload or the button still has it.
    expect(window.location.href).toBe(`${window.location.origin}/link?code=code-1`);
  });

  it("keeps the code but drops a malformed token instead of throwing", () => {
    sessionStorage.setItem("split.googleNonce", "n-1");
    window.history.replaceState(null, "", "/link#id_token=invalid&state=code-1");

    expect(google.takeRedirectResult()).toEqual({ idToken: null, state: "code-1" });
  });

  it("keeps the code but drops a token with another nonce", () => {
    sessionStorage.setItem("split.googleNonce", "n-1");
    window.history.replaceState(null, "", `/link#id_token=${jwt({ nonce: "other" })}&state=code-1`);

    expect(google.takeRedirectResult()).toEqual({ idToken: null, state: "code-1" });
  });

  it("keeps the code when Google refused", () => {
    window.history.replaceState(null, "", "/link#error=access_denied&state=code-1");

    expect(google.takeRedirectResult()).toEqual({ idToken: null, state: "code-1" });
  });

  it("is null when the address carries no callback", () => {
    window.history.replaceState(null, "", "/link?code=code-1");

    expect(google.takeRedirectResult()).toBeNull();
  });
});
