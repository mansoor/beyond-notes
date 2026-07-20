CREATE TABLE `previews` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`page_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `previews_token_hash_unique` ON `previews` (`token_hash`);--> statement-breakpoint
ALTER TABLE `page_versions` ADD `meta_description` text;--> statement-breakpoint
ALTER TABLE `page_versions` ADD `tags` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `pages` ADD `meta_description` text;