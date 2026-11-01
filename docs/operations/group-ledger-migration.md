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

Set helper shell variables for operator convenience:
```bash
export BASE_URL="https://split.rickchen.si"
export MAINTENANCE_SECRET="<your-secret-entered-in-step-2>"
```

1. Look up the candidate ID for the retained group 「明天去哪玩」 in D1:
   ```bash
   pnpm --filter @split/worker exec wrangler d1 execute split-prod --remote \
     --command "SELECT id, name, currency FROM groups WHERE name = '明天去哪玩';"
   ```
   Save the returned ID:
   ```bash
   export RETAINED_ID="<id-from-query-above>"
   ```

2. Capture and verify the consistent pre-migration snapshot:
   ```bash
   curl -s "${BASE_URL}/api/v1/maintenance/migration/snapshot/${RETAINED_ID}" \
     -H "X-Maintenance-Bypass: ${MAINTENANCE_SECRET}"
   ```
   - The endpoint verifies that `${RETAINED_ID}` matches the unique group named `明天去哪玩`.
   - Record the returned SHA-256 fingerprint from the JSON response.
   - The maintenance gate remains active throughout snapshot, import, and wipe.

### 4. Idempotent Import & Retained-Group Verification

1. Execute the migration import into the target group's Durable Object:
   ```bash
   curl -s -X POST "${BASE_URL}/api/v1/maintenance/migration/import/${RETAINED_ID}" \
     -H "X-Maintenance-Bypass: ${MAINTENANCE_SECRET}"
   ```
   - This populates the target Group's ledger DO, verifies the zero-sum balance invariant across members, registers D1 capacity reservations and active invites, and drains the D1 read-model projections (`group_directory`, `group_member_summary`, `personal_spending`).
   - The operation is idempotent and safe to retry if interrupted.

2. Verify the imported group details and zero-sum invariant:
   - Check group details:
     ```bash
     curl -s "${BASE_URL}/api/v1/groups/${RETAINED_ID}" -H "X-Maintenance-Bypass: ${MAINTENANCE_SECRET}"
     ```
   - Check members:
     ```bash
     curl -s "${BASE_URL}/api/v1/groups/${RETAINED_ID}/members" -H "X-Maintenance-Bypass: ${MAINTENANCE_SECRET}"
     ```
   - Check zero-sum balance:
     ```bash
     curl -s "${BASE_URL}/api/v1/groups/${RETAINED_ID}/balances" -H "X-Maintenance-Bypass: ${MAINTENANCE_SECRET}"
     ```
   - Verify expenses, settlements, and stops return 200.

### 5. Controlled Wipe of Excluded Groups

Only after verifying the retained group and with explicit owner approval:
1. Execute controlled wipe:
   ```bash
   curl -s -X POST "${BASE_URL}/api/v1/maintenance/migration/wipe-excluded/${RETAINED_ID}" \
     -H "X-Maintenance-Bypass: ${MAINTENANCE_SECRET}"
   ```
2. The endpoint:
   - Uniquely re-verifies the retained group `明天去哪玩` and checks that its ledger DO is operational and zero-sum balanced.
   - Wipes excluded groups, members, invites, expenses, expense payers, expense splits, settlements, stops, and read-model rows in a single D1 transaction.
   - Persists excluded group IDs in `migration_wipe_pending` to guarantee safe retries if any DO ledger deletion fails. If the endpoint returns `failedLedgers`, re-run the curl command until it succeeds.
   - Preserves all users, identities, sessions, settings, and the retained group.
3. Confirm that excluded groups return 404, while the retained group remains accessible.

### 6. Post-Cutover Verification & Gate Removal

1. Verify system health:
   ```bash
   curl -s "${BASE_URL}/api/v1/health"
   ```
2. Verify live WebSocket connection (`split.v1` protocol and ping/pong).
3. Verify test sign-in route returns 404:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "${BASE_URL}/api/v1/auth/test-sign-in"
   # Expected: 404
   ```
4. Remove the maintenance gate to restore normal user writes:
   ```bash
   pnpm --filter @split/worker exec wrangler secret delete MAINTENANCE --env production
   ```
5. Monitor production error logs and observability dashboard.

## Rollback & Disaster Recovery

1. **Before wipe:** Keep the maintenance gate enabled and roll back the Worker if required. Import may have changed legacy projections; restore the verified pre-cutover backup if the legacy state needs to be recovered exactly.
2. **After wipe, before gate removal:** Keep the gate enabled. Restore the pre-cutover D1 backup before rolling back the Worker, because excluded groups have been deleted. If continuing the cutover instead, retry `wipe-excluded` with the same retained ID; the persisted pending list includes interrupted deletions, and an error reports `failedLedgers`.
3. **After gate removal:** Rollback requires restoring the pre-cutover D1 backup and rolling back the Worker. Writes created since cutover will be lost; the ledger is authoritative and there is no reverse mirror.

## Release 2 Follow-up & Known Edge Cases

The following items are deferred to Release 2 as documented non-blocking backlog:
1. **D1 Legacy Table Drop**: Once the group ledger Durable Object has run stably in production, apply migration `0008` to drop legacy tables (`expenses`, `expense_payers`, `expense_splits`, `settlements`, `stops`, `members`, `groups`, `migration_wipe_pending`).
2. **Reservation Concurrency Hardening**: In `auth/reservations.ts`, harden `withReservation` to distinguish transient network failures from confirmed commits so concurrent joins cannot prematurely remove a valid reservation.
3. **Signal & Projection Drainage Sequencing**: Ensure live WebSocket signals for `member-op` are dispatched only after D1 read-model projection batches have fully completed.
4. **Multi-DO Account Deletion Compensation**: In `auth/accounts.ts`, implement two-phase rollback/unfreeze if multi-ledger finalization fails midway.
5. **Initial In-Flight Query Cancellation**: Enhance `sync.ts` to abort in-flight fetch requests on first socket connect when no cached data exists.
6. **Placeholder Ghost Member Cleanup**: Purge legacy placeholder members from D1 once referenced legacy expenses are removed.
