# 005 — Shorten chart entrances and cap stagger

- **Status**: DONE
- **Commit**: dc5b5ea
- **Severity**: MEDIUM
- **Category**: Easing & duration / Cohesion
- **Estimated scope**: 2 files (styles.css, StatsPage.tsx), 1 more optional (BalanceChart.tsx)

## Problem

Chart entrances run 650ms (UI budget is <300ms; they replay every time the page/tab opens). Stats bars stagger `i*50ms` with no cap (about 12 months = 600ms of delay + 650ms), so the chart is not readable for over a second. The settle balance bars use 650ms plus up to 360ms delay.

```css
/* styles.css:359,362 */ animation: bar-grow-right 650ms cubic-bezier(0.16, 1, 0.3, 1) backwards;  (and bar-grow-left, same)
/* styles.css:376 */ animation: stats-bar-enter 650ms var(--ease-out-expo) both;
/* styles.css:387 */ animation: stats-ring-enter 650ms var(--ease-out-expo) both;
```
```tsx
// apps/web/src/pages/StatsPage.tsx:275 — current
animationDelay: `${String(i * 50)}ms`,
// apps/web/src/settlements/BalanceChart.tsx:91 — current
const delay = `${String(Math.min(index, 6) * 60)}ms`;
```

## Target

```css
bar-grow-right / bar-grow-left: 400ms (same curve)
stats-bar-enter: 350ms var(--ease-out-expo) both
stats-ring-enter: 400ms var(--ease-out-expo) both
```
```tsx
StatsPage.tsx:275:   animationDelay: `${String(Math.min(i, 6) * 30)}ms`,
BalanceChart.tsx:91: const delay = `${String(Math.min(index, 5) * 40)}ms`;
```
Worst case: 180ms + 350ms = 530ms total for stats, 200ms + 400ms for balances. The clip-path / scaleY / dashoffset techniques stay (documented tradeoff; do not switch to scaleX).

## Repo conventions to follow

- Entrances elsewhere use 180-260ms with --ease-out-expo (styles.css:140,190,495). Reduced-motion already disables all four classes (styles.css:389, ~597).

## Steps

1. Edit the four durations in styles.css.
2. Edit the two delay expressions.

## Boundaries

- Do NOT change keyframes, curves, or the `interacted` gating in StatsPage. No new dependencies. STOP on drift.

## Verification

- **Mechanical**: `pnpm typecheck`, `pnpm test`.
- **Feel check**: open Stats cold; bars rise in a quick left-to-right ripple that is readable in about half a second, ring draws in sync. Open Settle tab; bars sweep out from the centre line. Slow motion (10%): clip stays undistorted at the rounded ends.
- **Done when**: no chart entrance exceeds 400ms duration and delays are capped.
