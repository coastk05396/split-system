-- One row: the last daily run that discovered fares and completed, even with zero Good Deals.
-- An empty daily_flights with this row is an empty board; without it the data is unavailable (curated fallback).
CREATE TABLE IF NOT EXISTS daily_flights_runs (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  digest_date TEXT NOT NULL,
  completed_at INTEGER NOT NULL
);
