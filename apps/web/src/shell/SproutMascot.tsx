import { useId } from "react";

/**
 * 小芽 the mascot: a round clay-soft sprout with a blinking face. `cheer` squeezes the eyes into
 * happy arcs and opens the mouth, for good news such as an all-settled group. Drawn in SVG so it
 * costs no image request.
 */
export function SproutMascot({
  className = "size-28",
  mood = "happy",
}: {
  className?: string;
  mood?: "happy" | "cheer";
}) {
  const id = useId();
  const cheer = mood === "cheer";
  return (
    <svg aria-hidden="true" viewBox="0 0 120 120" className={`mascot-bob shrink-0 ${className}`}>
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
      <g className="mascot-leaves">
        <path
          d="M60 30 C60 22 59 18 57 14"
          stroke="#2e9d71"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        <path d="M57 15 C45 6 30 11 29 24 C42 27 54 24 57 15Z" fill={`url(#${id}-leaf)`} />
        <path d="M58 15 C69 4 85 8 88 21 C75 26 62 24 58 15Z" fill={`url(#${id}-leaf)`} />
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
      ) : (
        <g fill="#163d2a">
          <ellipse className="mascot-eye" cx="48" cy="68" rx="4.6" ry="6.2" />
          <ellipse className="mascot-eye" cx="72" cy="68" rx="4.6" ry="6.2" />
          <circle cx="49.6" cy="65.8" r="1.5" fill="#fff" />
          <circle cx="73.6" cy="65.8" r="1.5" fill="#fff" />
        </g>
      )}
      {cheer ? (
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
