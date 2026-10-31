# Retaining a Group during the Group ledger migration

This procedure is documented for Release 1. Do not run a production migration or delete data until the owner approves the actual deployment.

## Release 1 Cutover Checklist

### 1. Pre-cutover Backup
- Export a complete D1 backup outside the repository:
  ```bash
  pnpm --filter @split/worker exec wrangler d1 export split-prod --remote --output=/tmp/backup-split-prod-$(date +%s).sql
  ```
- Verify backup integrity by testing restore in an isolated local or staging database. Keep the exported backup file outside the repository and protected.

### 2. Enable Maintenance Gate
- Enable the maintenance gate on the live Worker before taking snapshots or modifying data:
  ```bash
  pnpm --filter @split/worker exec wrangler secret put MAINTENANCE --env production
  ```
- Confirm that data-modifying requests receive HTTP 503 (`SERVICE_UNAVAILABLE`), while read requests continue to serve normally.
- Provide the generated secret to authorized operators via the `X-Maintenance-Bypass` header over HTTPS.

### 3. Verify Target Group & Snapshot
- Confirm the unique identity of the retained group 「明天去哪玩」:
  - Query group candidate IDs.
  - Operator calls `GET /api/v1/maintenance/migration/snapshot/:id` with `X-Maintenance-Bypass: <secret>`.
  - The endpoint rejects any ID unless it uniquely identifies the single group named `明天去哪玩`.
  - Record the returned SHA-256 fingerprint.

### 4. Deploy Additive Schema and New Worker
- Apply additive D1 migrations:
  ```bash
  pnpm --filter @split/worker exec wrangler d1 migrations apply DB --env production
  ```
- Deploy the new Worker with `GROUP_LEDGER` Durable Object bindings and SQLite class migrations (`tag: v1`):
  ```bash
  pnpm --filter @split/worker exec wrangler deploy --env production
  ```
- The maintenance gate remains active throughout deployment and import.

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
  2. Marks any active ledger DOs for excluded groups as deleted.
  3. Atomically wipes excluded groups, members, invites, expenses, expense payers, expense splits, settlements, stops, and read-model rows (`group_directory`, `group_member_summary`, `group_reservations`, `personal_spending`) in D1.
  4. Preserves all users, identities, sessions, settings, and the retained group.
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

1. **Failure during Snapshot or Import (before Wipe)**:
   - Keep maintenance gate enabled.
   - Roll back Worker deployment to previous version:
     ```bash
     pnpm --filter @split/worker exec wrangler rollback --env production
     ```
   - Legacy D1 tables are untouched. Revert maintenance gate once verified.
2. **Failure after Wipe**:
   - Keep maintenance gate enabled.
   - Restore database from the pre-cutover backup:
     ```bash
     pnpm --filter @split/worker exec wrangler d1 execute DB --env production --file=/tmp/backup-split-prod.sql
     ```
   - Roll back Worker deployment if needed.
   - Verify restored state, then remove maintenance gate.
