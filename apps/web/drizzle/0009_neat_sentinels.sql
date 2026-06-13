ALTER TABLE "projects" ADD COLUMN "kube_deploy_access" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_active_at" timestamp DEFAULT now();