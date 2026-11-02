import { useId, useState } from "react";

/**
 * 小芽 the mascot: a round clay-soft sprout with a blinking face. `cheer` squeezes the eyes into
 * happy arcs and opens the mouth, for good news such as an all-settled group. Drawn in SVG so it
 * costs no image request.
 * Interactive poke: clicking/tapping triggers a squishy spring wiggle, cheerful squint, and sparkles!
 */
export function SproutMascot({
  className = "size-28",
  mood = "happy",
  interactive = true,
  onClick,
}: {
  className?: string;
  mood?: "happy" | "cheer" | "wave" | "idle";
  interactive?: boolean;
  onClick?: () => void;
}) {
  const id = useId();
  const [poked, setPoked] = useState(false);
  const cheer = mood === "cheer" || poked;
  const waving = mood === "wave" && !cheer;

  const handlePoke = () => {
    if (!interactive) return;
    setPoked(true);
    onClick?.();
    setTimeout(() => {
      setPoked(false);
    }, 750);
  };

  const svg = (
    <svg
      aria-hidden="true"
      viewBox="0 0 120 120"
      className={`${poked ? "mascot-poke" : "mascot-bob"} shrink-0 select-none ${className}`}
    >
      <defs>
        <radialGradient id={`${id}-body`} cx="38%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#e4f9e9" />
          <stop offset="100%" stopColor="#c9ebd3" />
        </radialGradient>
        <linearGradient id={`${id}-leaf`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5fcf9f" />
          <stop offset="100%" stopColor="#2e9d71" />
        </linearGradient>
      </defs>
      <ellipse cx="60" cy="110" rx="30" ry="5" fill="#143f2a" opacity="0.1" />
      <g className={waving ? "mascot-wave" : "mascot-leaves"}>
        <path
          d="M60 30 C60 22 59 18 57 14"
          stroke="#2e9d71"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        <path d="M57 15 C45 6 30 11 29 24 C42 27 54 24 57 15Z" fill={`url(#${id}-leaf)`} />
        <path
          d="M58 15 C69 4 85 8 88 21 C75 26 62 24 58 15Z"
          fill={`url(#${id}-leaf)`}
          className={waving ? "mascot-wave origin-bottom" : undefined}
        />
      </g>
      <circle cx="60" cy="68" r="42" fill={`url(#${id}-body)`} stroke="#bfe5cc" strokeWidth="1.5" />
      <ellipse
        cx="42"
        cy="48"
        rx="11"
        ry="6"
        fill="#fff"
        opacity="0.65"
        transform="rotate(-25 42 48)"
      />
      <circle cx="38" cy="80" r="7" fill="#ffb98f" opacity="0.65" />
      <circle cx="82" cy="80" r="7" fill="#ffb98f" opacity="0.65" />
      {cheer ? (
        <g stroke="#163d2a" strokeWidth="3.4" strokeLinecap="round" fill="none">
          <path d="M42 70 Q48 62 54 70" />
          <path d="M66 70 Q72 62 78 70" />
        </g>
      ) : waving ? (
        <g fill="#163d2a">
          {/* Friendly cheerful wink when waving */}
          <ellipse className="mascot-eye" cx="48" cy="68" rx="4.6" ry="6.2" />
          <circle cx="49.6" cy="65.8" r="1.5" fill="#fff" />
          <path
            d="M66 70 Q72 62 78 70"
            stroke="#163d2a"
            strokeWidth="3.4"
            strokeLinecap="round"
            fill="none"
          />
        </g>
      ) : (
        <g fill="#163d2a">
          <ellipse className="mascot-eye" cx="48" cy="68" rx="4.6" ry="6.2" />
          <ellipse className="mascot-eye" cx="72" cy="68" rx="4.6" ry="6.2" />
          <circle cx="49.6" cy="65.8" r="1.5" fill="#fff" />
          <circle cx="73.6" cy="65.8" r="1.5" fill="#fff" />
        </g>
      )}
      {cheer || waving ? (
        <path
          d="M51 82 Q60 94 69 82 Z"
          fill="#ff8f7a"
          stroke="#163d2a"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M53 82 Q60 88 67 82"
          stroke="#163d2a"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      )}
    </svg>
  );

  if (!interactive) return svg;

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label="戳一下小芽"
      onClick={handlePoke}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handlePoke();
        }
      }}
      className="group relative inline-flex cursor-pointer select-none transition-transform duration-300 ease-(--ease-spring) hover:scale-105 active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100"
    >
      {poked && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0">
          <span className="sparkle -top-2 -left-2" style={{ animationDelay: "0ms" }} />
          <span className="sparkle -top-1 -right-2" style={{ animationDelay: "150ms" }} />
          <span className="sparkle -bottom-2 -left-1" style={{ animationDelay: "300ms" }} />
          <span className="sparkle -bottom-1 -right-1" style={{ animationDelay: "200ms" }} />
        </span>
      )}
      {svg}
    </span>
  );
}

/** Four little stars that twinkle around whatever sits inside, for a quiet celebration. */
export function Sparkles({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-flex">
      {children}
      <span
        aria-hidden="true"
        className="sparkle left-[-6px] top-[8px]"
        style={{ animationDelay: "0ms" }}
      />
      <span
        aria-hidden="true"
        className="sparkle right-[-8px] top-[2px]"
        style={{ animationDelay: "420ms" }}
      />
      <span
        aria-hidden="true"
        className="sparkle right-[4px] bottom-[6px]"
        style={{ animationDelay: "840ms" }}
      />
      <span
        aria-hidden="true"
        className="sparkle left-[6px] bottom-[2px]"
        style={{ animationDelay: "1260ms" }}
      />
    </span>
  );
}
