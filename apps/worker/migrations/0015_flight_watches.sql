CREATE TABLE flight_price_watches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  intent_json TEXT NOT NULL,
  baseline_fare INTEGER NOT NULL CHECK(baseline_fare>0),
  target_fare INTEGER NOT NULL CHECK(target_fare>0),
  channel TEXT NOT NULL CHECK(channel IN ('web_push','line_push')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','triggered','expired','cancelled')),
  latest_fare INTEGER,
  checked_at INTEGER,
  created_at INTEGER NOT NULL,
  departure_date TEXT NOT NULL,
  claim_token TEXT,
  claim_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX flight_watches_user_status ON flight_price_watches(user_id,status,channel);
CREATE INDEX flight_watches_status ON flight_price_watches(status,claim_until);
CREATE UNIQUE INDEX flight_watch_active_route ON flight_price_watches(user_id,intent_json,channel) WHERE status='active';
CREATE TABLE web_push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX web_push_subscriptions_user ON web_push_subscriptions(user_id);
