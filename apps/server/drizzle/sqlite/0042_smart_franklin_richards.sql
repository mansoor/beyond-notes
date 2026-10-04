CREATE TABLE `document_live_states` (
	`page_id` text PRIMARY KEY NOT NULL,
	`state` blob NOT NULL,
	`content_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
