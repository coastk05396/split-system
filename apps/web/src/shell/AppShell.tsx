import { Plus } from "lucide-react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router";
import { type MessageId, t } from "../i18n/messages.js";
import { CuteTripPlaneIcon } from "../pages/HomeIcons.js";
import { hapticTick } from "./haptics.js";
import { CuteHomeIcon, CuteSettingsIcon, CuteStatsIcon, type NavIconProps } from "./NavIcons.js";
import { SelectionPill } from "./SelectionPill.js";
import { SproutMascot } from "./SproutMascot.js";

type Tab =
  | {
      to: string;
      label: MessageId;
      icon: ComponentType<NavIconProps>;
      isAction?: false;
    }
  | {
      action: "tripNotice";
      label: MessageId;
      icon: ComponentType<SVGProps<SVGSVGElement>>;
      isAction: true;
    };

/** SPEC §6: the same five destinations/actions on every screen size. */
const TABS: readonly Tab[] = [
  { to: "/", label: "nav.home", icon: CuteHomeIcon },
  { action: "tripNotice", label: "nav.trip", icon: CuteTripPlaneIcon, isAction: true },
  { to: "/new", label: "nav.new", icon: Plus },
  { to: "/stats", label: "nav.stats", icon: CuteStatsIcon },
  { to: "/settings", label: "nav.settings", icon: CuteSettingsIcon },
];

const SIDEBAR_TABS = TABS.filter((tab) => tab.label !== "nav.new");

function BottomBar({ onTripClick }: { onTripClick: () => void }) {
  return (
    <nav
      aria-label={t("nav.bottom")}
      className="glass-nav fixed inset-x-0 bottom-0 z-10 border-t border-sprout-200/80 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="mx-auto grid h-17 max-w-md grid-cols-5">
        {TABS.map((tab) => (
          <li key={tab.label} className="flex">
            {tab.isAction ? (
              <button
                type="button"
                onClick={onTripClick}
                className="press-pill group relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium text-ink-muted select-none focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-sprout-700 cursor-pointer"
              >
                <tab.icon
                  aria-hidden="true"
                  className="relative size-5.5 transition-transform duration-200 ease-(--ease-spring) motion-reduce:transition-none"
                />
                <span className="relative">{t(tab.label)}</span>
              </button>
            ) : (
              <NavLink
                to={tab.to}
                end={tab.to === "/"}
                onPointerDown={tab.to === "/new" ? () => hapticTick(15) : undefined}
                className={({ isActive }) =>
                  `group relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium select-none focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-sprout-700 ${
                    tab.to === "/new" ? "" : "press-pill"
                  } ${isActive ? "font-bold text-sprout-700" : "text-ink-muted"}`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && tab.to !== "/new" && (
                      <SelectionPill
                        layoutId="bottom-navigation-selection"
                        className="top-1 h-9 w-14 rounded-2xl border border-sprout-200/90 bg-sprout-150/85 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.8),0_3px_8px_-7px_#143f2a]"
                      />
                    )}
                    {tab.to === "/new" ? (
                      <span
                        className={`relative -mt-5 flex size-12 items-center justify-center rounded-full text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.3),0_6px_14px_-6px_#143f2a] transition-all duration-300 ease-(--ease-spring) active:scale-[0.85] active:-rotate-3 active:shadow-[0_0_0_8px_rgba(46,157,113,0.25)] group-active:scale-[0.85] group-active:-rotate-3 group-active:shadow-[0_0_0_8px_rgba(46,157,113,0.25)] motion-reduce:transition-none motion-reduce:transform-none ${isActive ? "bg-sprout-600" : "bg-sprout-500"}`}
                      >
                        <tab.icon aria-hidden="true" className="size-6" />
                      </span>
                    ) : (
                      <tab.icon
                        aria-hidden="true"
                        active={isActive}
                        strokeWidth={isActive ? 2.4 : 1.9}
                        className={`relative size-5.5 transition-transform duration-200 ease-(--ease-spring) motion-reduce:transition-none ${
                          isActive
                            ? "-translate-y-0.5 scale-[1.1] nav-icon-pop motion-reduce:translate-y-0 motion-reduce:scale-100"
                            : ""
                        }`}
                      />
                    )}
                    <span className="relative">{t(tab.label)}</span>
                  </>
                )}
              </NavLink>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Sidebar({ onTripClick }: { onTripClick: () => void }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-sprout-900 px-4 py-7 text-white md:flex">
      <Link to="/" className="mb-8 flex items-center gap-3 px-2">
        <SproutMascot className="size-8" mood="happy" interactive={false} />
        <span className="text-xl font-bold">{t("app.name")}</span>
      </Link>
      <nav aria-label={t("nav.side")}>
        <ul className="flex flex-col gap-1">
          {SIDEBAR_TABS.map((tab) => (
            <li key={tab.label}>
              {tab.isAction ? (
                <button
                  type="button"
                  onClick={onTripClick}
                  className="press-pill relative flex w-full items-center gap-3 rounded-xl px-4 py-3 text-[15px] text-white/85 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white cursor-pointer"
                >
                  <tab.icon aria-hidden="true" className="relative size-5" />
                  <span className="relative">{t(tab.label)}</span>
                </button>
              ) : (
                <NavLink
                  to={tab.to}
                  end={tab.to === "/"}
                  className={({ isActive }) =>
                    `press-pill relative flex items-center gap-3 rounded-xl px-4 py-3 text-[15px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
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
                      <tab.icon aria-hidden="true" active={isActive} className="relative size-5" />
                      <span className="relative">{t(tab.label)}</span>
                    </>
                  )}
                </NavLink>
              )}
            </li>
          ))}
        </ul>
      </nav>
      <Link
        to="/new"
        className="press-pill mt-6 flex items-center justify-center gap-2 rounded-full bg-sprout-500 px-4 py-3 font-bold shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25)] hover:bg-sprout-500/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <Plus aria-hidden="true" className="size-5" />
        {t("nav.newExpense")}
      </Link>
    </aside>
  );
}

function getToastTopOffset(toast: HTMLElement): number {
  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 768;
  const computed = typeof window !== "undefined" ? window.getComputedStyle(toast) : null;
  const parsedBottom = computed ? parseFloat(computed.bottom) : NaN;
  const baseBottom = Number.isFinite(parsedBottom) ? parsedBottom : isDesktop ? 32 : 96;
  const layoutHeight = toast.offsetHeight || toast.getBoundingClientRect().height || 68;

  let distFromBottom = baseBottom + layoutHeight;

  if (typeof window !== "undefined" && computed) {
    const rect = toast.getBoundingClientRect();
    if (rect.height > 0 && rect.top !== 0) {
      let translateY = 0;
      if (computed.transform && computed.transform !== "none") {
        try {
          if (typeof DOMMatrixReadOnly !== "undefined") {
            const matrix = new DOMMatrixReadOnly(computed.transform);
            translateY = matrix.m42 || matrix.f || 0;
          } else {
            const match = computed.transform.match(/matrix\(([^)]+)\)/);
            const inner = match?.[1];
            if (inner) {
              const parts = inner.split(",").map((s) => parseFloat(s.trim()));
              const dy = parts[5];
              if (typeof dy === "number" && Number.isFinite(dy)) {
                translateY = dy;
              }
            }
          }
        } catch {
          // ignore matrix parsing errors and fall back to layout geometry
        }
      }
      const settledTop = rect.top - translateY;
      const measuredDist = window.innerHeight - settledTop;
      if (Number.isFinite(measuredDist) && measuredDist > 0) {
        distFromBottom = Math.max(distFromBottom, measuredDist);
      }
    }
  }

  return distFromBottom + 8;
}

function useExistingToastOffset(active: boolean, triggerKey: number): number | null {
  const [offset, setOffset] = useState<number | null>(null);

  useEffect(() => {
    if (!active || typeof document === "undefined") {
      setOffset(null);
      return;
    }

    let resizeObserver: ResizeObserver | null = null;
    let observedToast: HTMLElement | null = null;

    function sync() {
      const otherToast = document.querySelector<HTMLElement>(".saved-toast:not(.trip-notice)");

      if (!otherToast) {
        setOffset(null);
        if (observedToast && resizeObserver) {
          resizeObserver.unobserve(observedToast);
          observedToast = null;
        }
        return;
      }

      if (otherToast !== observedToast) {
        if (observedToast && resizeObserver) {
          resizeObserver.unobserve(observedToast);
        }
        observedToast = otherToast;
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = resizeObserver ?? new ResizeObserver(sync);
          resizeObserver.observe(otherToast);
        }
      }

      setOffset(getToastTopOffset(otherToast));
    }

    sync();

    window.addEventListener("resize", sync);

    let mutationObserver: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined") {
      mutationObserver = new MutationObserver(() => {
        sync();
      });
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }

    return () => {
      window.removeEventListener("resize", sync);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
    };
  }, [active, triggerKey]);

  return offset;
}

/** Mobile: content above a five-tab bottom bar. Desktop: a sidebar beside the content. */
export function AppShell({ children }: { children: ReactNode }) {
  const [showTripNotice, setShowTripNotice] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [triggerKey, setTriggerKey] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastOffset = useExistingToastOffset(showTripNotice, triggerKey);

  const triggerTripNotice = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    setIsLeaving(false);
    setShowTripNotice(true);
    setTriggerKey((k) => k + 1);

    timerRef.current = setTimeout(() => {
      setIsLeaving(true);
      exitTimerRef.current = setTimeout(() => {
        setShowTripNotice(false);
        setIsLeaving(false);
      }, 200);
    }, 2500);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, []);

  return (
    <div className="min-h-dvh md:flex">
      <Sidebar onTripClick={triggerTripNotice} />
      <main className="min-w-0 flex-1 pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <div className="mx-auto w-full max-w-5xl px-5 pt-4 md:px-12 md:pt-12">{children}</div>
      </main>
      <BottomBar onTripClick={triggerTripNotice} />
      {showTripNotice && (
        <div
          role="status"
          aria-live="polite"
          data-testid="trip-notice"
          style={toastOffset != null ? { bottom: `${toastOffset}px` } : undefined}
          className={`saved-toast trip-notice ${toastOffset != null ? "is-stacked" : "bottom-24 md:bottom-8"} ${isLeaving ? "is-leaving" : ""} fixed inset-x-0 z-40 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-2 rounded-full bg-sprout-900 px-5 py-3 text-sm font-bold text-white shadow-lg transition-[bottom] duration-200`}
        >
          <SproutMascot className="size-5 shrink-0" mood="cheer" interactive={false} />
          <span>{t("nav.tripComingSoon")}</span>
        </div>
      )}
    </div>
  );
}
