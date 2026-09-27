CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`actor_id` text,
	`actor_email` text,
	`action` text NOT NULL,
	`target` text,
	`ip` text,
	`detail` text
);
--> statement-breakpoint
CREATE INDEX `audit_events_at` ON `audit_events` (`at`);