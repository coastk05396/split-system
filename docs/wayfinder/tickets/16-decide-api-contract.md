---
title: Decide the API contract
type: wayfinder:grilling
mode: HITL
status: closed
assignee: rick
parent: ../map.md
blocked_by: ["03-research-cloudflare-hosting.md", "14-decide-line-bot-v1-scope.md", "15-decide-data-model.md"]
---

## Question

Hono route list, auth middleware, error shape, pagination, idempotency header, and the typed client contract shared with the SPA.

## Blocked by

- [Research Cloudflare hosting for the SPA and Workers](03-research-cloudflare-hosting.md)
- [Decide the LINE Bot scope for v1](14-decide-line-bot-v1-scope.md)
- [Decide the data model](15-decide-data-model.md)

## Resolution

- **Style and typing:** a JSON API under `/api/v1` using Hono's typed client so the SPA and Worker share types. Request and response shapes are defined once as Zod schemas in a shared package; the Worker validates every request with them and the SPA reuses them. Requests carry the access token as a Bearer header.
- **Routes:**
  - **Sign-in and account:** `POST /auth/google`, `/auth/line`, `/auth/refresh`, `/auth/logout`, `/auth/logout-all`, `/auth/link/google`, `/auth/link/line`; `DELETE /auth/identities/:provider`; `GET /me`; `DELETE /me`.
  - **Groups:** `GET /groups`, `POST /groups`, `GET`, `PATCH` and `DELETE /groups/:id`.
  - **Members:** `GET /groups/:id/members`; `PATCH /groups/:id/members/:mid` (role); `DELETE /groups/:id/members/:mid` (remove); `POST /groups/:id/leave`.
  - **Invites:** `POST /groups/:id/invite` (create or regenerate); `GET /invites/:token` (group name preview); `POST /invites/:token/join`.
  - **Expenses:** `GET` and `POST /groups/:id/expenses`; `GET`, `PATCH` and `DELETE /groups/:id/expenses/:eid`.
  - **Balances:** `GET /groups/:id/balances`.
  - **Settlements:** `GET` and `POST /groups/:id/settlements`; `POST /settlements/:sid/confirm`; `POST /settlements/:sid/cancel`; `POST /settlements/:sid/undo`.
  - **Rates:** `GET /rates?date&base&quote`.
  - **Stops:** `GET /groups/:id/stops?day`; `POST /groups/:id/stops`; `PATCH` and `DELETE /groups/:id/stops/:sid`.
  - **LINE:** `POST /line/webhook` (outside the typed client, signature-checked).
- **Errors:** one JSON shape, `{ error: { code, details? } }`, with stable codes such as `INVITE_EXPIRED`, `GROUP_FULL`, `BALANCE_NOT_ZERO` and `EXPENSE_AMOUNT_INVALID`; HTTP status 400, 401, 403, 404, 409, 422 or 429. The server sends no display text; the SPA maps each code to its zh-TW message.
- **Double-submit and clashing edits:** creating an Expense or Settlement needs an `Idempotency-Key` header and a repeat returns the original row. An edit sends the row's `updated_at`; if someone else changed it first the Worker answers 409 with the current row.
- **Pagination and origin:** lists use a cursor, 50 rows a page, ordered by ID. Balances come back as one small list of Members. The SPA and API share one origin, `split.rickchen.si`, so there is no CORS. The refresh cookie is httpOnly, Secure, SameSite=Lax and limited to `/api/v1/auth`.
- **"I owe them" and "I paid":** adding a debt stays an Expense with the other person as payer and only the debtor in the split. A payer may also tap "我已付款", which creates a **pending** Settlement. Balances change only when the receiver (or an admin) confirms it; the payer can cancel it while it is pending. The receiver sees a "待確認" badge in the app; no push messages.

This amends two closed tickets: the settlement flow now has a pending state (see the note on **Decide the settlement flow**) and the data model gains a Settlement `status` (see the note on **Decide the data model**).

Divergences from the designs, for **Reconcile the designs with the decisions**: the debts and confirm screens (5 and 18) need a "我已付款" action for the payer, a "待確認" badge and a cancel action; the new-expense screen (4, 新增支出) needs an easy way to say the other person paid and only you owe.

Amended by **Decide the add-Expense form features**: Expense create and edit accept a list of payers; a transfer goes through `POST /groups/:id/settlements`; new routes `PUT`, `GET` and `DELETE /groups/:id/expenses/:eid/receipt` (images are read through the Worker after a membership check).

Amended by **Decide abuse limits and observability**: the error code `RATE_LIMITED` (HTTP 429, with a `Retry-After` header) is added to the stable codes.

Amended by **Decide placeholder Members**: new routes `POST /groups/:id/members` (add a placeholder), `POST /invites/:token/claim` and `POST /groups/:id/members/:mid/merge` (admin only).
