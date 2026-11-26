-- Track pending reservations transferred by Merge and one-time Former Member backfill for cold Groups.
ALTER TABLE merge_cleanups ADD COLUMN pending_reservation_at INTEGER;
ALTER TABLE group_directory ADD COLUMN membership_reprojected INTEGER NOT NULL DEFAULT 0;
ALTER TABLE group_directory ADD COLUMN membership_backfill_retry_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS group_directory_membership_reprojected_idx ON group_directory (deleted, membership_reprojected, membership_backfill_retry_at);
