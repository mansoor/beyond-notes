ALTER TABLE `pages` ADD `lock_policy` text;--> statement-breakpoint
ALTER TABLE `spaces` ADD `lock_policy` text;--> statement-breakpoint
ALTER TABLE `users` ADD `sidebar_hidden` text DEFAULT '[]' NOT NULL;