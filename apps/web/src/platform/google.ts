import { getLocale } from "../i18n/messages.js";

/**
 * Google sign-in through Google Identity Services. The script loads only on the
 * sign-in screen and only outside LINE (decision 20).
 */
export interface GoogleSignIn {
  /** False when no Google client ID is configured (local development). */
  readonly available: boolean;
  /** Draws Google's button into `container`; `onIdToken` receives the ID token. */
  renderButton(container: HTMLElement, onIdToken: (idToken: string) => void): Promise<void>;
  /**
   * Leaves for Google's account chooser at once; it returns to `/link`, carrying `state`. Once per
   * `state`, so a back-tap or a refusal lands on the page's own button instead of looping.
   */
  redirect(state: string): void;
  /**
   * On return from `redirect`: the `state` sent, and the ID token when Google gave a valid one
   * (null when it refused or the token is not ours). The token leaves the address; the state
   * stays in it as `?code=`, so a reload or the page's own button still has it.
   */
  takeRedirectResult(): { idToken: string | null; state: string } | null;
}

/** The slice of `google.accounts.id` the app uses. */
interface GoogleIdApi {
  initialize(config: {
    client_id: string;
    callback: (response: { credential: string }) => void;
    ux_mode: "popup";
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type: "standard";
      theme: "outline";
      size: "large";
      shape: "pill";
      text: "signin_with";
      locale: string;
      width: number;
    },
  ): void;
}

interface GoogleWindow {
  google?: { accounts: { id: GoogleIdApi } };
}

const SCRIPT_URL = "https://accounts.google.com/gsi/client";
let loading: Promise<GoogleIdApi> | null = null;

function loadScript(): Promise<GoogleIdApi> {
  loading ??= new Promise<GoogleIdApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      const api = (window as GoogleWindow).google?.accounts.id;
      if (api === undefined) reject(new Error("Google Identity Services did not load"));
      else resolve(api);
    };
    script.onerror = () => {
      loading = null;
      reject(new Error("Google Identity Services did not load"));
    };
    document.head.append(script);
  });
  return loading;
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

const NONCE_KEY = "split.googleNonce";
const STATE_KEY = "split.googleRedirectState";

export function createGoogleSignIn(clientId: string | undefined): GoogleSignIn {
  const available = clientId !== undefined && clientId !== "";
  return {
    available,
    async renderButton(container, onIdToken) {
      if (clientId === undefined || clientId === "") return;
      const api = await loadScript();
      api.initialize({
        client_id: clientId,
        callback: ({ credential }) => {
          onIdToken(credential);
        },
        ux_mode: "popup",
      });
      api.renderButton(container, {
        type: "standard",
        theme: "outline",
        size: "large",
        shape: "pill",
        text: "signin_with",
        locale: getLocale() === "en" ? "en" : "zh-TW",
        width: Math.min(container.clientWidth || 350, 400),
      });
    },
    redirect(state) {
      if (clientId === undefined || clientId === "") return;
      if (sessionStorage.getItem(STATE_KEY) === state) return;
      sessionStorage.setItem(STATE_KEY, state);
      const nonce = crypto.randomUUID();
      sessionStorage.setItem(NONCE_KEY, nonce);
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `${window.location.origin}/link`,
        response_type: "id_token",
        scope: "openid email profile",
        nonce,
        state,
        prompt: "select_account",
      }).toString();
      // assign, not replace: Back from Google returns to /link, where the guard stops a second jump.
      window.location.assign(url.toString());
    },
    takeRedirectResult() {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const state = params.get("state");
      if (state === null) return null;
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}?code=${encodeURIComponent(state)}`,
      );
      const idToken = params.get("id_token");
      const nonce = sessionStorage.getItem(NONCE_KEY);
      sessionStorage.removeItem(NONCE_KEY);
      return {
        state,
        idToken: idToken !== null && nonce !== null && nonceOf(idToken) === nonce ? idToken : null,
      };
    },
  };
}
