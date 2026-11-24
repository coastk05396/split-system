-- Contract daily_flights to round-trip-only Explore fares (ADR 0013): no trip type, return-leg stops,
-- red-eye flag or departure times, a mandatory return date, and only active origins. The board is
-- rebuilt on every run, so rows that do not fit are dropped rather than converted.
CREATE TABLE daily_flights_new (
  id TEXT PRIMARY KEY,
  digest_date TEXT NOT NULL,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  out_date TEXT NOT NULL,
  in_date TEXT NOT NULL,
  price_twd INTEGER NOT NULL,
  discount_pct INTEGER NOT NULL,
  tag TEXT NOT NULL,
  airlines_json TEXT NOT NULL,
  transfers INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT INTO daily_flights_new
  (id, digest_date, origin, destination, out_date, in_date, price_twd, discount_pct, tag, airlines_json, transfers, created_at)
SELECT id, digest_date, origin, destination, out_date, in_date, price_twd, discount_pct, tag, airlines_json, transfers, created_at
FROM daily_flights
WHERE trip_type = 'rt' AND in_date IS NOT NULL AND in_date > out_date AND origin IN ('TPE', 'TSA', 'KHH');

DROP TABLE daily_flights;
ALTER TABLE daily_flights_new RENAME TO daily_flights;
CREATE INDEX daily_flights_digest_price_idx ON daily_flights (digest_date, price_twd);
