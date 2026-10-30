import { Sprout } from "lucide-react";

/** The group an Expense is being recorded in. */
export function ExpenseGroupBadge({ name }: { name: string }) {
  return (
    <span
      title={name}
      className="flex max-w-[40%] min-w-0 items-center gap-1.5 rounded-full border border-sprout-200 bg-sprout-150 px-3 py-1.5 text-sm font-bold text-sprout-800"
    >
      <Sprout aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}
