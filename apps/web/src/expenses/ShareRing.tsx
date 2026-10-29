/** One colour per person, in the order of the list; they repeat past six. */
export const SHARE_COLOURS = [
  "#2e9d71",
  "#f4a261",
  "#5b8def",
  "#e76f51",
  "#8ab17d",
  "#b388eb",
] as const;

const RADIUS = 14;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * A small ring showing each person's share of the Expense. It only echoes the figures next to
 * it (every share is also written out in the list), so it is hidden from screen readers; when
 * the amount or the split changes, each arc slides to its new length.
 */
export function ShareRing({ shares }: { shares: readonly number[] }) {
  const total = shares.reduce((sum, s) => sum + s, 0);
  if (total <= 0) return null;
  let offset = 0;
  return (
    <svg aria-hidden="true" viewBox="0 0 36 36" className="size-7 shrink-0 -rotate-90">
      <circle cx="18" cy="18" r={RADIUS} fill="none" stroke="#e8f5eb" strokeWidth="6" />
      {shares.map((share, i) => {
        const length = (share / total) * CIRCUMFERENCE;
        const arc = (
          <circle
            // The position in the list is the person, so the index is the right key.
            key={i}
            cx="18"
            cy="18"
            r={RADIUS}
            fill="none"
            stroke={SHARE_COLOURS[i % SHARE_COLOURS.length]}
            strokeWidth="6"
            strokeDasharray={`${String(length)} ${String(CIRCUMFERENCE - length)}`}
            strokeDashoffset={-offset}
            className="transition-[stroke-dasharray,stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
          />
        );
        offset += length;
        return arc;
      })}
    </svg>
  );
}

/**
 * A full-width segmented proportion bar whose segments glide smoothly as participants or shares
 * change, giving a clear visual reading of how the Expense is divided.
 */
export function ShareBar({ shares }: { shares: readonly number[] }) {
  const total = shares.reduce((sum, s) => sum + s, 0);
  if (total <= 0) return null;
  return (
    <div
      aria-hidden="true"
      className="flex h-2 w-full overflow-hidden rounded-full bg-sprout-150 p-0.5 gap-0.5"
    >
      {shares.map((share, i) =>
        share > 0 ? (
          <span
            key={i}
            style={{
              flexGrow: share,
              backgroundColor: SHARE_COLOURS[i % SHARE_COLOURS.length],
            }}
            className="h-full rounded-full transition-[flex-grow] duration-300 ease-(--ease-out-expo) motion-reduce:transition-none"
          />
        ) : null,
      )}
    </div>
  );
}
