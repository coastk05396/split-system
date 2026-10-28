---
title: Research D1 atomicity and KV consistency
type: wayfinder:research
mode: AFK
status: closed
assignee:
parent: ../map.md
blocked_by: []
---

## Question

Confirm from Cloudflare docs: (a) how to make a multi-row write atomic in D1 from a Worker (batch vs interactive transactions, and what Drizzle supports); (b) whether a unique-constraint idempotency key in D1 is the right way to stop double submits; (c) KV consistency model and minimum TTL, and whether KV is fit for a 60-second idempotency token.

## Resolution

Write an Expense and all its split rows in one D1 `batch()`, which Cloudflare documents as a SQL transaction that rolls back whole on any failure; interactive transactions are not confirmed, so do not rely on them. Put a UNIQUE idempotency key on the Expense row inside that batch; on a duplicate, select and return the stored Expense. Use Drizzle's `db.batch` on D1 (its docs do not confirm D1 support but its source sends one D1 batch), and add a rollback test. KV is not a guard: it is eventually consistent (60 seconds or more across locations) and its minimum TTL is 60 seconds, so at most a hint in front of D1.

Findings: branch `research/research-d1-and-kv-guarantees` on origin, file `docs/research/research-d1-and-kv-guarantees.md` (throwaway, never merged; the commit is unsigned).
