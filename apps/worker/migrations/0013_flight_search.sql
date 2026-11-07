CREATE TABLE flight_search_cache (
  cache_key TEXT PRIMARY KEY,
  response TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX flight_search_cache_expiry ON flight_search_cache(expires_at);
