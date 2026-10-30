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
  /**
   * Start LIFF at once when opened in LINE or coming back from LINE Login, so its own redirects
   * and `liff.state` run on arrival. Does nothing elsewhere. Safe to call without waiting.
   */
  prepare(): Promise<void>;
  /** Inside LINE or after LINE Login: the LIFF ID token; otherwise null. */
  autoSignIn(): Promise<string | null>;
  /** Outside LINE: send the browser to LINE Login (email or QR), returning here. */
  login(): Promise<void>;
  /**
   * Inside LINE: send a text message through the share target picker (decision 10).
   * Resolves true when sent, false when the person closed the picker. The LINE window closes
   * after a send unless `stayOpen`, for a share the person may repeat, such as an invitation.
   */
  share(text: string, options?: ShareOptions): Promise<boolean>;
  /** Like `share`, for any messages, such as a Flex card. */
  shareMessages(messages: LineMessage[], options?: ShareOptions): Promise<boolean>;
  /**
   * Whether the app was opened from a LINE chat and the LIFF app may post into it
   * (the `chat_message.write` scope). False everywhere else, so callers hide the choice.
   */
  canSendToChat(): Promise<boolean>;
  /** Post messages as the person into the chat the app was opened from. */
  sendToChat(messages: LineMessage[]): Promise<void>;
}

export interface ShareOptions {
  stayOpen?: boolean;
}

export class LineShareUnavailableError extends Error {}

const RETURNING_KEY = "split.lineLogin";

/** How long a started LINE login may take to come back before the marker is ignored. */
const RETURNING_TTL_MS = 10 * 60 * 1000;

/** LIFF adds these to the address when it sends the browser back from LINE. */
const LIFF_RETURN_PARAM = /[?&](liff\.state|liffClientId|liffRedirectUri)=/;

/**
 * LIFF's `init()` on Android checks for this query parameter after a browser login; without it,
 * LIFF opens a `<lui-alert>` ("You have logged in" / "Continue") whose promise never resolves and
 * whose `window.open(..., "_blank")` is blocked inside LINE's in-app browser, leaving `/sign-in`
 * stuck on the loading screen. Keeping the parameter present while `liff.init()` runs skips that
 * workaround. It is an undocumented LIFF internal, last checked against @line/liff 2.31.2; re-test
 * LINE sign-in on Android when upgrading LIFF.
 */
const ANDROID_ESCAPE_PARAM = "liffIsEscapedFromApp";

/** The LINE in-app browser adds "Line/<version>" to its user agent. */
function looksLikeLineApp(userAgent: string): boolean {
  return / Line\//i.test(userAgent);
}

/**
 * Shared by every tab: on Android, LINE hands the browser back in a new tab, which has its own
 * sessionStorage, so a marker kept there was lost and the person stayed signed out.
 */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function markReturning(): void {
  storage()?.setItem(RETURNING_KEY, String(Date.now()));
}

function clearReturning(): void {
  storage()?.removeItem(RETURNING_KEY);
}

/** A LINE login was started a moment ago, or the address says LIFF just sent us back. */
function isReturning(): boolean {
  const started = Number(storage()?.getItem(RETURNING_KEY));
  return (
    (Number.isFinite(started) && Date.now() - started < RETURNING_TTL_MS) ||
    LIFF_RETURN_PARAM.test(window.location.search)
  );
}

async function initLiffWithoutAndroidPrompt(
  liff: (typeof import("@line/liff"))["default"],
  liffId: string,
): Promise<void> {
  if (LIFF_RETURN_PARAM.test(window.location.search)) markReturning();
  const before = new URL(window.location.href);
  const addedEscapeParam = !before.searchParams.has(ANDROID_ESCAPE_PARAM);
  if (addedEscapeParam) {
    before.searchParams.set(ANDROID_ESCAPE_PARAM, "true");
    window.history.replaceState(window.history.state, "", before);
  }
  try {
    await liff.init({ liffId });
  } finally {
    if (addedEscapeParam) {
      const after = new URL(window.location.href);
      if (after.searchParams.has(ANDROID_ESCAPE_PARAM)) {
        after.searchParams.delete(ANDROID_ESCAPE_PARAM);
        window.history.replaceState(window.history.state, "", after);
      }
    }
  }
}

export function createLineSignIn(liffId: string | undefined): LineSignIn {
  let liffReady: Promise<(typeof import("@line/liff"))["default"]> | null = null;

  async function loadLiff() {
    if (liffId === undefined || liffId === "") return null;
    liffReady ??= import("@line/liff").then(async ({ default: liff }) => {
      await initLiffWithoutAndroidPrompt(liff, liffId);
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
    if (!isReturning() && !looksLikeLineApp(navigator.userAgent)) return null;
    const liff = await loadLiff();
    if (liff === null) {
      clearReturning();
      return null;
    }
    if (!liff.isLoggedIn()) {
      clearReturning();
      if (liff.isInClient()) liff.login();
      return null;
    }
    const idToken = liff.getIDToken();
    clearReturning();
    return idToken;
  }

  async function shareMessages(
    messages: LineMessage[],
    options: ShareOptions = {},
  ): Promise<boolean> {
    const liff = await loadLiff();
    if (liff === null) throw new LineShareUnavailableError("LIFF is not configured");
    if (!liff.isLoggedIn() && !liff.isInClient()) {
      markReturning();
      liff.login({ redirectUri: window.location.href });
      return false;
    }
    if (!liff.isApiAvailable("shareTargetPicker")) {
      throw new LineShareUnavailableError("The LINE share target picker is not available");
    }
    const result = await liff.shareTargetPicker(messages);
    if (result === undefined) return false;
    if (liff.isInClient() && options.stayOpen !== true) liff.closeWindow();
    return true;
  }

  return {
    isInClient: () => looksLikeLineApp(navigator.userAgent),

    autoSignIn() {
      autoSignIn ??= startAutoSignIn();
      return autoSignIn;
    },

    async prepare() {
      if (!isReturning() && !looksLikeLineApp(navigator.userAgent)) return;
      await loadLiff();
    },

    async login() {
      markReturning();
      const liff = await loadLiff();
      if (liff === null) {
        clearReturning();
        throw new Error("LIFF ID is not configured");
      }
      // A browser LIFF still counts as logged in keeps its old ID token (valid one hour):
      // `liff.init` ignores the new login's code while logged in. Drop it first. The LINE
      // app signs in by itself, and LIFF does not allow logging in or out there.
      if (!liff.isInClient() && liff.isLoggedIn()) liff.logout();
      liff.login({ redirectUri: window.location.href });
    },

    share: (text, options) => shareMessages([{ type: "text", text }], options),

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
