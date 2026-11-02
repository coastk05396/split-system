# 001 — Calm the bottom-nav icon bounce

- **Status**: DONE
- **Commit**: dc5b5ea
- **Severity**: HIGH
- **Category**: Purpose & frequency / Easing (stacked overshoot)
- **Estimated scope**: 2 files, ~15 lines

## Problem

The bottom nav is the most-tapped control in the app. On every route change the newly active icon plays a 320ms keyframe (scale to 1.18 plus rotate) AND a spring transition to `scale-[1.1] -translate-y-0.5`, so the peak is roughly 1.1 x 1.18 = 1.3x with two overshooting curves layered. The keyframe also replays on first paint of any page. The centre "new" button uses `transition-all` with a spring and animates box-shadow.

```tsx
// apps/web/src/shell/AppShell.tsx:71-73 — current
className={`relative size-5.5 transition-transform duration-200 ease-(--ease-spring) motion-reduce:transition-none ${
  isActive
    ? "-translate-y-0.5 scale-[1.1] nav-icon-pop motion-reduce:translate-y-0 motion-reduce:scale-100"
    : ""
}`}
```
```css
/* apps/web/src/styles.css:957-973 — current */
@keyframes nav-icon-pop { 0%{transform:scale(0.92)} 40%{transform:scale(1.18) rotate(-3deg)} 75%{transform:scale(0.96) rotate(1deg)} 100%{transform:scale(1) rotate(0deg)} }
.nav-icon-pop { animation: nav-icon-pop 320ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
```
```tsx
// apps/web/src/shell/AppShell.tsx:62 — current (centre button; excerpt of the motion classes only)
... transition-all duration-300 ease-(--ease-spring) active:scale-[0.85] active:-rotate-3 active:shadow-[0_0_0_8px_rgba(46,157,113,0.25)] group-active:scale-[0.85] group-active:-rotate-3 group-active:shadow-[0_0_0_8px_rgba(46,157,113,0.25)] motion-reduce:transition-none motion-reduce:transform-none ...
```

## Target

Keep the playful spring, but as ONE interruptible transition (no keyframe), small overshoot, <=200ms. Centre button: list its properties explicitly, press-in fast.

```tsx
// Icon (AppShell.tsx:71-73)
className={`relative size-5.5 transition-transform duration-200 ease-(--ease-spring) motion-reduce:transition-none ${
  isActive ? "-translate-y-0.5 scale-[1.1] motion-reduce:translate-y-0 motion-reduce:scale-100" : ""
}`}
// Centre button (AppShell.tsx:62): replace "transition-all duration-300" with
// "transition-[transform,background-color,box-shadow] duration-200"
// and change both "active:scale-[0.85]" / "group-active:scale-[0.85]" to "scale-[0.92]", rotate -3deg -> -2deg.
```
Delete the `@keyframes nav-icon-pop` block, the `.nav-icon-pop` rule, and the `.nav-icon-pop` entry inside the reduced-motion list (styles.css ~1051-1066).

## Repo conventions to follow

- Spring is a deliberate brand token: `--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)` (styles.css:24). Keep using it via `ease-(--ease-spring)`.
- Exemplar of asymmetric press: `.press-icon` (styles.css:39-62).

## Steps

1. Edit AppShell.tsx:71-73 as above (drop `nav-icon-pop` from the class string).
2. Edit AppShell.tsx:62 centre button as above. Do not change colours or shadows at rest.
3. In styles.css delete the nav-icon-pop keyframes + class; remove `.nav-icon-pop` from the reduced-motion selector list.
4. `grep -rn nav-icon-pop apps/web/src` must return nothing (tests included; update any test asserting the class).

## Boundaries

- Do NOT touch the Sidebar (desktop) or SelectionPill.
- Do NOT change `--ease-spring` itself.
- No new dependencies. If the code differs from the excerpts, STOP and report.

## Verification

- **Mechanical**: `pnpm typecheck` and `pnpm test` pass. Do not run `pnpm e2e` while `pnpm dev` runs.
- **Feel check** (390px viewport, ideally a real phone): tap Home/Groups/Stats rapidly; the active icon lifts once with a tiny settle, never wobbles or rotates; spam-tapping does not restart from zero. DevTools Animations panel at 10%: only one transform curve is active on the icon. Reduced motion: no scale or lift remains.
- **Done when**: no `nav-icon-pop` references remain and the icon has a single transition driving it.
