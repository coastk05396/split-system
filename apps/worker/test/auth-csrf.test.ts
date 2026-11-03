import { describe, expect, it } from "vitest";
import { call, json, uniqueSub } from "./auth-harness.js";

const token = () => `fake|${uniqueSub("csrf")}|小宇`;

describe("sign-in from another site", () => {
  it("refuses a login posted as text/plain, the type a form on another site can send", async () => {
    const res = await call("/auth/google", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ idToken: token() }),
    });

    expect(res.status).toBe(400);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("refuses any sign-in JSON that carries a foreign Origin, without setting a cookie", async () => {
    const res = await call(
      "/auth/google",
      json({ idToken: token() }, { Origin: "https://evil.example" }),
    );

    expect(res.status).toBe(403);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("refuses refresh and logout that carry a foreign Origin", async () => {
    for (const path of ["/auth/refresh", "/auth/logout"]) {
      const res = await call(path, { method: "POST", headers: { Origin: "https://evil.example" } });
      expect(res.status, path).toBe(403);
    }
  });

  it("refuses a write the browser marks as cross-site, whatever Origin says", async () => {
    const res = await call(
      "/auth/google",
      json({ idToken: token() }, { "Sec-Fetch-Site": "cross-site" }),
    );

    expect(res.status).toBe(403);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("lets a same-origin page through a proxy that shows the Worker another host", async () => {
    // The Vite dev server and tunnels forward /api, so the Worker's own URL is not the page's.
    const res = await call(
      "/auth/google",
      json(
        { idToken: token() },
        { Origin: "http://localhost:5173", "Sec-Fetch-Site": "same-origin" },
      ),
    );

    expect(res.status).toBe(200);
  });

  it("still signs in from the app's own origin", async () => {
    const res = await call(
      "/auth/google",
      json({ idToken: token() }, { Origin: "https://split.test" }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toContain("refresh=");
  });

  it("requires a JSON body type on other routes that read a body too", async () => {
    const { signIn } = await import("./auth-harness.js");
    const session = await signIn("google", uniqueSub("csrf-groups"));

    const res = await call("/groups", {
      method: "POST",
      headers: { "Content-Type": "text/plain", Authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({ name: "x" }),
    });

    expect(res.status).toBe(400);
  });
});
