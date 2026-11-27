-- Speed up per-Group merging checks on writes and Group listings.
CREATE INDEX IF NOT EXISTS merge_cleanups_group_idx ON merge_cleanups (group_id);
