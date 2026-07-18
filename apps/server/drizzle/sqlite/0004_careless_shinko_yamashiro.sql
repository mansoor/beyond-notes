ALTER TABLE `pages` ADD `page_type` text DEFAULT 'doc' NOT NULL;--> statement-breakpoint
ALTER TABLE `spaces` ADD `public_theme` text DEFAULT 'paper' NOT NULL;