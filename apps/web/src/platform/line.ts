import type liff from "@line/liff";

export type LineLinkResult = { idToken: string } | { idToken: null; mismatch?: true };
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
  /** Outside LINE on Settings: send the browser to LINE Login to link LINE to the signed-in User. */
  startLink(userId: string): Promise<void>;
  /** True when a LINE link round trip is pending and has not yet completed or been cancelled. */
  hasPendingLink(): boolean;
  /** On return from `startLink`: the LINE ID token (or null when cancelled/failed/mismatched), or null when none is pending. */
  takeLinkResult(expectedUserId: string): Promise<LineLinkResult | null>;
  /** Clears a pending `startLink` marker; returns true if a link round trip was pending. */
  cancelLink(): boolean;
  /** Inside LINE: open `url` in the phone's own browser (Google refuses LINE's in-app one). */
  openExternal(url: string): Promise<void>;
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
const LINK_KEY = "split.lineLink";

/** How long a started LINE login may take to come back before the marker is ignored. */
const RETURNING_TTL_MS = 10 * 60 * 1000;

/** LIFF adds these to the address when it sends the browser back from LINE. */
const LIFF_RETURN_PARAM = /[?&](liff\.state|liffClientId|liffRedirectUri)=/;
const OAUTH_RETURN_PARAMS = [
  "error",
  "error_description",
  "liffOAuth2Error",
  "code",
  "state",
  "liffClientId",
  "liffRedirectUri",
] as const;

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

function markLink(userId: string): void {
  storage()?.setItem(LINK_KEY, JSON.stringify({ userId, startedAt: Date.now() }));
}

function clearLink(): void {
  storage()?.removeItem(LINK_KEY);
}

function readLinkMarker(): { userId: string; startedAt: number; expired: boolean } | null {
  const raw = storage()?.getItem(LINK_KEY);
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw) as { userId?: unknown; startedAt?: unknown };
    if (
      typeof parsed.userId !== "string" ||
      parsed.userId === "" ||
      typeof parsed.startedAt !== "number" ||
      !Number.isFinite(parsed.startedAt)
    ) {
      return { userId: "", startedAt: 0, expired: true };
    }
    return {
      userId: parsed.userId,
      startedAt: parsed.startedAt,
      expired: Date.now() - parsed.startedAt >= RETURNING_TTL_MS,
    };
  } catch {
    return { userId: "", startedAt: 0, expired: true };
  }
}

function hasPendingLink(): boolean {
  return readLinkMarker() !== null;
}

function stripOAuthParams(): void {
  const url = new URL(window.location.href);
  let changed = false;
  for (const param of OAUTH_RETURN_PARAMS) {
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      changed = true;
    }
  }
  if (changed) window.history.replaceState(window.history.state, "", url);
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

/** The same page with the parameter that makes LINE hand it to the phone's own browser. */
export function externalBrowserUrl(url: string): string {
  const next = new URL(url);
  next.searchParams.set("openExternalBrowser", "1");
  return next.toString();
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
  let linkResult: Promise<LineLinkResult | null> | null = null;

  async function beginLogin(redirectUri: string): Promise<void> {
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
    liff.login({ redirectUri });
  }

  async function readLinkResult(expectedUserId: string): Promise<LineLinkResult | null> {
    const pending = readLinkMarker();
    if (pending === null) return null;
    if (pending.expired || pending.userId !== expectedUserId) {
      clearLink();
      clearReturning();
      stripOAuthParams();
      return { idToken: null, mismatch: true };
    }
    if (new URLSearchParams(window.location.search).has("error")) {
      clearLink();
      clearReturning();
      stripOAuthParams();
      return { idToken: null };
    }
    try {
      const liff = await loadLiff();
      if (liff === null || !liff.isLoggedIn()) return { idToken: null };
      const idToken = liff.getIDToken();
      return idToken === null ? { idToken: null } : { idToken };
    } catch {
      return { idToken: null };
    } finally {
      clearLink();
      clearReturning();
      stripOAuthParams();
    }
  }

  async function startAutoSignIn(): Promise<string | null> {
    if (hasPendingLink()) {
      clearLink();
      clearReturning();
      stripOAuthParams();
      return null;
    }
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

    login: () => beginLogin(window.location.href),

    async startLink(userId) {
      linkResult = null;
      markLink(userId);
      try {
        await beginLogin(`${window.location.origin}${window.location.pathname}`);
      } catch (error) {
        clearLink();
        clearReturning();
        throw error;
      }
    },

    hasPendingLink,

    takeLinkResult(expectedUserId) {
      linkResult ??= readLinkResult(expectedUserId).finally(() => {
        queueMicrotask(() => {
          linkResult = null;
        });
      });
      return linkResult;
    },

    cancelLink() {
      const wasPending = hasPendingLink();
      linkResult = null;
      clearLink();
      clearReturning();
      stripOAuthParams();
      return wasPending;
    },

    // Inside LIFF, LINE ignores the openExternalBrowser parameter, so use LIFF's own external
    // window; a failure there is reported, never hidden behind the parameter. In LINE's plain
    // in-app browser (no LIFF) the parameter still works, with no LIFF ID.
    async openExternal(url) {
      const liff = await loadLiff();
      if (liff?.isInClient() === true) {
        liff.openWindow({ url, external: true });
        return;
      }
      window.location.assign(externalBrowserUrl(url));
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
