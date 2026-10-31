# Retaining a Group during the Group ledger migration

This procedure is not ready for production until the import, verification and staging rehearsal in ticket 16 are complete. Do not run a production migration or delete data until the owner approves the actual deployment.

1. Export a complete D1 backup and verify it can be restored in an isolated environment. Keep the backup outside the repository.
2. Obtain the owner's approval for a read-only production lookup. List candidate Group IDs and have the owner identify the intended Group using independent details. Record the confirmed ID outside the repository. Stop if the target cannot be uniquely verified.
3. Enable the maintenance gate before taking the source snapshot and keep it enabled through import and verification. Do not allow bypass writes during the snapshot or verification.
4. With the gate enabled, an authorized operator can read `/api/v1/maintenance/migration/snapshot/:id` using the maintenance bypass header. The endpoint rejects a Group ID unless it is the only Group named `明天去哪玩`. It returns a SHA-256 fingerprint and a snapshot that includes personal data and Invite tokens. Handle the response as sensitive, keep it outside the repository, and do not paste it into logs or issue trackers.
5. Re-read the source and compare fingerprints before cutover. Stop if the fingerprint changes. Import and verify every retained record, Member's Balance, zero-sum invariant, User access and read model before removing any legacy data. A successful snapshot alone does not establish that the destination is correct.
6. Preserve Users, Identities, Sessions and User settings. Delete other Groups only as part of the owner-approved deployment, after the retained Group is verified and the backup is available. Keep the retained Group's legacy source until verification is complete.
7. If import or verification fails, leave maintenance enabled and the legacy source intact. Restore the backed-up system using the rehearsed rollback procedure; do not reopen writes until the owner verifies it.

Rehearse the full procedure on staging using representative data and a restorable backup before requesting production approval. The exact import and cutover commands will be documented once implemented and verified.
