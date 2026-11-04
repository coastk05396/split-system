/**
 * Google sign-in by redirect: our own button sends the whole page to Google's account chooser,
 * which sends it back to `/google-return` with an ID token. No Google script is loaded: its
 * button is an iframe, which swallows the tap and leaves the page unable to react to a press.
 */

/** What Google's answer is for. It travels through Google in `state` and comes back with it. */
export type GoogleErrand =
  { purpose: "signIn"; next: string } | { purpose: "link" } | { purpose: "linkCode"; code: string };

export interface GoogleSignIn {
  /** False when no Google client ID is configured (local development). */
  readonly available: boolean;
  /**
   * Leaves for Google's account chooser at once. With `once`, a second call for the same errand
   * does nothing, so a back-tap lands on the page's own button instead of looping.
   */
  redirect(errand: GoogleErrand, options?: { once?: boolean }): boolean;
  /**
   * On return from `redirect`: the errand sent, and the ID token when Google gave one that is
   * ours (null when it refused or the token fails the nonce check). Null when the address holds
   * no readable answer.
   */
  takeRedirectResult(): { errand: GoogleErrand; idToken: string | null } | null;
}

const NONCE_KEY = "split.googleNonce";
const ONCE_KEY = "split.googleRedirected";
const RETURN_PATH = "/google-return";

function encode(errand: GoogleErrand): string {
  return JSON.stringify(errand);
}

/** Anything else in `state` is input from the address bar, so each field is checked. */
function decode(state: string): GoogleErrand | null {
  try {
    const value = JSON.parse(state) as Record<string, unknown>;
    if (value.purpose === "signIn" && typeof value.next === "string") {
      return { purpose: "signIn", next: value.next };
    }
    if (value.purpose === "link") return { purpose: "link" };
    if (value.purpose === "linkCode" && typeof value.code === "string") {
      return { purpose: "linkCode", code: value.code };
    }
  } catch {
    // Not JSON: not ours.
  }
  return null;
}

/** The `nonce` claim of an ID token, or null when the token is not a readable JWT. */
function nonceOf(idToken: string): string | null {
  try {
    const payload = idToken.split(".")[1] ?? "";
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      nonce?: unknown;
    };
    return typeof claims.nonce === "string" ? claims.nonce : null;
  } catch {
    return null;
  }
}

export function createGoogleSignIn(clientId: string | undefined): GoogleSignIn {
  const available = clientId !== undefined && clientId !== "";
  return {
    available,
    redirect(errand, options) {
      if (clientId === undefined || clientId === "") return false;
      const state = encode(errand);
      if (options?.once === true) {
        if (sessionStorage.getItem(ONCE_KEY) === state) return false;
        sessionStorage.setItem(ONCE_KEY, state);
      }
      const nonce = crypto.randomUUID();
      sessionStorage.setItem(NONCE_KEY, nonce);
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `${window.location.origin}${RETURN_PATH}`,
        response_type: "id_token",
        scope: "openid email profile",
        nonce,
        state,
        prompt: "select_account",
      }).toString();
      // assign, not replace: Back from Google returns here, where `once` stops a second jump.
      window.location.assign(url.toString());
      return true;
    },
    takeRedirectResult() {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const state = params.get("state");
      const nonce = sessionStorage.getItem(NONCE_KEY);
      sessionStorage.removeItem(NONCE_KEY);
      // The token leaves the address at once, whatever comes of it.
      window.history.replaceState(null, "", window.location.pathname);
      const errand = state === null ? null : decode(state);
      if (errand === null) return null;
      const idToken = params.get("id_token");
      return {
        errand,
        idToken: idToken !== null && nonce !== null && nonceOf(idToken) === nonce ? idToken : null,
      };
    },
  };
}
