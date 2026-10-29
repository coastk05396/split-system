import type { Me } from "@split/shared";
import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AppProviders, type AppDeps } from "../src/app/AppProviders.js";
import { routes } from "../src/app/routes.js";
import type { GoogleSignIn } from "../src/platform/google.js";
import type { LineSignIn } from "../src/platform/line.js";
import { createFakeApi, type FakeApi } from "./fake-api.js";
import type { FakeGroups } from "./fake-groups.js";

export interface RenderAppOptions {
  path?: string;
  /** A User whose refresh cookie the browser already holds. */
  cookieUser?: Me;
  /** Opened inside the LINE app, where LIFF hands over this ID token. */
  insideLine?: { idToken: string | null };
  /** Whether the Google button can load (a client ID is configured). */
  googleAvailable?: boolean;
  testSignIn?: boolean;
  /** Seeds Groups before the app starts. */
  seed?: (groups: FakeGroups) => void;
  /** The start path, read after seeding (for paths holding seeded ids). */
  pathFor?: () => string;
}

export interface RenderedApp {
  api: FakeApi;
  router: ReturnType<typeof createMemoryRouter>;
  lineLogins: string[];
  /** Messages sent through the LINE share target picker. */
  lineShares: string[];
}

/** Renders the whole SPA over the fake API with fake LINE and Google sign-in. */
export function renderApp(options: RenderAppOptions = {}): RenderedApp {
  const api = createFakeApi();
  api.setCookieUser(options.cookieUser ?? null);
  options.seed?.(api.groups);
  const lineLogins: string[] = [];
  const lineShares: string[] = [];

  const line: LineSignIn = {
    isInClient: () => options.insideLine !== undefined,
    autoSignIn: () => Promise.resolve(options.insideLine?.idToken ?? null),
    login: () => {
      lineLogins.push(window.location.href);
      return Promise.resolve();
    },
    share: (text) => {
      lineShares.push(text);
      return Promise.resolve(true);
    },
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
  };

  const deps: AppDeps = {
    fetch: api.fetch,
    line,
    google,
    testSignIn: options.testSignIn ?? false,
  };
  const router = createMemoryRouter(routes, {
    initialEntries: [options.pathFor?.() ?? options.path ?? "/"],
  });
  render(
    <AppProviders
      deps={deps}
      queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { api, router, lineLogins, lineShares };
}
