ALTER TABLE `users` ADD `reminder_days` integer DEFAULT 7 NOT NULL;--> statement-breakpoint
-- the two horizons were one setting until now: carry it, so nobody's Today
-- page changes shape on upgrade
UPDATE `users` SET `reminder_days` = `coming_up_days`;