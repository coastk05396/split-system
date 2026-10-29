ALTER TABLE `settlements` ADD `created_by_member_id` text REFERENCES members(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `settlements` ADD `confirmed_by_member_id` text REFERENCES members(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `settlements` ADD `undone_by_member_id` text REFERENCES members(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `settlements` ADD `undone_at` integer;