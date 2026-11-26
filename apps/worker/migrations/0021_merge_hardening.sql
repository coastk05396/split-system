-- Enforce one Identity per (User, provider) so concurrent links or Merge confirmations cannot attach duplicates.
-- Pre-deploy check on existing databases:
--   SELECT user_id, provider, COUNT(*) FROM identities GROUP BY user_id, provider HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS identities_user_provider_unique ON identities (user_id, provider);

-- Ledger-maintained membership index including Former Members so Merge captures historical seats.
CREATE TABLE IF NOT EXISTS group_memberships (
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  PRIMARY KEY (user_id, group_id)
);

INSERT OR IGNORE INTO group_memberships (user_id, group_id)
SELECT user_id, group_id FROM group_member_summary;

-- Rename expires_at -> next_retry_at so queue ordering is not mistaken for task expiration.
ALTER TABLE merge_cleanups RENAME COLUMN expires_at TO next_retry_at;
CREATE INDEX IF NOT EXISTS merge_cleanups_retry_idx ON merge_cleanups (next_retry_at);
