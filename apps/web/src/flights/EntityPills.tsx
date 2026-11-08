import { formatAmount, type FlightSearchIntent } from "@split/shared";
import { t } from "../i18n/messages.js";

/**
 * The summary of the current search. Every pill opens or closes the editing panel; the optional
 * conditions (budget, theme, rules) can also be removed with their own button.
 */
export function EntityPills({
  intent,
  pending,
  open,
  onToggle,
  onChange,
}: {
  intent: FlightSearchIntent;
  pending: boolean;
  open: boolean;
  onToggle: () => void;
  onChange: (intent: FlightSearchIntent) => void;
}) {
  const { budget: _budget, ...withoutBudget } = intent;
  const { theme: _theme, ...withoutTheme } = intent;
  const pills: { id: string; text: string; remove?: () => void; removeLabel?: string }[] = [
    ...(intent.budget !== undefined
      ? [
          {
            id: "budget",
            text: `${t("flight.budgetShort")}: ${formatAmount(intent.budget, intent.currency)}`,
            remove: () => {
              onChange(withoutBudget);
            },
            removeLabel: t("flight.removeBudget"),
          },
        ]
      : []),
    ...(intent.theme
      ? [
          {
            id: "theme",
            text: t(`flight.theme.${intent.theme}`),
            remove: () => {
              onChange(withoutTheme);
            },
            removeLabel: t("flight.removeTheme"),
          },
        ]
      : []),
    ...(intent.excludeRedEye
      ? [
          {
            id: "excludeRedEye",
            text: t("flight.excludes"),
            remove: () => {
              onChange({ ...intent, excludeRedEye: false });
            },
            removeLabel: t("flight.removeRedEye"),
          },
        ]
      : []),
    ...(intent.directOnly
      ? [
          {
            id: "directOnly",
            text: t("flight.direct"),
            remove: () => {
              onChange({ ...intent, directOnly: false });
            },
            removeLabel: t("flight.removeDirect"),
          },
        ]
      : []),
  ];
  if (pills.length === 0) return null;
  return (
    <section aria-label={t("flight.conditions")} className="flex flex-wrap gap-2">
      {pills.map((pill) => (
        <span
          key={pill.id}
          className="glass-chip inline-flex max-w-full overflow-hidden rounded-full border border-sprout-200 text-sm"
        >
          <button
            type="button"
            disabled={pending}
            aria-expanded={open}
            onClick={onToggle}
            className="press-pill min-h-11 min-w-0 truncate whitespace-nowrap px-3 py-2 font-bold tabular-nums focus-visible:outline-2 focus-visible:outline-sprout-700"
          >
            {pill.text}
          </button>
          {pill.remove && (
            <button
              type="button"
              disabled={pending}
              aria-label={pill.removeLabel}
              onClick={pill.remove}
              className="min-h-11 min-w-11 px-3 py-2 hover:bg-sprout-150 focus-visible:outline-2 focus-visible:outline-sprout-700"
            >
              ×
            </button>
          )}
        </span>
      ))}
    </section>
  );
}
