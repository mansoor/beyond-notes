CREATE TABLE `ai_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`space_id` text NOT NULL,
	`seq` integer NOT NULL,
	`text` text NOT NULL,
	`model` text NOT NULL,
	`vector` blob NOT NULL,
	`source_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_chunks_page_idx` ON `ai_chunks` (`page_id`);