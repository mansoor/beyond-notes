ALTER TABLE `pages` ADD `gallery_autoplay_secs` integer;--> statement-breakpoint
ALTER TABLE `spaces` ADD `public_logo_attachment_id` text;--> statement-breakpoint
ALTER TABLE `spaces` ADD `public_tagline` text;--> statement-breakpoint
ALTER TABLE `spaces` ADD `public_header_layout` text DEFAULT 'classic' NOT NULL;