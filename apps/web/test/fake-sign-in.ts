import type { GoogleErrand, GoogleSignIn } from "../src/platform/google.js";
import {
  LineShareUnavailableError,
  type LineMessage,
  type LineSignIn,
} from "../src/platform/line.js";
import type { RenderAppOptions } from "./render-app.js";

/** The same browser ports for page tests and the Google errand seam. */
export function createFakeSignIn(
  options: RenderAppOptions = {},
  navigate: (path: string) => unknown = () => undefined,
) {
  const lineLogins: string[] = [];
  const lineExternalOpens: string[] = [];
  const googleRedirects: GoogleErrand[] = [];
  const lineShares: string[] = [];
  const linePrepares = { count: 0 };
  const lineShareMessages: LineMessage[] = [];
  const lineChatMessages: LineMessage[] = [];

  function pickerResult(): Promise<boolean> {
    if (options.linePicker === "unavailable")
      return Promise.reject(new LineShareUnavailableError());
    if (options.linePicker === "fails") return Promise.reject(new Error("picker failed"));
    return Promise.resolve(options.linePicker !== "cancelled");
  }

  const line: LineSignIn = {
    isInClient: () => options.insideLine !== undefined,
    prepare: () => {
      linePrepares.count++;
      return Promise.resolve();
    },
    autoSignIn: () => Promise.resolve(options.insideLine?.idToken ?? null),
    login: () => {
      lineLogins.push(window.location.href);
      return Promise.resolve();
    },
    openExternal: (url) => {
      if (options.openExternalFails === true) return Promise.reject(new Error("LIFF failed"));
      lineExternalOpens.push(url);
      return Promise.resolve();
    },
    share: (text) => {
      lineShares.push(text);
      return pickerResult();
    },
    shareMessages: (messages) => {
      lineShareMessages.push(...messages);
      return pickerResult();
    },
    canSendToChat: () => Promise.resolve(options.lineChat === true),
    sendToChat:
      options.sendToChat ??
      ((messages) => {
        if (options.lineChatFails === true) return Promise.reject(new Error("chat send failed"));
        lineChatMessages.push(...messages);
        return Promise.resolve();
      }),
  };
  // Stands in for the round trip to Google: a redirect lands on /google-return with an ID token,
  // unless the test has Google hold the page ("holds") or refuse ("refuses").
  let googleAnswer: { errand: GoogleErrand; idToken: string | null } | null =
    options.googleRedirectResult ?? null;
  const onceKeys = new Set<string>();
  let refused = false;
  const google: GoogleSignIn = {
    available: options.googleAvailable ?? true,
    redirect(errand, redirectOptions) {
      const key = JSON.stringify(errand);
      if (redirectOptions?.once === true && onceKeys.has(key)) return false;
      if (redirectOptions?.once === true) onceKeys.add(key);
      googleRedirects.push(errand);
      if (options.google === "holds") return true;
      const refuse = options.google === "refuses" || (options.google === "refusesOnce" && !refused);
      refused ||= refuse;
      googleAnswer = { errand, idToken: refuse ? null : "fake|g-1|Google 小宇" };
      void navigate("/google-return");
      return true;
    },
    takeRedirectResult() {
      const answer = googleAnswer;
      googleAnswer = null;
      return answer;
    },
  };

  return {
    line,
    google,
    lineLogins,
    lineExternalOpens,
    googleRedirects,
    lineShares,
    linePrepares,
    lineShareMessages,
    lineChatMessages,
  };
}
