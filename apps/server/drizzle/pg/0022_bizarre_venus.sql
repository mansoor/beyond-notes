ALTER TABLE "db_rows" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "db_tables" ADD COLUMN "form" text;