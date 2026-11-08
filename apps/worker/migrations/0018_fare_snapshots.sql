CREATE TABLE flight_fare_snapshots (
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  currency TEXT NOT NULL,
  departure_date TEXT NOT NULL,
  price INTEGER NOT NULL CHECK(price > 0),
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY(origin,destination,currency,departure_date)
);
CREATE INDEX flight_fare_snapshots_date ON flight_fare_snapshots(departure_date);
