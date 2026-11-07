CREATE TABLE line_sender_counters (
  sender_key TEXT NOT NULL,
  route_group TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(sender_key, route_group, window_start)
);
