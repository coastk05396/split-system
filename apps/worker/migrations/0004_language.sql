ALTER TABLE `users` ADD `language` text DEFAULT 'zh-TW' NOT NULL CONSTRAINT "users_language_check" CHECK(`language` IN ('zh-TW', 'en'));
