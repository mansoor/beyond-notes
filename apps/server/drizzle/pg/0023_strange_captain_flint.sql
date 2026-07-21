ALTER TABLE "db_tables" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "db_tables" ADD COLUMN "archived_by" text;