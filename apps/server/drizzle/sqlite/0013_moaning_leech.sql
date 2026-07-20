ALTER TABLE `page_versions` ADD `cover_attachment_id` text;--> statement-breakpoint
ALTER TABLE `pages` ADD `gallery_layout` text DEFAULT 'grid' NOT NULL;--> statement-breakpoint
ALTER TABLE `pages` ADD `share_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `pages` ADD `cover_attachment_id` text;--> statement-breakpoint
ALTER TABLE `spaces` ADD `public_social` text DEFAULT '[]' NOT NULL;