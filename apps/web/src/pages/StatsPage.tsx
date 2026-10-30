import { type CurrencyCode, convertBalance, formatAmount, RATE_SCALE } from "@split/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../auth/AuthProvider.js";
import { useRates } from "../expenses/api.js";
import { localNow } from "../expenses/expense-draft.js";
import { read } from "../groups/api.js";
import { card, LoadError, Loading } from "../groups/ui.js";
import { categoryLabel } from "../i18n/format.js";
import { getLocale, t } from "../i18n/messages.js";
import { SproutMark } from "../shell/SproutMark.js";
import { CountUp } from "../shell/CountUp.js";

type SpendingRow = { month: string; category: string; currency: CurrencyCode; amount: number };
type Detail = {
  id: string;
  groupId: string;
  groupName: string;
  description: string;
  date: string;
  currency: CurrencyCode;
  amount: number;
};
const COLOURS = ["#2e9d71", "#f4a261", "#5b8def", "#d57491", "#8ab17d", "#a68bd4", "#e2ad42"];

function recentMonths(now: Date): string[] {
  return Array.from({ length: 6 }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
}

function monthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(getLocale() === "en" ? "en" : "zh-TW", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year ?? 0, (m ?? 1) - 1, 1)));
}

function CategoryExpenses({ month, category }: { month: string; category: string }) {
  const { session, state } = useAuth();
  const query = useInfiniteQuery({
    queryKey: [
      "stats",
      "expenses",
      state.status === "signedIn" ? state.user.id : null,
      month,
      category,
    ],
    staleTime: 0,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ month, category });
      if (pageParam !== undefined) params.set("cursor", pageParam);
      return read<{ items: Detail[]; nextCursor: string | null }>(
        session.fetch(`/api/v1/stats/expenses?${params.toString()}`),
      );
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <LoadError error={query.error} onRetry={() => void query.refetch()} />;
  return (
    <div className="mt-5 border-t border-sprout-100 pt-4">
      <h3 className="font-bold">{t("stats.details", { category: categoryLabel(category) })}</h3>
      <p className="mt-1 text-xs text-ink-muted">{t("stats.detailsCurrency")}</p>
      <ul className="mt-3 space-y-1">
        {query.data.pages
          .flatMap((page) => page.items)
          .map((item) => (
            <li key={item.id}>
              <Link
                to={`/groups/${item.groupId}/expenses/${item.id}`}
                className="flex items-center justify-between gap-3 rounded-xl px-2 py-3 hover:bg-sprout-50 focus-visible:outline-2 focus-visible:outline-sprout-600"
              >
                <span className="min-w-0">
                  <span className="block truncate font-bold">{item.description}</span>
                  <span className="block truncate text-xs text-ink-muted">
                    {item.groupName} · {item.date}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-bold tabular-nums">
                  {formatAmount(item.amount, item.currency)}
                </span>
              </Link>
            </li>
          ))}
      </ul>
      {query.hasNextPage && (
        <button
          type="button"
          disabled={query.isFetchingNextPage}
          className="mt-2 rounded-full px-3 py-2 text-sm font-bold text-sprout-700"
          onClick={() => void query.fetchNextPage()}
        >
          {t("stats.more")}
        </button>
      )}
    </div>
  );
}

export function StatsPage() {
  const ringMask = useId();
  const { session, state } = useAuth();
  const preferred = state.status === "signedIn" ? state.user.preferredCurrency : "TWD";
  const [months] = useState(() => recentMonths(new Date()));
  const [selectedMonth, setSelectedMonth] = useState(() => months[5] ?? "");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [interacted, setInteracted] = useState(false);
  const query = useQuery({
    queryKey: [
      "stats",
      "spending",
      state.status === "signedIn" ? state.user.id : null,
      months[0],
      months[5],
    ],
    staleTime: 0,
    queryFn: () =>
      read<SpendingRow[]>(
        session.fetch(
          `/api/v1/stats/spending?${new URLSearchParams({ from: months[0] ?? "", to: months[5] ?? "" }).toString()}`,
        ),
      ),
  });
  const rows = (query.data ?? []).filter((row) => months.includes(row.month) && row.amount > 0);
  const bases = [...new Set(rows.map((row) => row.currency).filter((c) => c !== preferred))];
  const rates = useRates(localNow(new Date()).date, preferred, bases);
  const rateDates = [
    ...new Set(rates.flatMap((rate) => (rate.data ? [rate.data.rateDate] : []))),
  ].sort();
  const rateByCurrency = new Map(
    bases.flatMap((base, i) => {
      const rate = rates[i]?.data;
      return rate === undefined ? [] : [[base, rate.rateScaled] as const];
    }),
  );
  const ratePending = rates.some((rate) => rate.isPending);
  const converted = rows.map((row) => {
    const rate = row.currency === preferred ? RATE_SCALE : rateByCurrency.get(row.currency);
    if (rate === undefined) return null;
    const result = convertBalance(row.amount, row.currency, preferred, rate);
    return result.ok ? { ...row, amount: result.value } : null;
  });
  const unavailable = converted.some((row) => row === null);
  const data = converted.filter((row): row is NonNullable<typeof row> => row !== null);
  const totals = months.map((month) =>
    data.filter((row) => row.month === month).reduce((sum, row) => sum + row.amount, 0),
  );
  const max = Math.max(0, ...totals);
  const categories = [
    ...data
      .filter((row) => row.month === selectedMonth)
      .reduce((map, row) => {
        map.set(row.category, (map.get(row.category) ?? 0) + row.amount);
        return map;
      }, new Map<string, number>()),
  ]
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = categories.reduce((sum, [, amount]) => sum + amount, 0);
  let offset = 0;
  const segments = categories.map(([, amount], i) => {
    const start = offset;
    offset += (amount / total) * 100;
    return { start, length: offset - start, color: COLOURS[i % COLOURS.length] };
  });

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5 pb-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">{t("stats.title")}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t("stats.subtitle")}</p>
        </div>
        <SproutMark className="size-12" />
      </header>
      {query.isError ? (
        <LoadError error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isPending || ratePending ? (
        <Loading />
      ) : unavailable ? (
        <section className={`${card} p-5`} role="alert">
          <p>{t("stats.rateFailed")}</p>
          <button
            type="button"
            className="press-pill mt-3 rounded-full bg-sprout-500 px-5 py-2 font-bold text-white"
            onClick={() => {
              for (const rate of rates) void rate.refetch();
            }}
          >
            {t("stats.retry")}
          </button>
        </section>
      ) : (
        <>
          <section className="surface-card rounded-3xl border border-orange-100 bg-peach p-6 text-ink">
            <p className="text-sm text-ink-muted">
              {monthLabel(selectedMonth)} · {t("stats.total")}
            </p>
            <p className="mt-2 text-3xl font-bold tabular-nums">
              <span className="sr-only">{formatAmount(total, preferred)}</span>
              <span aria-hidden="true">
                {interacted ? (
                  formatAmount(total, preferred)
                ) : (
                  <CountUp value={total} format={(n) => formatAmount(n, preferred)} />
                )}
              </span>
            </p>
            <p className="mt-3 text-xs text-ink-muted">{t("stats.scope")}</p>
          </section>
          <section className={`${card} p-5`} aria-labelledby="stats-months">
            <h2 id="stats-months" className="text-lg font-bold">
              {t("stats.months")}
            </h2>
            <div
              className="mt-5 grid grid-cols-6 gap-1"
              role="group"
              aria-label={t("stats.months")}
            >
              {months.map((month, i) => {
                const amount = totals[i] ?? 0;
                const selected = month === selectedMonth;
                return (
                  <button
                    key={month}
                    type="button"
                    aria-pressed={selected}
                    aria-label={`${monthLabel(month)}: ${formatAmount(amount, preferred)}`}
                    onClick={() => {
                      setSelectedMonth(month);
                      setSelectedCategory(null);
                      setInteracted(true);
                    }}
                    className="press-pill group flex min-w-0 flex-col items-center gap-2 rounded-xl px-0.5 py-2 focus-visible:outline-2 focus-visible:outline-sprout-600"
                  >
                    <span className="flex h-28 w-full items-end justify-center rounded-xl bg-sprout-50">
                      <span
                        className={`${interacted ? "" : "stats-bar-enter"} w-5 max-w-full rounded-t-lg ${selected ? "bg-sprout-500" : "bg-sprout-200"}`}
                        style={{ height: `${String(max === 0 ? 0 : (amount / max) * 100)}%` }}
                      />
                    </span>
                    <span
                      className={`text-center text-xs ${selected ? "font-bold text-sprout-700" : "text-ink-muted"}`}
                    >
                      {getLocale() === "en" ? monthLabel(month) : `${Number(month.slice(5))}月`}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
          <section className={`${card} p-5`} aria-labelledby="stats-categories">
            <h2 id="stats-categories" className="text-lg font-bold">
              {t("stats.categories")}
            </h2>
            {total === 0 ? (
              <p className="py-8 text-center text-sm text-ink-muted">
                {data.length === 0 ? t("stats.noData") : t("stats.empty")}
              </p>
            ) : (
              <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row">
                <div
                  aria-hidden="true"
                  className="relative flex size-40 shrink-0 items-center justify-center"
                >
                  <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
                    <defs>
                      <mask
                        id={ringMask}
                        maskUnits="userSpaceOnUse"
                        x="0"
                        y="0"
                        width="100"
                        height="100"
                      >
                        <circle
                          cx="50"
                          cy="50"
                          r="42"
                          pathLength="100"
                          fill="none"
                          stroke="white"
                          strokeWidth="16"
                          strokeDasharray="100 100"
                          strokeDashoffset="0"
                          transform="rotate(-90 50 50)"
                          className={interacted ? undefined : "stats-ring-enter"}
                        />
                      </mask>
                    </defs>
                    <g mask={`url(#${ringMask})`} transform="rotate(-90 50 50)">
                      {segments.map((segment, i) => (
                        <circle
                          key={categories[i]?.[0]}
                          cx="50"
                          cy="50"
                          r="42"
                          pathLength="100"
                          fill="none"
                          stroke={segment.color}
                          strokeWidth="16"
                          strokeDasharray={`${String(segment.length)} ${String(100 - segment.length)}`}
                          strokeDashoffset={-segment.start}
                        />
                      ))}
                    </g>
                  </svg>
                  <div className="relative flex size-28 flex-col items-center justify-center rounded-full bg-white text-center">
                    <span className="text-xs text-ink-muted">
                      {selectedCategory === null
                        ? t("stats.total")
                        : categoryLabel(selectedCategory)}
                    </span>
                    <span className="max-w-24 break-all text-sm font-bold">
                      {interacted ? (
                        formatAmount(
                          selectedCategory === null
                            ? total
                            : (categories.find(([name]) => name === selectedCategory)?.[1] ?? 0),
                          preferred,
                        )
                      ) : (
                        <CountUp value={total} format={(n) => formatAmount(n, preferred)} />
                      )}
                    </span>
                  </div>
                </div>
                <ul className="w-full flex-1 space-y-1">
                  {categories.map(([name, amount], i) => (
                    <li key={name}>
                      <button
                        type="button"
                        aria-pressed={selectedCategory === name}
                        onClick={() => {
                          setSelectedCategory(selectedCategory === name ? null : name);
                          setInteracted(true);
                        }}
                        className={`press-pill flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left focus-visible:outline-2 focus-visible:outline-sprout-600 ${selectedCategory === name ? "bg-sprout-50" : ""}`}
                      >
                        <span
                          aria-hidden="true"
                          className="size-3 shrink-0 rounded-full"
                          style={{ backgroundColor: COLOURS[i % COLOURS.length] }}
                        />
                        <span className="min-w-0 flex-1 truncate font-bold">
                          {categoryLabel(name)}
                        </span>
                        <span className="text-xs text-ink-muted">
                          {Math.round((amount / total) * 100)}%
                        </span>
                        <span className="text-sm tabular-nums">
                          {formatAmount(amount, preferred)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          {selectedCategory !== null && (
            <section className={`${card} px-5 pb-5`}>
              <CategoryExpenses month={selectedMonth} category={selectedCategory} />
            </section>
          )}
          {bases.length > 0 && (
            <p className="text-xs text-ink-muted">
              {t("stats.rates")} {rateDates.join("、")}
            </p>
          )}
          {data.length === 0 && (
            <Link to="/new" className="self-center text-sm font-bold text-sprout-700 underline">
              {t("expense.new")}
            </Link>
          )}
        </>
      )}
    </div>
  );
}
