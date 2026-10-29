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
  };
}
