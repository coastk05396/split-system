CREATE TABLE flight_fare_history (
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  currency TEXT NOT NULL,
  advance_window TEXT NOT NULL,
  observed_day TEXT NOT NULL,
  price INTEGER NOT NULL CHECK(price > 0),
  card_json TEXT NOT NULL,
  PRIMARY KEY(origin,destination,currency,advance_window,observed_day)
);
CREATE INDEX flight_fare_history_day ON flight_fare_history(observed_day);
