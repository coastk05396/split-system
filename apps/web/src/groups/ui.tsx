import { ArrowLeft } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ApiFailure } from "../api/errors.js";
import { errorMessage, t } from "../i18n/messages.js";
import { SproutMark } from "../shell/SproutMark.js";

/** The zh-TW message for a failed call; anything that is not an API answer reads as INTERNAL. */
export function failureMessage(error: unknown): string {
  return errorMessage(error instanceof ApiFailure ? error.code : "INTERNAL");
}

/** A screen title with an optional back arrow, as on screens 3, 6, 9 and 13. */
export function ScreenHeader({
  title,
  back,
  subtitle,
  action,
  compact = false,
  centered = false,
}: {
  title: string;
  back?: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  /** Less room underneath, for a screen whose list should start high. */
  compact?: boolean;
  /** Title in the middle with equal room either side, for a header whose controls are icons. */
  centered?: boolean;
}) {
  if (centered) {
    return (
      <header className={`${compact ? "mb-0" : "mb-6"} flex flex-col items-center gap-1`}>
        <div className="grid w-full grid-cols-[6rem_1fr_6rem] items-center">
          <div className="flex justify-start">
            {back !== undefined && (
              <Link
                to={back}
                aria-label={t("common.back")}
                className="press-icon -ml-1 rounded-full p-1 hover:bg-sprout-150/80"
              >
                <ArrowLeft aria-hidden="true" className="size-6" />
              </Link>
            )}
          </div>
          <h1 className="truncate text-center text-2xl font-bold md:text-3xl">{title}</h1>
          <div className="flex justify-end">{action}</div>
        </div>
        {subtitle !== undefined && <div className="text-sm text-ink-muted">{subtitle}</div>}
      </header>
    );
  }
  return (
    <header className={`${compact ? "mb-2" : "mb-6"} flex flex-col gap-1`}>
      <div className="flex items-center gap-3">
        {back !== undefined && (
          <Link
            to={back}
            aria-label={t("common.back")}
            className="press-icon -ml-1 rounded-full p-1 hover:bg-sprout-150/80"
          >
            <ArrowLeft aria-hidden="true" className="size-6" />
          </Link>
        )}
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold md:text-3xl">{title}</h1>
        {action}
      </div>
      {subtitle !== undefined && <div className="text-sm text-ink-muted">{subtitle}</div>}
    </header>
  );
}

/** A failed load with a retry button (screen 20). */
export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl bg-white p-5">
      <p>{failureMessage(error)}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-full border border-sprout-200 px-5 py-2 font-bold"
      >
        {t("common.retry")}
      </button>
    </div>
  );
}

/** The sprout sways while something loads; the words stay for screen readers. */
export function Loading() {
  return (
    <div role="status" className="flex justify-center py-8">
      <span aria-hidden="true" className="sprout-sway inline-flex">
        <SproutMark className="size-12" />
      </span>
      <span className="sr-only">{t("app.loading")}</span>
    </div>
  );
}

/**
 * A Member's LINE or Google picture in a circle; without one, or when it fails to load, the
 * initial. A Placeholder Member's circle is dashed and never has a picture (decision 31).
 */
export function Avatar({
  name,
  pictureUrl = null,
  placeholder = false,
  className = "size-11",
}: {
  name: string;
  pictureUrl?: string | null;
  placeholder?: boolean;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (pictureUrl !== null && !broken && !placeholder) {
    return (
      <img
        src={pictureUrl}
        alt=""
        aria-hidden="true"
        referrerPolicy="no-referrer"
        onError={() => {
          setBroken(true);
        }}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }
  const first = new Intl.Segmenter().segment(name)[Symbol.iterator]().next();
  const initial = first.done === true ? "?" : first.value.segment.toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full font-bold ${className} ${
        placeholder
          ? "border-2 border-dashed border-sprout-500 text-sprout-600"
          : "bg-sprout-100 text-sprout-700"
      }`}
    >
      {initial}
    </span>
  );
}

export const GROUP_PALETTES = [
  {
    bg: "bg-[#FDE8E1]",
    text: "text-[#D95338]",
    border: "border-[#F7C6B7]",
    shadow: "shadow-[inset_0_1px_1px_rgba(255,255,255,0.85),0_2px_4px_rgba(217,83,56,0.06)]",
  }, // 蜜桃杏粉 (Peach Coral)
  {
    bg: "bg-[#EAF5E9]",
    text: "text-[#2D6A4F]",
    border: "border-[#C8E6C9]",
    shadow: "shadow-[inset_0_1px_1px_rgba(255,255,255,0.85),0_2px_4px_rgba(45,106,79,0.06)]",
  }, // 嫩芽抹茶 (Sprout Matcha)
  {
    bg: "bg-[#E3F2FD]",
    text: "text-[#1976D2]",
    border: "border-[#BBDEFB]",
    shadow: "shadow-[inset_0_1px_1px_rgba(255,255,255,0.85),0_2px_4px_rgba(25,118,210,0.06)]",
  }, // 薄霧天藍 (Mist Sky)
  {
    bg: "bg-[#FEF3D6]",
    text: "text-[#D97706]",
    border: "border-[#FDE68A]",
    shadow: "shadow-[inset_0_1px_1px_rgba(255,255,255,0.85),0_2px_4px_rgba(217,119,6,0.06)]",
  }, // 金橙蜜香 (Honey Citrus)
  {
    bg: "bg-[#F3E8FF]",
    text: "text-[#7E22CE]",
    border: "border-[#E9D5FF]",
    shadow: "shadow-[inset_0_1px_1px_rgba(255,255,255,0.85),0_2px_4px_rgba(126,34,206,0.06)]",
  }, // 薰衣紫藤 (Lavender Lilac)
  {
    bg: "bg-[#E0F2F1]",
    text: "text-[#00796B]",
    border: "border-[#B2DFDB]",
    shadow: "shadow-[inset_0_1px_1px_rgba(255,255,255,0.85),0_2px_4px_rgba(0,121,107,0.06)]",
  }, // 薄荷晨露 (Sea Salt Mint)
] as const;

export function groupPalette(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return GROUP_PALETTES[hash % GROUP_PALETTES.length] ?? GROUP_PALETTES[0];
}

export function groupGlyph(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "群";
  const first = new Intl.Segmenter().segment(trimmed)[Symbol.iterator]().next();
  return first.done === true ? "群" : first.value.segment.toUpperCase();
}

/**
 * A cute, textured Group avatar with the first character/emoji,
 * deterministic pastel theme, and spring touch micro-interactions.
 */
export function GroupAvatar({
  name,
  groupId,
  className = "size-11 text-base",
  interactive = true,
}: {
  name: string;
  groupId: string;
  className?: string;
  interactive?: boolean;
}) {
  const palette = groupPalette(groupId || name);
  const glyph = groupGlyph(name);
  const isEmoji = /\p{Extended_Pictographic}/u.test(glyph);

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-2xl border font-bold ${palette.bg} ${palette.text} ${palette.border} ${palette.shadow} ${
        interactive
          ? "transition-transform duration-300 ease-(--ease-spring) group-hover:scale-105 group-hover:rotate-2 group-active:scale-95 group-active:-rotate-1 motion-reduce:transition-none"
          : ""
      } ${className}`}
    >
      <span className={isEmoji ? "text-[1.15em] leading-none" : "leading-none"}>
        {glyph}
      </span>
    </span>
  );
}

/**
 * An Avatar standing in for a name: tap it and the name floats above for a moment. The name stays
 * on the button's label, and "you" wears a green ring and a small 你 badge.
 */
export function AvatarTip({
  name,
  pictureUrl,
  placeholder = false,
  isMe = false,
  className = "size-10",
}: {
  name: string;
  pictureUrl?: string | null;
  placeholder?: boolean;
  isMe?: boolean;
  className?: string;
}) {
  const [shown, setShown] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );
  const tap = () => {
    window.clearTimeout(timer.current);
    if (shown) {
      setShown(false);
      return;
    }
    setShown(true);
    timer.current = window.setTimeout(() => {
      setShown(false);
    }, 1500);
  };
  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={isMe ? `${name}${t("settle.chartMe")}` : name}
        onClick={tap}
        className={`press-icon rounded-full ${isMe ? "ring-2 ring-sprout-500 ring-offset-2" : ""}`}
      >
        <Avatar
          name={name}
          pictureUrl={pictureUrl ?? null}
          placeholder={placeholder}
          className={className}
        />
      </button>
      {isMe && (
        <span
          aria-hidden="true"
          className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-sprout-500 text-[10px] leading-none font-bold text-white"
        >
          {t("settle.you")}
        </span>
      )}
      {shown && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-0 bottom-full left-0 z-10 mb-1.5 flex justify-center"
        >
          <span className="swap-in rounded-full bg-ink px-2.5 py-1 text-xs font-bold whitespace-nowrap text-white shadow-md">
            {name}
          </span>
        </span>
      )}
    </span>
  );
}

export const primaryButton =
  "press-pill flex items-center justify-center gap-2 rounded-full bg-sprout-500 px-6 py-4 font-bold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_6px_14px_-8px_#143f2a] hover:bg-sprout-500/90 disabled:opacity-50";
export const secondaryButton =
  "press-pill flex items-center justify-center gap-2 rounded-full border border-sprout-200 bg-white px-6 py-4 font-bold shadow-[inset_0_1px_0_0_rgb(255_255_255/0.9)] hover:border-sprout-500 disabled:opacity-50";
/** The red tag on every Trip entry while the Trip module is under maintenance. */
export function MaintenanceTag() {
  return (
    <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
      {t("trip.maintenance")}
    </span>
  );
}
export const card = "surface-card rounded-[1.75rem] border border-sprout-200/80 bg-white";
export const input =
  "w-full rounded-2xl border border-sprout-200 bg-white px-4 py-3 outline-none transition-[border-color,box-shadow] duration-180 focus:border-sprout-500 focus:ring-3 focus:ring-sprout-500/15";
