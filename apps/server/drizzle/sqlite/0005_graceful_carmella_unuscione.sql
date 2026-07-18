CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gallery_items` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `page_versions` ADD `attachment_ids` text DEFAULT '[]' NOT NULL;