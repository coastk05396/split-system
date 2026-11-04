import { describe, expect, it } from "vitest";
import {
  bearer,
  call,
  json,
  refreshCookie,
  signIn,
  uniqueSub,
  withCookie,
} from "./auth-harness.js";

function switchToLine(accessToken: string, sub: string, refresh?: string) {
  return call(
    "/auth/switch-to-line",
    json(
      { idToken: `fake|${sub}|小宇` },
      {
        ...bearer(accessToken),
        ...(refresh === undefined ? {} : { Cookie: `refresh=${refresh}` }),
      },
    ),
  );
}

async function googleUserWithLine() {
  const lineSub = uniqueSub("l");
  const google = await signIn("google", uniqueSub("g"));
  const link = await call(
    "/auth/link/line",
    json({ idToken: `fake|${lineSub}|小宇` }, bearer(google.accessToken)),
  );
  expect(link.status).toBe(200);
  return { google, lineSub };
}

describe("POST /auth/switch-to-line (a Google session inside LINE becomes a LINE one)", () => {
  it("signs the same User in with LINE and ends the Google session", async () => {
    const { google, lineSub } = await googleUserWithLine();
    const res = await switchToLine(google.accessToken, lineSub, google.refresh);
    expect(res.status).toBe(200);
    const body = await res.json<{
      accessToken: string;
      user: { id: string; signedInWith: string };
    }>();
    expect(body.user).toMatchObject({ id: google.userId, signedInWith: "line" });
    const fresh = refreshCookie(res);
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(google.refresh);
    expect((await call("/auth/refresh", withCookie(google.refresh))).status).toBe(401);
    const refreshed = await call("/auth/refresh", withCookie(fresh ?? ""));
    expect((await refreshed.json<{ user: { signedInWith: string } }>()).user.signedInWith).toBe(
      "line",
    );
  });

  it("refuses a LINE Identity that is not this User's, and changes nothing", async () => {
    const { google } = await googleUserWithLine();
    const stranger = uniqueSub("stranger");
    const res = await switchToLine(google.accessToken, stranger, google.refresh);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "LINE_NOT_LINKED" } });
    // The Google session still works, and no LINE User was made for the stranger.
    expect((await call("/auth/refresh", withCookie(google.refresh))).status).toBe(200);
    const line = await signIn("line", stranger);
    expect(line.userId).not.toBe(google.userId);
  });

  it("refuses a LINE Identity that belongs to another User", async () => {
    const { google } = await googleUserWithLine();
    const otherLine = uniqueSub("other");
    await signIn("line", otherLine);
    const res = await switchToLine(google.accessToken, otherLine, google.refresh);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "LINE_NOT_LINKED" } });
  });

  it("requires a signed-in User and a valid LINE ID token", async () => {
    expect((await call("/auth/switch-to-line", json({ idToken: "fake|x|y" }))).status).toBe(401);
    const { google } = await googleUserWithLine();
    const bad = await call(
      "/auth/switch-to-line",
      json({ idToken: "forged" }, bearer(google.accessToken)),
    );
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: { code: "ID_TOKEN_INVALID" } });
  });
});
