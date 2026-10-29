import { useEffect, useRef } from "react";

/**
 * Text whose characters roll in when they change, like a taxi meter's digits. Nothing rolls on
 * the first draw, and a character that stays the same stays put: only an element that did not
 * exist in the last draw is given the roll. The whole string is also one label for screen
 * readers, so they hear the number, not a stream of characters.
 */
export function Odometer({ text, className }: { text: string; className?: string }) {
  const previous = useRef<ReadonlySet<string> | null>(null);
  const chars = Array.from(new Intl.Segmenter().segment(text), (part) => part.segment);
  // Counted from the end, so a number that gains a digit keeps the digits it already had.
  const keys = chars.map((char, index) => `${String(chars.length - index)}-${char}`);

  useEffect(() => {
    previous.current = new Set(keys);
  });

  return (
    <span className={className} role="text" aria-label={text}>
      {chars.map((char, index) => {
        const key = keys[index] ?? char;
        const rolls = previous.current !== null && !previous.current.has(key);
        return (
          <span key={key} aria-hidden="true" className={rolls ? "digit-roll" : undefined}>
            {char}
          </span>
        );
      })}
    </span>
  );
}
