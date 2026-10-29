import { ArrowLeft } from "lucide-react";
import { type ReactNode, useState } from "react";
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
}: {
  title: string;
  back?: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  /** Less room underneath, for a screen whose list should start high. */
  compact?: boolean;
}) {
  return (
    <header className={`${compact ? "mb-2" : "mb-6"} flex flex-col gap-1`}>
      <div className="flex items-center gap-3">
        {back !== undefined && (
          <Link to={back} aria-label={t("common.back")} className="-ml-1 rounded-full p-1">
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

export const primaryButton =
  "flex items-center justify-center gap-2 rounded-full bg-sprout-500 px-6 py-4 font-bold text-white hover:bg-sprout-500/90 transition-transform active:scale-[0.98] motion-reduce:active:scale-100 disabled:opacity-50";
export const secondaryButton =
  "flex items-center justify-center gap-2 rounded-full border border-sprout-200 bg-white px-6 py-4 font-bold hover:border-sprout-500 transition-transform active:scale-[0.98] motion-reduce:active:scale-100 disabled:opacity-50";
/** The red tag on every Trip entry while the Trip module is under maintenance. */
export function MaintenanceTag() {
  return (
    <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
      {t("trip.maintenance")}
    </span>
  );
}
export const card = "rounded-3xl border border-sprout-200 bg-white";
export const input =
  "w-full rounded-2xl border border-sprout-200 bg-white px-4 py-3 outline-none focus:border-sprout-500";
