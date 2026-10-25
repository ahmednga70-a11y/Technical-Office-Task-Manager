-- Manual initialization for the confirmed external Neon database only.
-- Generated from the Drizzle schema, then wrapped in one atomic statement.
-- Never run automatically at build time, server startup, or during requests.
-- Refuses to proceed if any public table or enum already exists.
DO $office_init$
BEGIN
  SET LOCAL search_path = public;
  SET LOCAL lock_timeout = '5s';
  PERFORM pg_advisory_xact_lock(98123451);
  IF current_database() <> 'neondb' THEN
    RAISE EXCEPTION 'Unexpected database; initialization stopped';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ) OR EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'
  ) THEN
    RAISE EXCEPTION 'Public tables or enums already exist; inspect before applying changes';
  END IF;

  CREATE TYPE "public"."office_attachment_status" AS ENUM('pending', 'ready');
  CREATE TYPE "public"."office_role" AS ENUM('manager', 'engineer');
  CREATE TYPE "public"."project_status" AS ENUM('active', 'on_hold', 'completed');
  CREATE TYPE "public"."task_category" AS ENUM('shop_drawing', 'submittal', 'rfi', 'quantity_takeoff', 'coordination', 'other');
  CREATE TYPE "public"."task_priority" AS ENUM('low', 'medium', 'high', 'urgent');
  CREATE TYPE "public"."task_status" AS ENUM('todo', 'in_progress', 'review', 'done');
  CREATE TABLE "office_attachments" (
    "id" serial PRIMARY KEY NOT NULL,
    "project_id" integer,
    "task_id" integer,
    "uploaded_by_id" integer,
    "uploaded_by_name" text NOT NULL,
    "file_name" text NOT NULL,
    "content_type" text NOT NULL,
    "size" integer NOT NULL,
    "object_path" text NOT NULL,
    "status" "office_attachment_status" DEFAULT 'pending' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "office_attachments_exactly_one_parent_check" CHECK (("office_attachments"."project_id" IS NOT NULL AND "office_attachments"."task_id" IS NULL) OR ("office_attachments"."project_id" IS NULL AND "office_attachments"."task_id" IS NOT NULL))
  );
  CREATE TABLE "office_members" (
    "id" serial PRIMARY KEY NOT NULL,
    "clerk_user_id" text NOT NULL,
    "name" text NOT NULL,
    "email" text NOT NULL,
    "role" "office_role" DEFAULT 'engineer' NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  );
  CREATE TABLE "office_notifications" (
    "id" serial PRIMARY KEY NOT NULL,
    "member_id" integer NOT NULL,
    "task_id" integer NOT NULL,
    "type" text NOT NULL,
    "message" text NOT NULL,
    "dedupe_key" text NOT NULL,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  );
  CREATE TABLE "office_projects" (
    "id" serial PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "client" text DEFAULT '' NOT NULL,
    "location" text DEFAULT '' NOT NULL,
    "description" text DEFAULT '' NOT NULL,
    "status" "project_status" DEFAULT 'active' NOT NULL,
    "start_date" date NOT NULL,
    "end_date" date NOT NULL,
    "created_by_id" integer,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  );
  CREATE TABLE "office_task_activity" (
    "id" serial PRIMARY KEY NOT NULL,
    "task_id" integer NOT NULL,
    "actor_id" integer,
    "actor_name" text NOT NULL,
    "event_type" text NOT NULL,
    "old_value" text,
    "new_value" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  );
  CREATE TABLE "office_task_comments" (
    "id" serial PRIMARY KEY NOT NULL,
    "task_id" integer NOT NULL,
    "author_id" integer,
    "author_name" text NOT NULL,
    "body" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  );
  CREATE TABLE "office_tasks" (
    "id" serial PRIMARY KEY NOT NULL,
    "project_id" integer NOT NULL,
    "title" text NOT NULL,
    "description" text DEFAULT '' NOT NULL,
    "category" "task_category" DEFAULT 'other' NOT NULL,
    "priority" "task_priority" DEFAULT 'medium' NOT NULL,
    "status" "task_status" DEFAULT 'todo' NOT NULL,
    "assignee_id" integer,
    "due_date" date NOT NULL,
    "created_by_id" integer,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
  );
  ALTER TABLE "office_attachments" ADD CONSTRAINT "office_attachments_project_id_office_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."office_projects"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "office_attachments" ADD CONSTRAINT "office_attachments_task_id_office_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."office_tasks"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "office_attachments" ADD CONSTRAINT "office_attachments_uploaded_by_id_office_members_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."office_members"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "office_notifications" ADD CONSTRAINT "office_notifications_member_id_office_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."office_members"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "office_notifications" ADD CONSTRAINT "office_notifications_task_id_office_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."office_tasks"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "office_projects" ADD CONSTRAINT "office_projects_created_by_id_office_members_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."office_members"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "office_task_activity" ADD CONSTRAINT "office_task_activity_task_id_office_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."office_tasks"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "office_task_activity" ADD CONSTRAINT "office_task_activity_actor_id_office_members_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."office_members"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "office_task_comments" ADD CONSTRAINT "office_task_comments_task_id_office_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."office_tasks"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "office_task_comments" ADD CONSTRAINT "office_task_comments_author_id_office_members_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."office_members"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "office_tasks" ADD CONSTRAINT "office_tasks_project_id_office_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."office_projects"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "office_tasks" ADD CONSTRAINT "office_tasks_assignee_id_office_members_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."office_members"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "office_tasks" ADD CONSTRAINT "office_tasks_created_by_id_office_members_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."office_members"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "office_attachments_project_idx" ON "office_attachments" USING btree ("project_id","created_at");
  CREATE INDEX "office_attachments_task_idx" ON "office_attachments" USING btree ("task_id","created_at");
  CREATE UNIQUE INDEX "office_attachments_object_path_idx" ON "office_attachments" USING btree ("object_path");
  CREATE UNIQUE INDEX "office_members_clerk_user_id_idx" ON "office_members" USING btree ("clerk_user_id");
  CREATE INDEX "office_notifications_member_created_idx" ON "office_notifications" USING btree ("member_id","created_at");
  CREATE INDEX "office_notifications_member_read_idx" ON "office_notifications" USING btree ("member_id","read_at");
  CREATE UNIQUE INDEX "office_notifications_member_dedupe_idx" ON "office_notifications" USING btree ("member_id","dedupe_key");
  CREATE INDEX "office_projects_status_idx" ON "office_projects" USING btree ("status");
  CREATE INDEX "office_task_activity_task_created_idx" ON "office_task_activity" USING btree ("task_id","created_at");
  CREATE INDEX "office_task_comments_task_created_idx" ON "office_task_comments" USING btree ("task_id","created_at");
  CREATE INDEX "office_tasks_project_id_idx" ON "office_tasks" USING btree ("project_id");
  CREATE INDEX "office_tasks_assignee_id_idx" ON "office_tasks" USING btree ("assignee_id");
  CREATE INDEX "office_tasks_status_idx" ON "office_tasks" USING btree ("status");
  CREATE INDEX "office_tasks_due_date_idx" ON "office_tasks" USING btree ("due_date");
END;
$office_init$;
