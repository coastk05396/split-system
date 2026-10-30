import type liff from "@line/liff";

/** A message the LIFF share picker or `sendMessages` takes: text or a Flex card. */
export type LineMessage = Parameters<typeof liff.sendMessages>[0][number];

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
  /** Like `share`, for any messages, such as a Flex card. */
  shareMessages(messages: LineMessage[]): Promise<boolean>;
  /**
   * Whether the app was opened from a LINE chat and the LIFF app may post into it
   * (the `chat_message.write` scope). False everywhere else, so callers hide the choice.
   */
  canSendToChat(): Promise<boolean>;
  /** Post messages as the person into the chat the app was opened from. */
  sendToChat(messages: LineMessage[]): Promise<void>;
}

export class LineShareUnavailableError extends Error {}

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
  let liffReady: Promise<(typeof import("@line/liff"))["default"]> | null = null;

  async function loadLiff() {
    if (liffId === undefined || liffId === "") return null;
    liffReady ??= import("@line/liff").then(async ({ default: liff }) => {
      await liff.init({ liffId });
      return liff;
    });
    try {
      return await liffReady;
    } catch (error) {
      liffReady = null;
      throw error;
    }
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

  async function shareMessages(messages: LineMessage[]): Promise<boolean> {
    const liff = await loadLiff();
    if (liff === null || !liff.isApiAvailable("shareTargetPicker")) {
      throw new LineShareUnavailableError("The LINE share target picker is not available");
    }
    const result = await liff.shareTargetPicker(messages);
    if (result === undefined) return false;
    if (liff.isInClient()) liff.closeWindow();
    return true;
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
      // A browser LIFF still counts as logged in keeps its old ID token (valid one hour):
      // `liff.init` ignores the new login's code while logged in. Drop it first. The LINE
      // app signs in by itself, and LIFF does not allow logging in or out there.
      if (!liff.isInClient() && liff.isLoggedIn()) liff.logout();
      liff.login({ redirectUri: window.location.href });
    },

    share: (text) => shareMessages([{ type: "text", text }]),

    shareMessages,

    async canSendToChat() {
      if (!looksLikeLineApp(navigator.userAgent)) return false;
      try {
        const liff = await loadLiff();
        if (liff === null || !liff.isInClient()) return false;
        const type = liff.getContext()?.type;
        if (type !== "utou" && type !== "group" && type !== "room") return false;
        return (await liff.permission.query("chat_message.write")).state !== "unavailable";
      } catch {
        return false;
      }
    },

    async sendToChat(messages) {
      const liff = await loadLiff();
      if (liff === null) throw new LineShareUnavailableError("LIFF is not configured");
      await liff.sendMessages(messages);
    },
  };
}
