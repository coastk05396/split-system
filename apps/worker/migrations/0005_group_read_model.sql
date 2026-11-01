CREATE TABLE group_directory (
  group_id TEXT PRIMARY KEY,
  name TEXT,
  settlement_currency TEXT,
  is_trip INTEGER,
  trip_destination TEXT,
  trip_start_date TEXT,
  trip_end_date TEXT,
  trip_notes TEXT,
  settlement_currency_locked INTEGER,
  member_count INTEGER,
  member_preview TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  rev INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE group_member_summary (
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  role TEXT NOT NULL,
  net_balance INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  PRIMARY KEY (user_id, group_id)
);
--> statement-breakpoint
CREATE TABLE group_reservations (
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, group_id)
);
