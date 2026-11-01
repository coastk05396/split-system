# Retaining a Group during the Group ledger migration

This procedure is documented for Release 1. Do not run a production migration or delete data until the owner approves the actual deployment.

## Release 1 Cutover Checklist

### 1. Pre-cutover Backup

- Export a complete D1 backup outside the repository:
  ```bash
  pnpm --filter @split/worker exec wrangler d1 export split-prod --remote --output=/tmp/backup-split-prod-$(date +%s).sql
  ```
- Verify backup integrity by testing restore in an isolated local or staging database. Keep the exported backup file outside the repository and protected.

### 2. Deploy the Worker with the Gate and Snapshot, Then Enable the Gate

The gate and the snapshot endpoint exist only in the new Worker. Setting `MAINTENANCE` on the old Worker blocks nothing, and the snapshot route answers 404 there. So the new Worker goes out first, with the gate secret attached to the same version so it is never served ungated:

- Apply additive D1 migrations (no table is dropped; the drop belongs to Release 2):
  ```bash
  pnpm --filter @split/worker exec wrangler d1 migrations apply DB --env production
  ```
- Upload the new Worker as a version (it carries the `GROUP_LEDGER` Durable Object binding and SQLite class migration `tag: v1`), attach the secret to that version, then deploy it:
  ```bash
  pnpm --filter @split/worker exec wrangler versions upload --env production
  pnpm --filter @split/worker exec wrangler versions secret put MAINTENANCE --env production
  pnpm --filter @split/worker exec wrangler versions deploy --env production
  ```
  Rehearse these three commands on staging first. If your Wrangler version lacks them, deploy and then run `wrangler secret put MAINTENANCE --env production` straight away, accepting a short window in which the new Worker is live and ungated.
- Confirm that data-modifying requests receive HTTP 503 (`SERVICE_UNAVAILABLE`), while read requests continue to serve normally.
- Provide the generated secret to authorized operators via the `X-Maintenance-Bypass` header over HTTPS.

### 3. Verify Target Group & Snapshot

- Confirm the unique identity of the retained group 「明天去哪玩」:
  - Query group candidate IDs.
  - Operator calls `GET /api/v1/maintenance/migration/snapshot/:id` with `X-Maintenance-Bypass: <secret>`.
  - The endpoint rejects any ID unless it uniquely identifies the single group named `明天去哪玩`.
  - Record the returned SHA-256 fingerprint.
- The gate stays active throughout the snapshot, import and wipe.

### 5. Idempotent Import & Retained-Group Verification

- Execute import with bypass:
  ```bash
  curl -X POST https://split.rickchen.si/api/v1/maintenance/migration/import/<retained-id> \
    -H "X-Maintenance-Bypass: <secret>"
  ```
- The import populates the target Group's ledger DO, verifies the zero-sum invariant across members, sets up user reservations and active invites in D1, and drains read-model tables (`group_directory`, `group_member_summary`, `personal_spending`). The import is idempotent and safely retryable.
- Verify the retained Group:
  - Check group details: `GET /api/v1/groups/<retained-id>`
  - Check member list and roles: `GET /api/v1/groups/<retained-id>/members`
  - Check zero-sum balance: `GET /api/v1/groups/<retained-id>/balances`
  - Check expenses, settlements, and stops
  - Verify unexpired sessions and both Google and LINE authentication

### 6. Controlled Wipe of Excluded Groups

- Only after successful verification of the retained group and with owner approval, execute controlled wipe:
  ```bash
  curl -X POST https://split.rickchen.si/api/v1/maintenance/migration/wipe-excluded/<retained-id> \
    -H "X-Maintenance-Bypass: <secret>"
  ```
- The endpoint:
  1. Uniquely re-verifies the retained group `明天去哪玩` and checks that its ledger DO is operational.
  2. Records excluded ledger IDs and wipes excluded groups, members, invites, expenses, expense payers, expense splits, settlements, stops, and read-model rows (`group_directory`, `group_member_summary`, `group_reservations`, `personal_spending`) in a D1 transaction, then deletes each ledger and retains failed IDs for retry.
     The excluded group IDs are first written to `migration_wipe_pending` in the same D1 batch (the table is created on first use by the endpoint, not by a migration). After the D1 rows are gone this table is the only retry list: a rerun reads it, deletes the remaining ledgers and clears each row. If the endpoint returns `failedLedgers`, run it again until it succeeds.
  3. Preserves all users, identities, sessions, settings, and the retained group.
- Re-verify that excluded groups return 404, while the retained group remains accessible and authentication continues to function.

### 7. Post-Cutover Verification & Gate Removal

- Verify health: `GET /api/v1/health`
- Verify WebSocket live connection (`split.v1` protocol and ping/pong).
- Verify test sign-in route returns 404 (`TEST_SIGN_IN` absent in production).
- Remove maintenance gate:
  ```bash
  pnpm --filter @split/worker exec wrangler secret delete MAINTENANCE --env production
  ```
- Monitor production error logs and observability dashboard.

## Rollback & Disaster Recovery

1. **Before wipe:** Keep the maintenance gate enabled and roll back the Worker if required. Import may have changed legacy projections; restore the verified pre-cutover backup if the legacy state needs to be recovered exactly.
2. **After wipe, before gate removal:** Keep the gate enabled. Restore the pre-cutover D1 backup before rolling back the Worker, because excluded groups have been deleted. If continuing the cutover instead, retry `wipe-excluded` with the same retained ID; the persisted pending list includes interrupted deletions, and an error reports `failedLedgers`.
3. **After gate removal:** Rollback requires restoring the pre-cutover D1 backup and rolling back the Worker. Writes created since cutover will be lost; the ledger is authoritative and there is no reverse mirror.
