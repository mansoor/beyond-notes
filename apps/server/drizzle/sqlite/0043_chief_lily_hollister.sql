CREATE TABLE `newsletter_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`page_id` text,
	`subject` text NOT NULL,
	`status` text NOT NULL,
	`send_after` integer NOT NULL,
	`cursor` text,
	`recipients` integer DEFAULT 0 NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `newsletter_issues_space_idx` ON `newsletter_issues` (`space_id`);--> statement-breakpoint
CREATE TABLE `newsletter_subscribers` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`email` text NOT NULL,
	`status` text NOT NULL,
	`token` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	`confirmed_at` integer,
	`unsubscribed_at` integer,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `newsletter_subscribers_space_email` ON `newsletter_subscribers` (`space_id`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `newsletter_subscribers_token` ON `newsletter_subscribers` (`token`);