CREATE TABLE line_push_usage (
  month TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0 CHECK(count >= 0)
);
