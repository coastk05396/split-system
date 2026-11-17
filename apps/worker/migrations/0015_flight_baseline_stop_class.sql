-- Baselines are per stop class (direct vs connecting) now (ADR 0010). The 3-day cache is disposable
-- and rebuilds on the next daily run, so the table is recreated with the wider primary key.
DROP TABLE IF EXISTS flight_baselines;
CREATE TABLE IF NOT EXISTS flight_baselines (
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  trip_type TEXT NOT NULL,
  month TEXT NOT NULL,
  stop_class TEXT NOT NULL,
  baseline_twd INTEGER,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (origin, destination, trip_type, month, stop_class)
);
