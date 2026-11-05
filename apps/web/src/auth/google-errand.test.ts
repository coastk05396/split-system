import { fireEvent, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { renderApp } from "../../test/render-app.js";
import { describe, expect, it, vi } from "vitest";
import { makeUser } from "../../test/fake-api.js";
import { createFakeSignIn } from "../../test/fake-sign-in.js";
import { ApiFailure } from "../api/errors.js";
import { createGoogleErrand } from "./google-errand.js";
import type { AuthState } from "./AuthProvider.js";
import type { GoogleErrand } from "../platform/google.js";
import type { RenderAppOptions } from "../../test/render-app.js";

function setup(options: RenderAppOptions = {}, signedIn = false) {
  const state: AuthState = signedIn
    ? { status: "signedIn", user: makeUser("小宇", "line") }
    : { status: "signedOut", error: null };
  const { google, line, googleRedirects, lineExternalOpens } = createFakeSignIn({
    google: "holds",
    ...options,
  });
  const redirect = vi.spyOn(google, "redirect");
  const auth = {
    state,
    signIn: vi.fn(() => Promise.resolve(true)),
    redeemLinkCode: vi.fn(() => Promise.resolve(true)),
    link: vi.fn(() => Promise.resolve()),
    createLinkCode: vi.fn(() => Promise.resolve("code-1")),
    refreshIdentities: vi.fn(() => Promise.resolve()),
  };
  const navigate = vi.fn();
  const errand = createGoogleErrand({ google, line, auth: () => auth, navigate });
  return { redirect, line, auth, navigate, errand, googleRedirects, lineExternalOpens };
}

describe("Google errand", () => {
  const errands = [
    { purpose: "signIn", next: "/groups" },
    { purpose: "link" },
    { purpose: "linkCode", code: "code-1" },
  ] satisfies GoogleErrand[];

  it.each(
    errands.flatMap((arrival) =>
      [false, true].flatMap((insideLine) =>
        [false, true].flatMap((signedIn) =>
          [false, true].map((taken) => ({ arrival, insideLine, signedIn, taken })),
        ),
      ),
    ),
  )(
    "resume $arrival.purpose, LINE=$insideLine, signedIn=$signedIn, taken=$taken",
    ({ arrival, insideLine, signedIn, taken }) => {
      const { errand, redirect, googleRedirects, lineExternalOpens } = setup(
        {
          ...(insideLine ? { insideLine: { idToken: null } } : {}),
          google: "holds",
        },
        signedIn,
      );
      if (!taken) redirect.mockReturnValue(false);
      errand.resume(arrival);
      errand.resume(arrival);
      const redirects = !insideLine && (arrival.purpose !== "linkCode" || !signedIn);
      expect(googleRedirects).toEqual(redirects && taken ? [arrival] : []);
      expect(errand.getSnapshot().phase).toBe(redirects && taken ? "leaving" : "ready");
      expect(lineExternalOpens).toEqual([]);
      if (redirects) expect(redirect).toHaveBeenCalledExactlyOnceWith(arrival, { once: true });
    },
  );

  it.each(errands)("settles $purpose when Google does not take over", (arrival) => {
    const { errand, redirect } = setup();
    redirect.mockReturnValue(false);
    errand.resume(arrival);
    expect(errand.getSnapshot().phase).toBe("ready");
  });

  it.each(
    errands.flatMap((arrival) => [false, true].map((insideLine) => ({ arrival, insideLine }))),
  )("starts $arrival.purpose, LINE=$insideLine", async ({ arrival, insideLine }) => {
    const { errand, googleRedirects, lineExternalOpens, auth } = setup(
      insideLine ? { insideLine: { idToken: null } } : {},
    );
    await errand.start(arrival);
    expect(googleRedirects).toEqual(insideLine ? [] : [arrival]);
    const signInUrl = new URL(window.location.href);
    signInUrl.searchParams.set("google", "1");
    const target =
      arrival.purpose === "signIn"
        ? signInUrl.toString()
        : arrival.purpose === "link"
          ? `${window.location.origin}/link?code=code-1`
          : window.location.href;
    expect(lineExternalOpens).toEqual(insideLine ? [target] : []);
    expect(auth.createLinkCode).toHaveBeenCalledTimes(
      insideLine && arrival.purpose === "link" ? 1 : 0,
    );
    expect(errand.getSnapshot().phase).toBe(insideLine ? "ready" : "leaving");
  });

  it.each(errands)("reports an outside-browser failure for $purpose", async (arrival) => {
    const { errand } = setup({ insideLine: { idToken: null }, openExternalFails: true });
    await errand.start(arrival);
    expect(errand.getSnapshot()).toMatchObject({ phase: "ready", error: "INTERNAL" });
  });

  it("clears the last attempt's error when a new errand starts", async () => {
    const { errand, auth } = setup({ insideLine: { idToken: null } });
    auth.createLinkCode.mockRejectedValueOnce(new ApiFailure("UNAUTHORIZED", 401));
    await errand.start({ purpose: "link" });
    const started = errand.start({ purpose: "link" });
    expect(errand.getSnapshot()).toMatchObject({ phase: "leaving", error: null });
    await started;
    expect(errand.getSnapshot()).toMatchObject({ phase: "ready", error: null });
  });

  it("keeps a link-code API failure and never opens the browser", async () => {
    const { errand, auth, lineExternalOpens } = setup({ insideLine: { idToken: null } });
    auth.createLinkCode.mockRejectedValue(new ApiFailure("UNAUTHORIZED", 401));
    await errand.start({ purpose: "link" });
    expect(errand.getSnapshot().error).toBe("UNAUTHORIZED");
    expect(lineExternalOpens).toEqual([]);
  });

  it.each([false, true])(
    "ignores an empty code or unavailable Google (available=$available)",
    (available) => {
      const { errand, googleRedirects } = setup({ googleAvailable: available });
      errand.resume({ purpose: "linkCode", code: "" });
      expect(googleRedirects).toEqual([]);
      expect(errand.getSnapshot().phase).toBe("ready");
    },
  );

  it.each(
    errands.flatMap((arrival) =>
      [false, true].flatMap((signedIn) =>
        [null, "token"].map((idToken) => ({ arrival, signedIn, idToken })),
      ),
    ),
  )(
    "finishes $arrival.purpose, signedIn=$signedIn, token=$idToken",
    async ({ arrival, signedIn, idToken }) => {
      const { errand, auth, navigate } = setup(
        { googleRedirectResult: { errand: arrival, idToken } },
        signedIn,
      );
      await errand.finish();
      await errand.finish();
      const blocked = idToken === null || (arrival.purpose === "linkCode" && signedIn);
      const from =
        arrival.purpose === "link"
          ? "/settings"
          : arrival.purpose === "signIn"
            ? "/sign-in?next=%2Fgroups"
            : "/link?code=code-1";
      const linked = !blocked && arrival.purpose !== "signIn";
      expect(navigate).toHaveBeenCalledExactlyOnceWith(
        linked ? "/settings" : from,
        linked ? { replace: true, state: { linked: "google" } } : { replace: true },
      );
      expect(auth.signIn).toHaveBeenCalledTimes(!blocked && arrival.purpose === "signIn" ? 1 : 0);
      expect(auth.link).toHaveBeenCalledTimes(!blocked && arrival.purpose === "link" ? 1 : 0);
      expect(auth.redeemLinkCode).toHaveBeenCalledTimes(
        !blocked && arrival.purpose === "linkCode" ? 1 : 0,
      );
    },
  );

  it("returns failed link-code redemption to the original code", async () => {
    const { errand, auth, navigate } = setup({
      googleRedirectResult: {
        errand: { purpose: "linkCode", code: "code-1" },
        idToken: "token",
      },
    });
    auth.redeemLinkCode.mockResolvedValue(false);
    await errand.finish();
    expect(navigate).toHaveBeenCalledWith("/link?code=code-1", { replace: true });
  });

  it.each([new ApiFailure("IDENTITY_LINKED_ELSEWHERE", 409), new Error("offline")])(
    "keeps link failures on the return page: %s",
    async (error) => {
      const { errand, auth, navigate } = setup({
        googleRedirectResult: {
          errand: { purpose: "link" },
          idToken: "token",
        },
      });
      auth.link.mockRejectedValue(error);
      await errand.finish();
      expect(errand.getSnapshot().error).toBe(
        error instanceof ApiFailure ? "IDENTITY_LINKED_ELSEWHERE" : "INTERNAL",
      );
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  it("drops a completed arrival when the page has closed", async () => {
    const { errand, navigate } = setup({
      googleRedirectResult: {
        errand: { purpose: "link" },
        idToken: "token",
      },
    });
    await errand.finish(() => false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("returns an unreadable answer to sign-in", async () => {
    const { errand, navigate } = setup();
    await errand.finish();
    expect(navigate).toHaveBeenCalledWith("/sign-in", { replace: true });
  });

  it("keeps next on the same site", async () => {
    const { errand, navigate } = setup({
      googleRedirectResult: {
        errand: { purpose: "signIn", next: "https://other.example/" },
        idToken: "token",
      },
    });
    await errand.finish();
    expect(navigate).toHaveBeenCalledWith("/sign-in?next=%2F", { replace: true });
  });

  it.each(["/link?code=code-1", "/sign-in?google=1"])(
    "the hook settles a restored automatic arrival at %s",
    async (path) => {
      const { googleRedirects } = renderApp({ path, google: "holds" });
      await waitFor(() => {
        expect(googleRedirects).toHaveLength(1);
      });
      expect(screen.getByRole("status")).toHaveTextContent("前往 Google…");
      fireEvent(window, new PageTransitionEvent("pageshow", { persisted: true }));
      expect(await screen.findByRole("button", { name: "使用 Google 登入" })).toBeEnabled();
      expect(googleRedirects).toHaveLength(1);
    },
  );

  it("the hook resets a button's spinner on a back-forward-cache restore", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/sign-in", google: "holds" });
    await user.click(await screen.findByRole("button", { name: "使用 Google 登入" }));
    expect(screen.getByRole("button", { name: "前往 Google…" })).toBeDisabled();
    fireEvent(window, new PageTransitionEvent("pageshow", { persisted: true }));
    expect(screen.getByRole("button", { name: "使用 Google 登入" })).toBeEnabled();
  });

  it("resumes once and settles a page restored from the back-forward cache", () => {
    const { errand, redirect } = setup();
    const arrival = { purpose: "linkCode", code: "code-1" } as const;
    errand.resume(arrival);
    expect(errand.getSnapshot().phase).toBe("leaving");
    errand.restore(false);
    expect(errand.getSnapshot().phase).toBe("leaving");
    errand.restore(true);
    errand.resume(arrival);
    expect(errand.getSnapshot().phase).toBe("ready");
    expect(redirect).toHaveBeenCalledExactlyOnceWith(arrival, { once: true });
  });
});
