-- Google Flights typical price range per Route (ADR 0013), cached for 30 days. Replaces the per-month,
-- per-stop-class medians; that cache was disposable, so the table is recreated.
DROP TABLE IF EXISTS flight_baselines;
CREATE TABLE flight_baselines (
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  typical_low_twd INTEGER NOT NULL,
  typical_high_twd INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (origin, destination)
);
