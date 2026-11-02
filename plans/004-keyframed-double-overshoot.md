# 004 — Remove double overshoot on keyframed spring pops

- **Status**: DONE
- **Commit**: dc5b5ea
- **Severity**: MEDIUM
- **Category**: Easing & duration
- **Estimated scope**: 1 file (styles.css), 2 rules

## Problem

Of the nine advisory spring-easing uses, two are multi-stop keyframes that ALSO set an overshooting cubic-bezier. A CSS `animation-timing-function` applies per keyframe interval, so each segment overshoots again and the pop wobbles beyond its authored peak. `category-bloom` runs on every category tap in the expense form (160ms, so it reads as a twitch).

```css
/* styles.css:911-924 — current */
@keyframes category-bloom { 0% { transform: scale(0.88); } 60% { transform: scale(1.14); } 100% { transform: scale(1); } }
.category-bloom { animation: category-bloom 160ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
/* styles.css:1023-1040 — current */
@keyframes bubble-spring { 0% { opacity: 0; transform: translateY(6px) scale(0.7); } 60% { opacity: 1; transform: translateY(-2px) scale(1.08); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
.bubble-spring { animation: bubble-spring 260ms var(--ease-spring) both; }
```

## Target

Keep the keyframe peaks (the bounce is authored there) and use a non-overshooting curve per segment; lengthen category-bloom slightly so the peak is visible but keep under 200ms:

```css
.category-bloom { animation: category-bloom 180ms var(--ease-out-expo) both; }
.bubble-spring  { animation: bubble-spring 260ms var(--ease-out-expo) both; }
@keyframes category-bloom { 0% { transform: scale(0.9); } 60% { transform: scale(1.1); } 100% { transform: scale(1); } }
```
(`--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1)`, styles.css:23.)

## Repo conventions to follow

- Two-point spring uses (e.g. `.swap-in`, `.list-stagger-item`) correctly rely on --ease-spring alone; do NOT change those. The mascot-poke (styles.css:716) is a brand moment: leave it. nav-icon-pop is handled in plan 001.

## Steps

1. Replace the two animation lines and the category-bloom keyframe as above.
2. Do not touch the reduced-motion lists (both classes are already there).

## Boundaries

- Only these two rules. No new tokens, no JSX edits. STOP on drift.

## Verification

- **Mechanical**: `pnpm typecheck`, `pnpm test`.
- **Feel check**: new expense -> tap categories quickly; the badge pops once and settles, no wobble. Stats -> tap a month bar; the bubble pops in with one clear peak. 10% playback: single peak per animation.
- **Done when**: neither rule uses a 1.56 y-control-point curve.
