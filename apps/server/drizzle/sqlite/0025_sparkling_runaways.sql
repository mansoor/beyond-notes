ALTER TABLE `pages` ADD `lock_idle_minutes` integer;--> statement-breakpoint
ALTER TABLE `spaces` ADD `lock_idle_minutes` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `coming_up_days` integer DEFAULT 7 NOT NULL;