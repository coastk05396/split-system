import { ChartColumn, House, type LucideIcon, Plus, Settings, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { type MessageId, t } from "../i18n/messages.js";
import { SproutMark } from "./SproutMark.js";

interface Tab {
  to: string;
  label: MessageId;
  icon: LucideIcon;
}

/** SPEC §6: the same five destinations on every screen size. */
const TABS: readonly Tab[] = [
  { to: "/", label: "nav.home", icon: House },
  { to: "/groups", label: "nav.groups", icon: Users },
  { to: "/new", label: "nav.new", icon: Plus },
  { to: "/stats", label: "nav.stats", icon: ChartColumn },
  { to: "/settings", label: "nav.settings", icon: Settings },
];

const SIDEBAR_TABS = TABS.filter((tab) => tab.to !== "/new");

function BottomBar() {
  return (
    <nav
      aria-label={t("nav.bottom")}
      className="fixed inset-x-0 bottom-0 z-10 border-t border-sprout-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="mx-auto grid h-16 max-w-md grid-cols-5">
        {TABS.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex">
            <NavLink
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium select-none ${
                  isActive ? "text-sprout-600" : "text-ink-muted"
                }`
              }
            >
              {to === "/new" ? (
                <span className="-mt-5 flex size-12 items-center justify-center rounded-full bg-sprout-500 text-white shadow-md">
                  <Icon aria-hidden="true" className="size-6" />
                </span>
              ) : (
                <Icon aria-hidden="true" className="size-5" />
              )}
              {t(label)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-sprout-900 px-4 py-7 text-white md:flex">
      <Link to="/" className="mb-8 flex items-center gap-3 px-2">
        <SproutMark className="size-9" />
        <span className="text-xl font-bold">{t("app.name")}</span>
      </Link>
      <nav aria-label={t("nav.side")}>
        <ul className="flex flex-col gap-1">
          {SIDEBAR_TABS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-4 py-3 text-[15px] ${
                    isActive ? "bg-sprout-600 font-bold" : "text-white/85 hover:bg-white/10"
                  }`
                }
              >
                <Icon aria-hidden="true" className="size-5" />
                {t(label)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Link
        to="/new"
        className="mt-6 flex items-center justify-center gap-2 rounded-full bg-sprout-500 px-4 py-3 font-bold hover:bg-sprout-500/90"
      >
        <Plus aria-hidden="true" className="size-5" />
        {t("nav.newExpense")}
      </Link>
    </aside>
  );
}

/** Mobile: content above a five-tab bottom bar. Desktop: a sidebar beside the content. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh md:flex">
      <Sidebar />
      <main className="min-w-0 flex-1 pb-24 md:pb-0">
        <div className="mx-auto w-full max-w-5xl px-5 pt-8 md:px-12 md:pt-12">{children}</div>
      </main>
      <BottomBar />
    </div>
  );
}
