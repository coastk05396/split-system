import type { CSSProperties } from "react";

/**
 * A price or time whose digits flip into place like a departure board, on first draw and whenever
 * the text changes. The final text is always in the DOM for assistive tech; the flipping copy is
 * decorative. With `roll` off (reduced motion) only the final value is shown.
 */
export function SplitFlap({ text, roll }: { text: string; roll: boolean }) {
  // Characters have no identity beyond their position, so the key is built outside the render map.
  const chars = Array.from(text, (char, index) => ({
    char,
    index,
    key: `${String(index)}${char}`,
  }));
  return (
    <span className="tabular-nums">
      <span className="sr-only">{text}</span>
      {/* Keyed by the text so a changed value remounts and rolls again. */}
      <span key={text} aria-hidden="true" data-rolling={roll ? "true" : undefined}>
        {chars.map(({ char, index, key }) => (
          <span
            key={key}
            className={/\d/.test(char) ? "flap-digit" : undefined}
            style={{ "--i": index } as CSSProperties}
          >
            {char}
          </span>
        ))}
      </span>
    </span>
  );
}
