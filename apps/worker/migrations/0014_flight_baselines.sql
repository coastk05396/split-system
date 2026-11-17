-- Month-matrix median baselines cached for 3 days by the daily flights sync (ADR 0009).
CREATE TABLE flight_baselines (
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  trip_type TEXT NOT NULL,
  month TEXT NOT NULL,
  baseline_twd INTEGER,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (origin, destination, trip_type, month)
);
