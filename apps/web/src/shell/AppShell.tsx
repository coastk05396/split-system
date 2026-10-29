import { ChartColumn, House, type LucideIcon, Plus, Settings, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { type MessageId, t } from "../i18n/messages.js";
import { SelectionPill } from "./SelectionPill.js";
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
      className="fixed inset-x-0 bottom-0 z-10 border-t border-sprout-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-22px_#143f2a] md:hidden"
    >
      <ul className="mx-auto grid h-17 max-w-md grid-cols-5">
        {TABS.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex">
            <NavLink
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium select-none focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-sprout-700 ${
                  isActive ? "font-bold text-sprout-700" : "text-ink-muted"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && to !== "/new" && (
                    <SelectionPill
                      layoutId="bottom-navigation-selection"
                      className="top-1 h-9 w-14 rounded-2xl border border-sprout-200 bg-sprout-150 shadow-[0_3px_8px_-7px_#143f2a]"
                    />
                  )}
                  {to === "/new" ? (
                    <span
                      className={`relative -mt-5 flex size-12 items-center justify-center rounded-full text-white shadow-[0_5px_12px_-6px_#143f2a] transition-[background-color,transform] duration-150 active:scale-[0.93] motion-reduce:active:scale-100 ${isActive ? "bg-sprout-600" : "bg-sprout-500"}`}
                    >
                      <Icon aria-hidden="true" className="size-6" />
                    </span>
                  ) : (
                    <Icon
                      aria-hidden="true"
                      strokeWidth={isActive ? 2.5 : 2}
                      className={`relative size-5 transition-transform duration-150 motion-reduce:transition-none ${isActive ? "-translate-y-0.5 scale-[1.08] motion-reduce:translate-y-0 motion-reduce:scale-100" : ""}`}
                    />
                  )}
                  <span className="relative">{t(label)}</span>
                </>
              )}
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
                  `relative flex items-center gap-3 rounded-xl px-4 py-3 text-[15px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                    isActive ? "font-bold" : "text-white/85 hover:bg-white/10"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <SelectionPill
                        layoutId="side-navigation-selection"
                        className="inset-0 rounded-xl bg-sprout-600"
                      />
                    )}
                    <Icon aria-hidden="true" className="relative size-5" />
                    <span className="relative">{t(label)}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Link
        to="/new"
        className="mt-6 flex items-center justify-center gap-2 rounded-full bg-sprout-500 px-4 py-3 font-bold transition-[background-color,transform] hover:bg-sprout-500/90 active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
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
