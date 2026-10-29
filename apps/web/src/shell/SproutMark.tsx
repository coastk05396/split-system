import { Sprout } from "lucide-react";

/** The 小芽 mark: a sprout on a peach circle with a subtle specular highlight and hover/tap tilt. */
export function SproutMark({ className = "size-10" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-peach text-sprout-600 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.8)] transition-transform duration-300 ease-(--ease-spring) hover:rotate-6 hover:scale-105 active:scale-95 motion-reduce:transition-none ${className}`}
    >
      <Sprout className="size-1/2" strokeWidth={2.2} />
    </span>
  );
}
