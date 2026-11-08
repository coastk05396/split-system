---
title: Decide the data model
type: wayfinder:grilling
mode: HITL
status: closed
assignee: rick
parent: ../map.md
blocked_by: ["04-research-d1-and-kv-guarantees.md", "09-decide-identity-and-session.md", "10-decide-invite-and-membership.md", "11-decide-fx-rate-policy.md", "12-decide-settlement-flow.md", "13-decide-trip-module-scope.md", "19-research-free-tier-fit.md"]
---

## Question

Entities, relations and invariants for D1 covering User, Identity, Group, Member, Expense, split lines, rate snapshot, Settlement, Invite and itinerary. Written as a schema outline, not migrations.

## Blocked by

- [Research D1 atomicity and KV consistency](04-research-d1-and-kv-guarantees.md)
- [Decide identity linking and sessions](09-decide-identity-and-session.md)
- [Decide invites and membership rules](10-decide-invite-and-membership.md)
- [Decide the exchange rate policy](11-decide-fx-rate-policy.md)
- [Decide the settlement flow](12-decide-settlement-flow.md)
- [Decide the Trip module scope for v1](13-decide-trip-module-scope.md)
- [Research whether free tiers carry v1](19-research-free-tier-fit.md)

## Resolution

**Conventions.** Every row has a random, time-sortable ID (UUIDv7-style) made in the Worker, never an autoincrement. Moments (`created_at`, `confirmed_at`, `undone_at`) are UTC. The Expense date, Trip dates and Stop times are plain local text (`2026-06-13`, `14:00`) with no timezone; the Expense date defaults to the user's device date. Money is an integer in the currency's smallest unit as decided (TWD whole dollars, USD cents). Every multi-row write is one `db.batch()` with each statement at most 100 bound parameters.

**Tables** (columns are the outline, not migrations):

| Table | Key columns and constraints |
| --- | --- |
| `user` | id, display_name, picture_url, created_at |
| `identity` | id, user_id, provider (`google` or `line`), provider_sub, created_at; UNIQUE (provider, provider_sub) |
| `session` | id, user_id, token_hash UNIQUE, device_label, created_at, last_used_at, expires_at (30 days, rotating) |
| `group` | id, name, usage (`tab` or `trip`), settlement_currency, default_expense_currency, expense_count, destination, trip_start, trip_end, trip_notes, created_at |
| `member` | id, group_id, user_id (null once the account is deleted), role (`admin` or `member`), status (`active` or `former`), display_name (snapshot), balance_minor, joined_at, left_at; index (group_id) |
| `invite` | id, group_id, token_hash UNIQUE, expires_at (7 days), revoked_at, created_by_member |
| `expense` | id, group_id, created_by_member, payer_member, name, category, note, expense_date, amount_minor, currency, rate_micro, rate_date, rate_edited, converted_minor, split_method (`equal`, `exact` or `shares`), stop_id (nullable), idempotency_key, created_at, updated_at; UNIQUE (created_by_member, idempotency_key); index (group_id, expense_date) |
| `expense_split` | expense_id, member_id, amount_minor (Settlement currency), share_weight (shares only), input_minor (exact only); PK (expense_id, member_id) |
| `settlement` | id, group_id, from_member, to_member, amount_minor (Settlement currency), confirmed_by_member, created_at, undone_at, undone_by_member, idempotency_key; UNIQUE (confirmed_by_member, idempotency_key); index (group_id, created_at) |
| `stop` | id, group_id, day, start_time, end_time (both nullable), name, category, location_text, note, created_by_member, created_at; index (group_id, day) |
| `fx_rate` | date, base, quote, rate_micro, source, fetched_at; PK (date, base, quote) |

**Invariants.**
1. A Balance is stored on `member` and updated in the same batch as the write that changes it: the payer gains `converted_minor`, each split Member loses their `amount_minor`, and a confirmed Settlement of x from A to B adds x to A and subtracts x from B. Edits and deletes apply the difference. In every Group the Balances of all Members (including Former Members) sum to zero.
2. An Expense has at least one split line, the split lines sum to `converted_minor`, and the payer and every split Member belong to the Group. A same-currency Expense has `rate_micro` of 1,000,000.
3. Splitting runs in the Expense currency with the decided leftover rule; each split is then converted to the Settlement currency with the same leftover rule so the converted lines sum to `converted_minor` exactly. (This is a derived rule from the money and exchange rate decisions; confirm it when the spec is assembled.)
4. `settlement_currency` cannot change once `expense_count` is above zero.
5. A Group always has at least one active admin. A Member leaves or is removed only at a Balance of zero and becomes `former` with their name kept.
6. Deleting an account is allowed only at a zero Balance in every Group and when the User is not the last admin of a Group that still has other Members. It deletes the User's identities and sessions and sets `member.user_id` to null, leaving Former Members shown as "已刪除的使用者".
7. Expenses are hard-deleted (their Balance effects reversed in the same batch); Settlements are soft-undone (`undone_at`, `undone_by_member`); Groups are hard-deleted with everything under them; deleting a Stop clears `expense.stop_id`.
8. A Stop's `day` falls inside the Group's trip dates, and a trip is at most 31 days.
9. Caps: 20 Groups per User, 30 active Members per Group, 2,000 Expenses per Group, 50 Stops per day.
10. Indexes stay few because each adds a written row on the free plan: the unique keys above plus `member(group_id)`, `expense(group_id, expense_date)`, `settlement(group_id, created_at)` and `stop(group_id, day)`. An admin-only recompute check compares stored Balances with Balances rebuilt from the rows, to catch drift.

Amended by **Decide the API contract**: `settlement` gains `status` (`pending`, `confirmed` or `cancelled`); only `confirmed` rows move Balances; `confirmed_by_member` and `undone_*` stay as written; a cancel route exists for pending rows.

Amended by **Decide the add-Expense form features**: `expense` gains `expense_time` and `receipt_key` (both nullable); `payer_member` is replaced by an `expense_payer` table (expense_id, member_id, amount_minor), with amounts summing to the Expense total; each payer gains their converted share; `converted_minor` is what the user confirmed and the stored rate is derived from it when they typed the converted amount.

Amended by **Decide abuse limits and observability**: a small `rate_counter` table (user_id, route_group, window_start, count; PK on the first three) backs the per-User write limits; its rows older than an hour are purged when new counters are written.

Amended by **Decide placeholder Members**: `member.status` gains `placeholder` (with `user_id` null) and `member` gains `created_by_member`; a merge adds the two Members' Balances and moves their payer, split and Settlement rows to the surviving row; placeholders count toward the 30-Member cap but not toward a User's cap of 20 Groups.
