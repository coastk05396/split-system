---
title: Decide the frontend stack
type: wayfinder:grilling
mode: HITL
status: closed
assignee: rick
parent: ../map.md
blocked_by: ["16-decide-api-contract.md", "17-reconcile-designs-with-decisions.md", "23-decide-add-expense-form-features.md"]
---

## Question

Decide the SPA stack for the reconciled screens: React or Preact, router, data fetching (TanStack Query was in the spec), styling (Tailwind), form handling with the shared Zod schemas, how the LIFF SDK loads and how the SPA tells it is inside LINE, where the payment plan search runs (a web worker or the main thread), zh-TW-only text kept in one place, and bundle limits that suit a phone inside LINE. Also decide the safe arithmetic parser for the calculator field, on-device image resizing for receipt photos, and how the form detects that `liff.sendMessages` is available.

## Blocked by

- [Decide the API contract](16-decide-api-contract.md)
- [Reconcile the designs with the decisions](17-reconcile-designs-with-decisions.md)
- [Decide the add-Expense form features](23-decide-add-expense-form-features.md)

## Resolution

Package versions are not pinned here; **Decide the deploy pipeline** pins them when the repo is set up.

- **UI library and size budget:** React with TypeScript in strict mode, built with Vite. First load is under 200 KB of gzipped JavaScript, with each route loading its own code. Preact is a fallback only if the budget cannot be met. Targets: the latest LINE in-app browser on iOS and Android, and Chrome on desktop.
- **Routing and data:** React Router for pages and TanStack Query v5 for server data, calling the API through Hono's typed client. No global client-state library: state lives in the URL, the query cache and local form state.
- **Styling and components:** Tailwind CSS v4, with the screens' green palette, type sizes and spacing kept as CSS variables so designs and code share one set of values. A few headless accessible parts (dialogs, bottom sheets, selects, date pickers) come from Radix; no large UI kit; icons from Lucide.
- **Forms, calculator and photos:** React Hook Form with the shared Zod schemas, so the browser and the Worker validate the same rules. The calculator uses a small hand-written parser (about 60 lines, in the shared package) covered by the property tests, never `eval`, with no extra library. Receipt photos are resized with the browser's own `createImageBitmap` and canvas, so no image library is added.
- **LINE and Google sign-in in the SPA:** `@line/liff` is installed from npm and started once in a provider, with the endpoint `https://split.rickchen.si`. Inside LINE (`liff.isInClient()`) sign-in is automatic; outside LINE the login screen shows both buttons. The Google sign-in script loads only on that screen and only outside LINE. The "send to current chat" checkbox shows only when `liff.isApiAvailable('sendMessages')` is true.
- **Payment plan computation:** the exact search runs in a Web Worker using the shared package. The screen shows the greedy plan immediately and swaps in the exact one when it finishes, labelled "最少筆數". Without Web Workers, greedy stays and the label says "至多 N−1 筆".
- **Text and offline:** all text lives in one typed zh-TW message catalog keyed by ID, and API error codes map to messages there. No i18n library in v1, but every string goes through a small `t()` helper so adding a language later is mechanical. No service worker or PWA in v1 (offline mode is out of scope).
