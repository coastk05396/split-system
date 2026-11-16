import { useEffect, useRef, useState } from "react";
import { Sprout } from "lucide-react";

/** The 小芽 mark: a sprout on a peach circle with a subtle specular highlight and tap tilt. */
export function SproutMark({
  className = "size-10",
  interactive = true,
}: {
  className?: string;
  interactive?: boolean;
}) {
  const [poked, setPoked] = useState(false);
  const pokeTimerRef = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(pokeTimerRef.current);
    },
    [],
  );

  const handlePoke = () => {
    if (!interactive) return;
    window.clearTimeout(pokeTimerRef.current);
    setPoked(true);
    pokeTimerRef.current = window.setTimeout(() => {
      setPoked(false);
    }, 650);
  };

  return (
    <span
      aria-hidden="true"
      onClick={interactive ? handlePoke : undefined}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-peach text-sprout-600 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.8)] transition-transform duration-180 ease-(--ease-spring) active:scale-95 motion-reduce:transition-none motion-reduce:scale-100 motion-reduce:rotate-0 motion-reduce:active:scale-100 ${
        poked ? "mascot-poke" : ""
      } ${interactive ? "cursor-pointer select-none" : ""} ${className}`}
    >
      <Sprout className="size-1/2" strokeWidth={2.2} />
    </span>
  );
}
