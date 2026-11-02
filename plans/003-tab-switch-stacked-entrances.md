# 003 — Lighten tab-switch motion (panel, pill, child entrances)

- **Status**: DONE
- **Commit**: dc5b5ea
- **Severity**: MEDIUM
- **Category**: Purpose & frequency / Interruptibility
- **Estimated scope**: 2 files (styles.css, SelectionPill.tsx), ~6 lines

## Problem

Group tabs (Expenses/Settle/Trip) and the expense-form tabs are switched tens of times a day. Each switch remounts a Radix `Tabs.Content`, so a keyframe replays (keyframes restart from zero, never retarget) while the selection pill FLIPs for 280ms, and the content's own entrances (settle-stagger, bar-grow, list-stagger) replay on top.

```css
/* apps/web/src/styles.css:128-141 — current */
@keyframes tab-enter { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.tab-panel[data-state="active"] { animation: tab-enter 180ms var(--ease-out-expo); }
```
```tsx
// apps/web/src/shell/SelectionPill.tsx:~37-40 — current
{ duration: 280, easing: EASE_OUT },
```

## Target

Opacity-only panel fade (movement is already supplied by the pill), pill 200ms:

```css
@keyframes tab-enter { from { opacity: 0; } to { opacity: 1; } }
.tab-panel[data-state="active"] { animation: tab-enter 120ms ease-out; }
```
```tsx
{ duration: 200, easing: EASE_OUT },
```
`EASE_OUT` is `cubic-bezier(0.16, 1, 0.3, 1)` (shell/motion.ts).

## Repo conventions to follow

- Reduced-motion already lists `.tab-panel[data-state="active"]` with `animation: none` (styles.css ~605); keep it. Pill already skips FLIP under reduced motion.

## Steps

1. Edit the keyframe and animation line in styles.css as above (keep the selector).
2. Edit the duration in SelectionPill.tsx.
3. Do not touch the child-entrance classes in this plan.

## Boundaries

- Do NOT change SelectionPill's FLIP logic or lastBox map. No new dependencies. STOP if code has drifted.

## Verification

- **Mechanical**: `pnpm typecheck`, `pnpm test`.
- **Feel check**: on a phone, tap Expenses -> Settle -> Trip rapidly 10 times; the pill glides, content fades quickly without vertical jitter, nothing feels late. Animations panel at 10%: panel only changes opacity. Note: the pill scales its box during the FLIP, which briefly distorts radius/shadow; if visible at 200ms, report it rather than fixing.
- **Done when**: tab-enter has no transform and the pill is 200ms.
