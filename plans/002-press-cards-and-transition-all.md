# 002 — Replace `transition-all` on cards and chart bars

- **Status**: DONE
- **Commit**: dc5b5ea
- **Severity**: HIGH
- **Category**: Performance / Interruptibility (press asymmetry)
- **Estimated scope**: 7 files, one class-string edit each

## Problem

Nine `transition-all` uses. The worst are the group/entry cards (hit tens of times a day) which animate every property with a 200ms spring on BOTH press and release, so the press response lags and rebounds. The repo already has an asymmetric press utility (`.press-card`: 80ms ease-out down, 160ms spring release) that these cards ignore. The stats bar animates `height` (layout) with an overshooting spring.

```tsx
// apps/web/src/pages/GroupsPage.tsx:53, pages/NewEntryPage.tsx:50, pages/HomePage.tsx:250 — current (same string)
className="surface-card group flex items-center justify-between gap-3.5 rounded-2xl border border-sprout-200/80 bg-white p-4 shadow-2xs hover:border-sprout-300 active:scale-[0.98] transition-all duration-200 ease-(--ease-spring) text-ink focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-sprout-600"
// apps/web/src/pages/HomePage.tsx:331 — current
className="surface-card group flex flex-col gap-3 rounded-2xl border border-sprout-200/80 bg-white p-4 shadow-2xs hover:border-sprout-300 hover:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.95),0_8px_16px_-6px_rgba(20,63,42,0.12)] active:scale-[0.96] transition-all duration-200 ease-(--ease-spring) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sprout-600 text-left"
// apps/web/src/pages/StatsPage.tsx:269 — current
className={`w-6 max-w-full rounded-t-xl transition-all duration-300 ease-(--ease-spring) ${
// apps/web/src/pages/StatsPage.tsx:368 — current:  ... shadow-inner transition-all duration-300 focus-visible:outline-2 ...
// apps/web/src/expenses/SplitEditor.tsx:215 — current: ... px-4 py-3 transition-all duration-200 ${
// apps/web/src/pages/NewGroupPage.tsx:77 — current: ... shadow-2xs transition-all duration-300 ease-(--ease-spring) group-hover:scale-105 group-active:scale-95
// apps/web/src/shell/AppShell.tsx:62 — handled in plan 001, skip here.
```

## Target

```text
Cards (4 sites): delete "active:scale-[0.98]" (or [0.96]) and "transition-all duration-200 ease-(--ease-spring)"; add "press-card".
   (.press-card already supplies scale(0.97) press, 80ms down / 160ms spring release; keep hover:border/hover:shadow classes, they transition via press-card's color/shadow list.)
StatsPage.tsx:269 bar: "transition-all duration-300 ease-(--ease-spring)" -> "transition-[height,background-color,box-shadow] duration-200 ease-(--ease-out-expo)"   (no overshoot past 100% of the track)
StatsPage.tsx:368 donut centre: "transition-all duration-300" -> "transition-colors duration-200"
SplitEditor.tsx:215: "transition-all duration-200" -> "transition-[opacity,filter] duration-200 ease-(--ease-out-expo)"
NewGroupPage.tsx:77: "transition-all duration-300 ease-(--ease-spring)" -> "transition-transform duration-200 ease-(--ease-spring)"
```
Add `motion-reduce:transition-none` is NOT needed for press-card (reduced-motion block at styles.css ~610 already zeroes its transform).

## Repo conventions to follow

- `.press-card` at styles.css:39-60. Exemplar of correct usage: `press-icon` on apps/web/src/pages/GroupPage.tsx:192 and `press-pill` at GroupPage.tsx:~125.

## Steps

1. Apply the class-string replacement at each site listed; change nothing else in the string.
2. `grep -rn "transition-all" apps/web/src --include='*.tsx'` should list only AppShell.tsx:62 (plan 001).
3. If tests assert on these class names, update them minimally.

## Boundaries

- Do NOT edit styles.css. Do NOT change hover colours, borders or layout classes. No new dependencies.
- If a line differs from the excerpt, STOP and report.

## Verification

- **Mechanical**: `pnpm typecheck`, `pnpm test`.
- **Feel check**: on a phone-width viewport press and hold a group card: it dips within ~80ms (no spring lag); release rebounds once, gently. Hover on desktop still changes border/shadow. Stats: tap different months; bars change height without exceeding the track top; DevTools Performance shows no layout work from the cards.
- **Done when**: only one `transition-all` remains (AppShell, fixed by 001) and all four cards use `press-card`.
