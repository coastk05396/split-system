import { type ComponentType, lazy, Suspense } from "react";
import { Navigate, Outlet, type RouteObject, useLocation, useSearchParams } from "react-router";
import { useAuth } from "../auth/AuthProvider.js";
import { t } from "../i18n/messages.js";
import { AppShell } from "../shell/AppShell.js";
import { HomePage } from "../pages/HomePage.js";
import { NotFoundPage } from "../pages/NotFoundPage.js";
import { Splash } from "../shell/Splash.js";

const LandingPage = lazy(() =>
  import("../pages/LandingPage.js").then((m) => ({ default: m.LandingPage })),
);
const SignInPage = lazy(() =>
  import("../pages/SignInPage.js").then((m) => ({ default: m.SignInPage })),
);

/** Where to go after sign-in: only same-site paths, never another origin. */
export function safeNext(next: string | null): string {
  return next !== null && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

/** Signed in: the app. Signed out: the landing page at `/`, sign-in everywhere else. */
function Gate() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === "loading") return <Splash />;
  if (state.status === "signedOut") {
    if (location.pathname === "/") {
      return (
        <Suspense fallback={<Splash />}>
          <LandingPage />
        </Suspense>
      );
    }
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/sign-in?next=${next}`} replace />;
  }
  return (
    <AppShell>
      <Suspense fallback={<p className="p-6 text-ink-muted">{t("app.loading")}</p>}>
        <Outlet />
      </Suspense>
    </AppShell>
  );
}

function SignInRoute() {
  const { state } = useAuth();
  const [params] = useSearchParams();
  if (state.status === "loading") return <Splash />;
  if (state.status === "signedIn") return <Navigate to={safeNext(params.get("next"))} replace />;
  return (
    <Suspense fallback={<Splash />}>
      <SignInPage />
    </Suspense>
  );
}

function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return async () => ({ Component: (await load())[name] });
}

export const routes: RouteObject[] = [
  { path: "/sign-in", Component: SignInRoute },
  {
    path: "/",
    Component: Gate,
    children: [
      { index: true, Component: HomePage },
      { path: "groups", lazy: page(() => import("../pages/GroupsPage.js"), "GroupsPage") },
      { path: "groups/new", lazy: page(() => import("../pages/NewGroupPage.js"), "NewGroupPage") },
      { path: "groups/:id", lazy: page(() => import("../pages/GroupPage.js"), "GroupPage") },
      {
        path: "groups/:id/members",
        lazy: page(() => import("../pages/MembersPage.js"), "MembersPage"),
      },
      {
        path: "groups/:id/invite",
        lazy: page(() => import("../pages/InvitePage.js"), "InvitePage"),
      },
      { path: "join/:token", lazy: page(() => import("../pages/JoinPage.js"), "JoinPage") },
      { path: "new", lazy: page(() => import("../pages/NewEntryPage.js"), "NewEntryPage") },
      { path: "stats", lazy: page(() => import("../pages/StatsPage.js"), "StatsPage") },
      { path: "settings", lazy: page(() => import("../pages/SettingsPage.js"), "SettingsPage") },
    ],
  },
  { path: "*", Component: NotFoundPage },
];
