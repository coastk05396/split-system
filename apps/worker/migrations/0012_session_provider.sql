-- Which Identity a session signed in with, so one browser's sign-in never relabels another's.
-- Sessions made before this stay NULL and fall back to the User's last_provider.
ALTER TABLE sessions ADD COLUMN provider TEXT;
