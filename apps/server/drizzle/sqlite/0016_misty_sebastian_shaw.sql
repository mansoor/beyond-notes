CREATE TABLE `page_links` (
	`from_page_id` text NOT NULL,
	`to_page_id` text NOT NULL,
	PRIMARY KEY(`from_page_id`, `to_page_id`),
	FOREIGN KEY (`from_page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `page_slugs` (
	`page_id` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`page_id`, `slug`),
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `pages` ADD `trashed_at` integer;--> statement-breakpoint
ALTER TABLE `pages` ADD `trashed_by` text;