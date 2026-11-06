import { clearExpenseWrites } from "../src/expenses/writes.js";
import type { Me } from "@split/shared";
import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AppProviders, type AppDeps } from "../src/app/AppProviders.js";
import { routes } from "../src/app/routes.js";
import type { CacheStorage } from "../src/groups/cache-persistence.js";
import type { GoogleErrand } from "../src/platform/google.js";
import type { LineMessage, LineSignIn } from "../src/platform/line.js";
import { createFakeSignIn } from "./fake-sign-in.js";
import { createFakeApi, type FakeApi } from "./fake-api.js";
import type { FakeGroups } from "./fake-groups.js";

export interface RenderAppOptions {
  strictMode?: boolean;
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
  /** The picker can be unavailable, fail, or be cancelled instead of succeeding. */
  linePicker?: "unavailable" | "fails" | "cancelled";
  /** Make posting into the chat fail. */
  lineChatFails?: boolean;
  /** Override the external chat transport, for delayed answers. */
  sendToChat?: LineSignIn["sendToChat"];
  /** Whether the Google button can load (a client ID is configured). */
  googleAvailable?: boolean;
  /** What Google's redirect brought back to the page, if anything (for starting on /google-return). */
  googleRedirectResult?: { errand: GoogleErrand; idToken: string | null };
  /** How the fake Google answers a redirect: by default with a token at once. */
  google?: "holds" | "refuses" | "refusesOnce";
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
  googleRedirects: GoogleErrand[];
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
  clearExpenseWrites();
  options.seed?.(api.groups);
  const { line, google, ...signInLogs } = createFakeSignIn(options, (path) =>
    router.navigate(path),
  );

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
  const app = (
    <AppProviders deps={deps} queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  );
  render(options.strictMode === true ? <StrictMode>{app}</StrictMode> : app);
  return {
    api,
    router,
    queryClient,
    ...signInLogs,
  };
}
