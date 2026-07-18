CREATE TABLE `page_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`content` text NOT NULL,
	`html` text NOT NULL,
	`text_plain` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `pages` ADD `slug` text;--> statement-breakpoint
ALTER TABLE `pages` ADD `live_version_id` text;--> statement-breakpoint
ALTER TABLE `spaces` ADD `public_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `spaces` ADD `public_host` text;--> statement-breakpoint
ALTER TABLE `spaces` ADD `public_title` text;--> statement-breakpoint
ALTER TABLE `spaces` ADD `public_footer` text;--> statement-breakpoint
CREATE UNIQUE INDEX `spaces_public_host_unique` ON `spaces` (`public_host`);