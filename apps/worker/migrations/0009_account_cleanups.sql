CREATE TABLE account_cleanups (
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, group_id)
);
