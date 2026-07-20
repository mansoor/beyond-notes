CREATE TABLE `page_tags` (
	`page_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`page_id`, `tag`),
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
