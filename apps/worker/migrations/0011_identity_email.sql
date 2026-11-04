ALTER TABLE identities ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN last_provider TEXT;
-- Linked Google accounts predate the stored email; their owners link again.
DELETE FROM identities WHERE provider = 'google';
UPDATE users SET last_provider = (
  SELECT provider FROM identities WHERE identities.user_id = users.id ORDER BY created_at LIMIT 1
);
