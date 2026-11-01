import { useState } from "react";
import { Sprout } from "lucide-react";

/** The 小芽 mark: a sprout on a peach circle with a subtle specular highlight and hover/tap tilt. */
export function SproutMark({
  className = "size-10",
  interactive = true,
}: {
  className?: string;
  interactive?: boolean;
}) {
  const [poked, setPoked] = useState(false);

  const handlePoke = () => {
    if (!interactive) return;
    setPoked(true);
    setTimeout(() => {
      setPoked(false);
    }, 650);
  };

  return (
    <span
      aria-hidden="true"
      onClick={interactive ? handlePoke : undefined}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-peach text-sprout-600 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.8)] transition-transform duration-300 ease-(--ease-spring) hover:rotate-6 hover:scale-105 active:scale-95 motion-reduce:transition-none ${
        poked ? "mascot-poke" : ""
      } ${interactive ? "cursor-pointer select-none" : ""} ${className}`}
    >
      <Sprout className="size-1/2" strokeWidth={2.2} />
    </span>
  );
}
