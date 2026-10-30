import { type ComponentType, lazy, Suspense } from "react";
import {
  Navigate,
  Outlet,
  redirect,
  type RouteObject,
  useLocation,
  useSearchParams,
} from "react-router";
import { useAuth } from "../auth/AuthProvider.js";
import { RouteError } from "./RouteError.js";
import { Loading } from "../groups/ui.js";
import { AppShell } from "../shell/AppShell.js";
import { HomePage } from "../pages/HomePage.js";
import { NotFoundPage } from "../pages/NotFoundPage.js";
import { Splash } from "../shell/Splash.js";
import { TRIP_ENABLED } from "../trip/enabled.js";

const LandingPage = lazy(() =>
  import("../pages/LandingPage.js").then((m) => ({ default: m.LandingPage })),
);
const SignInPage = lazy(() =>
  import("../pages/SignInPage.js").then((m) => ({ default: m.SignInPage })),
);

/** Trip pages while the Trip module is under maintenance: back to the Group. */
function tripOnly({ params }: { params: { id?: string } }) {
  return TRIP_ENABLED ? null : redirect(`/groups/${params.id ?? ""}`);
}

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
    // A chosen sign-out anywhere returns to the landing page, not to sign-in.
    if (state.byChoice === true && location.pathname !== "/") return <Navigate to="/" replace />;
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
      <Suspense fallback={<Loading />}>
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
  { path: "/sign-in", Component: SignInRoute, ErrorBoundary: RouteError },
  // Policy pages are public: linked from sign-in, readable signed in or out.
  {
    path: "/privacy",
    lazy: page(() => import("../pages/LegalPage.js"), "PrivacyPage"),
    ErrorBoundary: RouteError,
  },
  {
    path: "/terms",
    lazy: page(() => import("../pages/LegalPage.js"), "TermsPage"),
    ErrorBoundary: RouteError,
  },
  {
    path: "/",
    Component: Gate,
    ErrorBoundary: RouteError,
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
        loader: ({ params }) => redirect(`/groups/${params.id ?? ""}/members`),
      },
      {
        path: "groups/:id/expenses/new",
        lazy: page(() => import("../pages/NewExpensePage.js"), "NewExpensePage"),
      },
      {
        path: "groups/:id/expenses/:eid",
        lazy: page(() => import("../pages/ExpenseDetailPage.js"), "ExpenseDetailPage"),
      },
      {
        path: "groups/:id/expenses/:eid/edit",
        lazy: page(() => import("../pages/EditExpensePage.js"), "EditExpensePage"),
      },
      {
        path: "groups/:id/trip",
        loader: tripOnly,
        lazy: page(() => import("../pages/TripSettingsPage.js"), "TripSettingsPage"),
      },
      {
        path: "groups/:id/stops/new",
        loader: tripOnly,
        lazy: page(() => import("../pages/StopPage.js"), "NewStopPage"),
      },
      {
        path: "groups/:id/stops/:sid",
        loader: tripOnly,
        lazy: page(() => import("../pages/StopPage.js"), "EditStopPage"),
      },
      { path: "join/:token", lazy: page(() => import("../pages/JoinPage.js"), "JoinPage") },
      { path: "new", lazy: page(() => import("../pages/NewEntryPage.js"), "NewEntryPage") },
      { path: "stats", lazy: page(() => import("../pages/StatsPage.js"), "StatsPage") },
      { path: "settings", lazy: page(() => import("../pages/SettingsPage.js"), "SettingsPage") },
    ],
  },
  { path: "*", Component: NotFoundPage },
];
