import { describe, expect, it } from "vitest";
import { bearer, call, json, signIn, uniqueSub } from "./auth-harness.js";

function link(provider: string, accessToken: string, sub: string) {
  return call(`/auth/link/${provider}`, json({ idToken: `fake|${sub}|小宇` }, bearer(accessToken)));
}

function unlink(provider: string, accessToken: string) {
  return call(`/auth/identities/${provider}`, { method: "DELETE", headers: bearer(accessToken) });
}

describe("POST /auth/link/:provider", () => {
  it("adds a second Identity, after which either one signs into the same User", async () => {
    const lineSub = uniqueSub("line");
    const session = await signIn("google", uniqueSub("google"));
    const res = await link("line", session.accessToken, lineSub);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      identities: [{ provider: "google" }, { provider: "line" }],
    });
    expect((await signIn("line", lineSub)).userId).toBe(session.userId);
  });

  it("refuses an Identity that already belongs to another User", async () => {
    const lineSub = uniqueSub("taken");
    await signIn("line", lineSub);
    const other = await signIn("google", uniqueSub("other"));
    const res = await link("line", other.accessToken, lineSub);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "IDENTITY_LINKED_ELSEWHERE" } });
  });

  it("refuses a second Identity of a provider the User already has", async () => {
    const session = await signIn("google", uniqueSub("g1"));
    const res = await link("google", session.accessToken, uniqueSub("g2"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "PROVIDER_ALREADY_LINKED" } });
  });

  it("requires a signed-in User", async () => {
    expect((await call("/auth/link/line", json({ idToken: "fake|x|y" }))).status).toBe(401);
  });
});

describe("DELETE /auth/identities/:provider", () => {
  it("refuses to unlink the last Identity", async () => {
    const session = await signIn("line", uniqueSub("only"));
    const res = await unlink("line", session.accessToken);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "LAST_IDENTITY" } });
  });

  it("unlinks one of two Identities, which then no longer signs in to this User", async () => {
    const lineSub = uniqueSub("drop");
    const session = await signIn("google", uniqueSub("keep"));
    await link("line", session.accessToken, lineSub);

    const res = await unlink("line", session.accessToken);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ identities: [{ provider: "google" }] });
    expect((await signIn("line", lineSub)).userId).not.toBe(session.userId);
  });

  it("answers 404 for a provider the User has not linked", async () => {
    const session = await signIn("google", uniqueSub("none"));
    expect((await unlink("line", session.accessToken)).status).toBe(404);
  });
});
