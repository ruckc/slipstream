ALTER TABLE "projects" DROP CONSTRAINT "projects_status_check";--> statement-breakpoint
ALTER TABLE "namespaces" DROP COLUMN "k8s_namespace";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "status";