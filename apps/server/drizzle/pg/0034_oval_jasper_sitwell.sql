ALTER TABLE "users" ADD COLUMN "graph_mobile" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "default_theme" text DEFAULT 'light' NOT NULL;