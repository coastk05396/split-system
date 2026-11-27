-- Pending Merge confirmations (short-lived, single-use, session-bound) and durable
-- per-Group merge cleanup tasks (reusing the account_cleanups pattern).
CREATE TABLE pending_merges (
  id TEXT PRIMARY KEY,
  kept_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  other_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  other_provider TEXT NOT NULL,
  other_email TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX pending_merges_expires_idx ON pending_merges (expires_at);

CREATE TABLE merge_cleanups (
  kept_user_id TEXT NOT NULL,
  other_user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (other_user_id, group_id)
);
