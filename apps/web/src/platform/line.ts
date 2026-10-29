/**
 * LINE sign-in through LIFF (decision 20). The SDK is large, so it is imported only
 * when the page is inside LINE or is coming back from LINE Login.
 */
export interface LineSignIn {
  /** Cheap check, without the SDK, that the page is open in the LINE app. */
  isInClient(): boolean;
  /** Inside LINE or after LINE Login: the LIFF ID token; otherwise null. */
  autoSignIn(): Promise<string | null>;
  /** Outside LINE: send the browser to LINE Login (email or QR), returning here. */
  login(): Promise<void>;
  /**
   * Inside LINE: send a text message through the share target picker (decision 10).
   * Resolves true when sent, false when the person closed the picker.
   */
  share(text: string): Promise<boolean>;
}

const RETURNING_KEY = "split.lineLogin";

/** The LINE in-app browser adds "Line/<version>" to its user agent. */
function looksLikeLineApp(userAgent: string): boolean {
  return / Line\//i.test(userAgent);
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function createLineSignIn(liffId: string | undefined): LineSignIn {
  async function loadLiff() {
    if (liffId === undefined || liffId === "") return null;
    const { default: liff } = await import("@line/liff");
    await liff.init({ liffId });
    return liff;
  }

  // Started once per page load: React may mount the auth provider twice in dev.
  let autoSignIn: Promise<string | null> | null = null;

  async function startAutoSignIn(): Promise<string | null> {
    const returning = storage()?.getItem(RETURNING_KEY) === "1";
    if (!returning && !looksLikeLineApp(navigator.userAgent)) return null;
    const liff = await loadLiff();
    if (liff === null) {
      storage()?.removeItem(RETURNING_KEY);
      return null;
    }
    if (!liff.isLoggedIn()) {
      storage()?.removeItem(RETURNING_KEY);
      if (liff.isInClient()) liff.login();
      return null;
    }
    const idToken = liff.getIDToken();
    storage()?.removeItem(RETURNING_KEY);
    return idToken;
  }

  return {
    isInClient: () => looksLikeLineApp(navigator.userAgent),

    autoSignIn() {
      autoSignIn ??= startAutoSignIn();
      return autoSignIn;
    },

    async login() {
      storage()?.setItem(RETURNING_KEY, "1");
      const liff = await loadLiff();
      if (liff === null) {
        storage()?.removeItem(RETURNING_KEY);
        throw new Error("LIFF ID is not configured");
      }
      liff.login({ redirectUri: window.location.href });
    },

    async share(text) {
      const liff = await loadLiff();
      if (liff === null || !liff.isApiAvailable("shareTargetPicker")) {
        throw new Error("The LINE share target picker is not available");
      }
      const result = await liff.shareTargetPicker([{ type: "text", text }]);
      return result !== undefined;
    },
  };
}
