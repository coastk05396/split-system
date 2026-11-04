import { dismissDeleteFailure } from "../src/expenses/delete-failure.js";
import { clearPendingWrites } from "../src/expenses/pending-writes.js";
import type { Me } from "@split/shared";
import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AppProviders, type AppDeps } from "../src/app/AppProviders.js";
import { routes } from "../src/app/routes.js";
import type { CacheStorage } from "../src/groups/cache-persistence.js";
import type { GoogleSignIn } from "../src/platform/google.js";
import type { LineMessage, LineSignIn } from "../src/platform/line.js";
import { createFakeApi, type FakeApi } from "./fake-api.js";
import type { FakeGroups } from "./fake-groups.js";

export interface RenderAppOptions {
  webSocket?: typeof WebSocket;
  path?: string;
  /** A User whose refresh cookie the browser already holds. */
  cookieUser?: Me;
  /** Opened inside the LINE app, where LIFF hands over this ID token. */
  insideLine?: { idToken: string | null };
  /** LINE's outside-browser call fails (LIFF cannot start or the native call throws). */
  openExternalFails?: boolean;
  /** The app was opened from a LINE chat that the LIFF app may post into. */
  lineChat?: boolean;
  /** Make posting into the chat fail. */
  lineChatFails?: boolean;
  /** Override the external chat transport, for delayed answers. */
  sendToChat?: LineSignIn["sendToChat"];
  /** Whether the Google button can load (a client ID is configured). */
  googleAvailable?: boolean;
  /** What Google's redirect brought back to the page, if anything. */
  googleRedirectResult?: { idToken: string; state: string };
  testSignIn?: boolean;
  /** Seeds Groups before the app starts. */
  seed?: (groups: FakeGroups) => void;
  /** The start path, read after seeding (for paths holding seeded ids). */
  pathFor?: () => string;
  /** Fake storage for query cache persistence. */
  cacheStorage?: CacheStorage | undefined;
}

export interface RenderedApp {
  queryClient: QueryClient;
  api: FakeApi;
  router: ReturnType<typeof createMemoryRouter>;
  lineLogins: string[];
  /** Addresses handed to the outside browser from inside LINE. */
  lineExternalOpens: string[];
  /** The `state` of each redirect to Google's account chooser. */
  googleRedirects: string[];
  /** Messages sent through the LINE share target picker. */
  lineShares: string[];
  /** How many times the app started LIFF on arrival. */
  linePrepares: { count: number };
  /** Messages shared through the picker as Flex cards or other non-text messages. */
  lineShareMessages: LineMessage[];
  /** Messages posted straight into the current LINE chat. */
  lineChatMessages: LineMessage[];
}

/** Renders the whole SPA over the fake API with fake LINE and Google sign-in. */
export function renderApp(options: RenderAppOptions = {}): RenderedApp {
  const api = createFakeApi();
  api.setCookieUser(options.cookieUser ?? null);
  // Pending writes live in module state; each test starts without the last one's.
  clearPendingWrites();
  dismissDeleteFailure();
  options.seed?.(api.groups);
  const lineLogins: string[] = [];
  const lineExternalOpens: string[] = [];
  const googleRedirects: string[] = [];
  const lineShares: string[] = [];
  const linePrepares = { count: 0 };
  const lineShareMessages: LineMessage[] = [];
  const lineChatMessages: LineMessage[] = [];

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
      return Promise.resolve(true);
    },
    shareMessages: (messages) => {
      lineShareMessages.push(...messages);
      return Promise.resolve(true);
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
  const google: GoogleSignIn = {
    available: options.googleAvailable ?? true,
    renderButton(container, onIdToken) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "使用 Google 帳號登入";
      button.addEventListener("click", () => {
        onIdToken("fake|g-1|Google 小宇");
      });
      container.append(button);
      return Promise.resolve();
    },
    redirect(state) {
      googleRedirects.push(state);
    },
    takeRedirectResult: () => options.googleRedirectResult ?? null,
  };

  const deps: AppDeps = {
    fetch: api.fetch,
    line,
    google,
    testSignIn: options.testSignIn ?? false,
    cacheStorage: options.cacheStorage,
  };
  if (options.webSocket !== undefined) deps.webSocket = options.webSocket;
  const router = createMemoryRouter(routes, {
    initialEntries: [options.pathFor?.() ?? options.path ?? "/"],
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <AppProviders deps={deps} queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return {
    api,
    router,
    queryClient,
    lineLogins,
    lineExternalOpens,
    googleRedirects,
    lineShares,
    linePrepares,
    lineShareMessages,
    lineChatMessages,
  };
}
