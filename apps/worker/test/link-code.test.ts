import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { bearer, call, clock, json, signIn, uniqueSub } from "./auth-harness.js";

async function issue(accessToken: string): Promise<string> {
  const res = await call("/auth/link-code", json({}, bearer(accessToken)));
  expect(res.status).toBe(200);
  return (await res.json<{ code: string }>()).code;
}

function redeem(code: string, sub: string, name = "小宇", email?: string) {
  const token = `fake|${sub}|${name}${email === undefined ? "" : `|${email}`}`;
  return call("/auth/link-code/redeem", json({ code, idToken: token }));
}

describe("link codes (Google linked from inside LINE)", () => {
  it("attaches the Google Identity to the code's User and signs that User in", async () => {
    const googleSub = uniqueSub("google");
    const line = await signIn("line", uniqueSub("line"));
    const res = await redeem(await issue(line.accessToken), googleSub);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      user: { id: line.userId, identities: [{ provider: "google" }, { provider: "line" }] },
    });
    expect(res.headers.get("Set-Cookie")).toContain("refresh=");
    expect((await signIn("google", googleSub)).userId).toBe(line.userId);
  });

  it("makes Google the latest sign-in: its name, picture and email now show on the profile", async () => {
    const googleSub = uniqueSub("google");
    const line = await signIn("line", uniqueSub("line"), "LINE名");
    const res = await redeem(await issue(line.accessToken), googleSub, "Google名", "g@example.com");
    expect(await res.json()).toMatchObject({
      user: {
        displayName: "Google名",
        pictureUrl: `https://pic/${googleSub}`,
        signedInWith: "google",
        identities: [{ provider: "google", email: "g@example.com" }, { provider: "line" }],
      },
    });
  });

  it("works only once", async () => {
    const line = await signIn("line", uniqueSub("line"));
    const code = await issue(line.accessToken);
    expect((await redeem(code, uniqueSub("g1"))).status).toBe(200);
    const again = await redeem(code, uniqueSub("g2"));
    expect(again.status).toBe(422);
    expect(await again.json()).toEqual({ error: { code: "LINK_CODE_INVALID" } });
  });

  it("expires after five minutes", async () => {
    const line = await signIn("line", uniqueSub("line"));
    const code = await issue(line.accessToken);
    clock.now += 5 * 60 * 1000 + 1;
    try {
      expect((await redeem(code, uniqueSub("g"))).status).toBe(422);
    } finally {
      clock.now -= 5 * 60 * 1000 + 1;
    }
  });

  it("is replaced by the next code the User asks for", async () => {
    const line = await signIn("line", uniqueSub("line"));
    const first = await issue(line.accessToken);
    const second = await issue(line.accessToken);
    expect((await redeem(first, uniqueSub("g"))).status).toBe(422);
    expect((await redeem(second, uniqueSub("g"))).status).toBe(200);
  });

  it("rejects an unknown code without creating a User", async () => {
    const sub = uniqueSub("stray");
    expect((await redeem("x".repeat(43), sub)).status).toBe(422);
    const created = await env.DB.prepare(
      "SELECT count(*) AS n FROM identities WHERE provider_sub = ?",
    )
      .bind(sub)
      .first<{ n: number }>();
    expect(created?.n).toBe(0);
  });

  it("refuses a Google account that already belongs to another User, and creates nothing", async () => {
    const taken = uniqueSub("taken");
    await signIn("google", taken);
    const line = await signIn("line", uniqueSub("line"));
    const res = await redeem(await issue(line.accessToken), taken);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "IDENTITY_LINKED_ELSEWHERE" } });
  });

  it("refuses a bad Google ID token and keeps the code usable", async () => {
    const line = await signIn("line", uniqueSub("line"));
    const code = await issue(line.accessToken);
    const bad = await call("/auth/link-code/redeem", json({ code, idToken: "nonsense" }));
    expect(bad.status).toBe(401);
    expect((await redeem(code, uniqueSub("g"))).status).toBe(200);
  });

  it("stores only a hash of the code", async () => {
    const line = await signIn("line", uniqueSub("line"));
    const code = await issue(line.accessToken);
    const rows = await env.DB.prepare("SELECT code_hash FROM link_codes WHERE user_id = ?")
      .bind(line.userId)
      .all<{ code_hash: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]?.code_hash).not.toContain(code);
  });

  it("requires a signed-in User to issue a code", async () => {
    expect((await call("/auth/link-code", json({}))).status).toBe(401);
  });
});
