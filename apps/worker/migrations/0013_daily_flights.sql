-- Verified daily cheap flight deals departing Taiwan.
CREATE TABLE daily_flights (
  id TEXT PRIMARY KEY,
  digest_date TEXT NOT NULL,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  trip_type TEXT NOT NULL,
  out_date TEXT NOT NULL,
  in_date TEXT,
  price_twd INTEGER NOT NULL,
  discount_pct INTEGER NOT NULL,
  tag TEXT NOT NULL,
  airlines_json TEXT NOT NULL,
  transfers INTEGER NOT NULL,
  return_transfers INTEGER,
  is_red_eye INTEGER NOT NULL DEFAULT 0,
  outbound_dep TEXT,
  inbound_dep TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX daily_flights_digest_price_idx ON daily_flights (digest_date, price_twd);
