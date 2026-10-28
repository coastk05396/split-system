import { Sprout } from "lucide-react";

/** The 小芽 mark: a sprout on a peach circle. */
export function SproutMark({ className = "size-10" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-peach text-sprout-600 ${className}`}
    >
      <Sprout className="size-1/2" strokeWidth={2.2} />
    </span>
  );
}
