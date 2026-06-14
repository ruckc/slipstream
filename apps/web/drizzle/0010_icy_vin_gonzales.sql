ALTER TABLE "usage_samples" DROP CONSTRAINT "usage_samples_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "usage_samples" ADD CONSTRAINT "usage_samples_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;