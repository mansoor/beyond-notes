ALTER TABLE "pages" ADD COLUMN "lock_idle_minutes" integer;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN "lock_idle_minutes" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "coming_up_days" integer DEFAULT 7 NOT NULL;