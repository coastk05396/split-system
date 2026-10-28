---
title: Decide the testing strategy
type: wayfinder:grilling
mode: HITL
status: closed
assignee: rick
parent: ../map.md
blocked_by: ["16-decide-api-contract.md"]
---

## Question

Decide what is tested and how at no cost: unit and property tests for the money, split, leftover, conversion and Balance rules (sums must always match); D1 integration tests through the Workers test runner, including batch rollback and idempotent repeats; contract tests from the shared Zod schemas; the minimum browser tests for sign-in, add an Expense, and confirm a Settlement; and what runs on every pull request.

## Blocked by

- [Decide the API contract](16-decide-api-contract.md)

## Resolution

- **Money logic and property tests:** all the money rules (splitting, leftover, conversion, Balance changes, the payment plan) live in one shared package that does no network or database work, tested with Vitest unit tests and property tests that must hold for any input: splits always sum to the total; Balances in a Group always sum to zero; a confirmed payment plan brings every Balance to zero; the exact search is never worse than greedy; the same input gives the same plan. A fixed set of worked examples is also checked, such as NT$100 over three people giving 34 / 33 / 33 and the research example that needs 3 payments and not 4.
- **Database tests:** run in a local Workers runtime with an in-memory D1 and the real migrations. They check that a failed `batch()` leaves nothing behind, that a repeated Idempotency-Key returns the original row, that every unique constraint holds, that Balances still sum to zero after creating, editing and deleting Expenses and after confirming and undoing Settlements, and that the caps (30 Members, 2,000 Expenses and so on) are enforced. The current name and setup of the Workers test runner is not confirmed here and is checked by **Decide the deploy pipeline**.
- **API and sign-in tests, with no network:** every route's request and response is checked against the shared Zod schemas and every error code has a test. Auth tests cover an expired token, the wrong audience and a tampered signature; the LIFF token check uses a locally generated ES256 key pair; the LINE webhook signature check uses fixed test vectors. Google, LINE and Frankfurter are always faked and no test calls a real service.
- **Browser tests:** three Playwright flows run against a local copy of the app: sign in, add an Expense with everyone selected by default, and confirm a Settlement. Sign-in uses a test-only login route that exists only when a test flag is set, and a test asserts that route returns 404 in the production configuration. Real Google, LINE and LIFF behaviour is checked by hand with a short release checklist.
- **What blocks a merge:** GitHub Actions runs on every pull request: strict type check, lint, unit and property tests, database tests, API tests and a gitleaks secret scan; the browser tests run when app code changed. A failure blocks the merge. No coverage percentage; the rule is that every rule listed in the data model has at least one test. The repo is public, so Actions minutes are free; a private repo would have a smaller free allowance (2,000 minutes a month, unconfirmed here).
