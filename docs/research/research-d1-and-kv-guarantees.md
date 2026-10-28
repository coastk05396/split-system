# D1 and KV guarantees for expense writes and idempotency

All sources read on 2026-10-28. Page contents were retrieved through a summarising fetcher, so quotes are as reported by it; re-check wording before relying on any single sentence.

## (a) Atomic multi-row writes in D1

- `batch()` is the atomic primitive. "Batched statements are SQL transactions." If a statement fails, the whole sequence aborts and rolls back. Statements run "sequentially, non-concurrently". Results come back in input order.
  Source: https://developers.cloudflare.com/d1/worker-api/d1-database/ (read 2026-10-28)
- Interactive transactions (BEGIN / app logic / COMMIT across round trips): the D1 Worker API page does not mention them, and the SQL statements page does not say they are supported or unsupported. **Unconfirmed from Cloudflare docs.** Treat as unavailable; use `batch()`.
  Sources: same page above; https://developers.cloudflare.com/d1/sql-api/sql-statements/ (read 2026-10-28)
- `exec()`: stops on first error; the page does not say earlier statements roll back. Docs recommend it only for maintenance and one-shot tasks. Do not use for writes needing atomicity.
  Source: https://developers.cloudflare.com/d1/worker-api/d1-database/ (read 2026-10-28)
- Drizzle D1 driver:
  - Drizzle's own pages (Connect D1, Get started D1, Batch API, Transactions) say nothing D1-specific about batch or transactions. The Batch API page names only Neon HTTP as a supported driver in its text, so D1 batch support is **unconfirmed from the Drizzle docs prose**.
    Sources: https://orm.drizzle.team/docs/connect-cloudflare-d1 , https://orm.drizzle.team/docs/batch-api , https://orm.drizzle.team/docs/transactions (read 2026-10-28)
  - Drizzle source (first-party code) shows the D1 session implements `batch()` by building prepared statements and sending them in a single `client.batch(...)` call, so it inherits D1's atomic batch behavior. It also implements `transaction()` as separate `begin`, callback, `commit` (`rollback` on throw) statements. Whether D1 honors that across separate calls is **unconfirmed** (D1 docs silent); do not rely on it.
    Source: https://raw.githubusercontent.com/drizzle-team/drizzle-orm/main/drizzle-orm/src/d1/session.ts (read 2026-10-28)

## (b) Unique-constraint idempotency key in D1

- Soundness: a UNIQUE column on the key, written in the same `batch()` as the expense and split rows, makes the whole batch roll back on a duplicate, because a failing statement aborts the sequence (see (a)). That follows from the documented batch semantics; Cloudflare does not publish an idempotency pattern, so the pattern itself is my inference. Batch statements run non-concurrently per the docs, so two concurrent submits cannot both insert the same key.
- Returning the original result on a repeat: on a unique-constraint error from the batch, SELECT the expense by idempotency key and return it. Alternative is `INSERT ... ON CONFLICT DO NOTHING`, then check `meta.changes` (meta fields `changes`, `last_row_id`, `rows_written` appear in `run()` results), but a conflict-ignored statement does not abort the batch, so later split inserts would still run. Prefer letting the conflict error abort the batch. `INSERT ... RETURNING` behaviour in D1 is **not documented** on the prepared-statements page (unconfirmed).
  Source: https://developers.cloudflare.com/d1/worker-api/prepared-statements/ (read 2026-10-28)
- SQLite ON CONFLICT semantics themselves are SQLite documentation, not read here (outside the requested source set).

## (c) KV consistency, TTL, fit for a 60 s idempotency token

- Consistency: "KV achieves high performance by being eventually-consistent." Changes are usually immediately visible in the same location, but "this is not guaranteed". Elsewhere "changes may take up to 60 seconds or more to be visible". "KV is not ideal for applications where you need support for atomic operations." No read-your-writes guarantee is stated. The docs suggest Durable Objects for write-after-write consistency.
  Source: https://developers.cloudflare.com/kv/concepts/how-kv-works/ (read 2026-10-28)
- Minimum TTL: `expirationTtl` minimum is 60 seconds; shorter expirations are unsupported.
  Source: https://developers.cloudflare.com/kv/api/write-key-value-pairs/ (read 2026-10-28)
- Concurrent writes to the same key "can end up overwriting one another"; max 1 write per second to the same key (429 beyond that).
  Source: https://developers.cloudflare.com/kv/api/write-key-value-pairs/ (read 2026-10-28)
- Related limits: min `cacheTtl` 30 s; key 512 bytes; value 25 MiB; 1,000 operations per invocation.
  Source: https://developers.cloudflare.com/kv/platform/limits/ (read 2026-10-28)
- Fitness: the 60 s minimum TTL equals the token window, so a 60 s token is permitted. However, a get-then-put check is not atomic, propagation can take 60 s or more across locations, and negative lookups are cached, so two requests hitting different locations can both pass. KV is **not** a sound sole guard against double submits. It is acceptable only as a best-effort fast-path hint in front of D1.

## D1 limits relevant to an expense plus N split rows

Source: https://developers.cloudflare.com/d1/platform/limits/ (read 2026-10-28)
- Queries per Worker invocation: 1000 (Paid) / 50 (Free). A `batch()` call counts as a single query.
- Bound parameters per query: 100 (relevant if splits go in one multi-row INSERT: rows x columns must be <= 100).
- Max SQL statement length: 100 KB.
- Max query duration: 30 s, applies to the whole batch.
- Batch size: no statement-count cap stated; per-statement limits still apply.
- Row/string/BLOB size: 2 MB. Database size: 10 GB Paid / 500 MB Free.

## Recommendation

1. Write the expense and all split rows in one D1 `batch()`; it is the documented atomic path. Do not depend on interactive transactions.
2. Put a UNIQUE idempotency key on the expense row inside that batch; on a unique violation, SELECT and return the stored expense.
3. Use Drizzle's `db.batch([...])` for D1 (source maps it to a single D1 batch) and verify with a rollback test, since Drizzle prose is silent.
4. Do not use KV as the idempotency guard; at most a best-effort hint, with D1 as source of truth.
5. Keep bound parameters per statement under 100; one INSERT per split row inside the batch is the safe shape.
