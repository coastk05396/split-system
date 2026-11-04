# Group ledger migration: completed

The production Group ledger cutover and legacy D1 table removal are finished. Group Durable Objects now own members, balances, expenses, settlements, invites, and stops; D1 holds read projections and account data.

The migration snapshot, import, and controlled-wipe endpoints have been retired. The internal import and initialisation handlers are also removed. Do not rerun the old cutover procedure during ordinary releases.

## Current release verification

Follow `docs/RELEASE.md` for the release gate and maintenance controls. Verify:

- Health and authenticated Group, Member, Expense, Settlement, and Stop reads.
- Zero-sum balances, account sign-in, and session refresh.
- Live WebSocket updates, including catch-up after reconnecting.
- The test sign-in route returns 404 in production.
- Failed projection writes appear in Worker logs and retry successfully after recovery.

## Recovery

A D1 backup contains account data and read projections, not the authoritative Group ledgers. Restoring D1 alone does not roll back ledger writes. Plan recovery around both stores and obtain owner approval before restoring or deleting production data.
