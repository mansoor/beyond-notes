ALTER TABLE `spaces` ADD `analytics_provider` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `spaces` ADD `analytics_site_id` text;--> statement-breakpoint
ALTER TABLE `spaces` ADD `analytics_host` text;