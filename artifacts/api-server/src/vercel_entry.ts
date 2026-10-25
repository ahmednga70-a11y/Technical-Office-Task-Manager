import { pool } from "@workspace/db";
import type { IncomingMessage, ServerResponse } from "node:http";
import app from "./app.js";

let initialized = false;

async function initDatabaseSchema() {
  await pool.query(`
    DO $$ BEGIN
      CREATE TYPE office_role AS ENUM ('manager', 'engineer');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    DO $$ BEGIN
      CREATE TYPE project_status AS ENUM ('active', 'on_hold', 'completed');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    DO $$ BEGIN
      CREATE TYPE task_category AS ENUM ('shop_drawing', 'submittal', 'rfi', 'quantity_takeoff', 'coordination', 'other');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    DO $$ BEGIN
      CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'urgent');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    DO $$ BEGIN
      CREATE TYPE task_status AS ENUM ('todo', 'in_progress', 'review', 'done');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    DO $$ BEGIN
      CREATE TYPE office_attachment_status AS ENUM ('pending', 'ready');
    EXCEPTION WHEN duplicate_object THEN null; END $$;

    CREATE TABLE IF NOT EXISTS office_members (
      id SERIAL PRIMARY KEY,
      clerk_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role office_role NOT NULL DEFAULT 'engineer',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS office_members_clerk_user_id_idx ON office_members(clerk_user_id);

    CREATE TABLE IF NOT EXISTS office_projects (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      client TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      status project_status NOT NULL DEFAULT 'active',
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      created_by_id INTEGER REFERENCES office_members(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS office_projects_status_idx ON office_projects(status);

    CREATE TABLE IF NOT EXISTS office_tasks (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES office_projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category task_category NOT NULL DEFAULT 'other',
      priority task_priority NOT NULL DEFAULT 'medium',
      status task_status NOT NULL DEFAULT 'todo',
      assignee_id INTEGER REFERENCES office_members(id) ON DELETE SET NULL,
      due_date DATE NOT NULL,
      created_by_id INTEGER REFERENCES office_members(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS office_tasks_project_id_idx ON office_tasks(project_id);
    CREATE INDEX IF NOT EXISTS office_tasks_assignee_id_idx ON office_tasks(assignee_id);
    CREATE INDEX IF NOT EXISTS office_tasks_status_idx ON office_tasks(status);
    CREATE INDEX IF NOT EXISTS office_tasks_due_date_idx ON office_tasks(due_date);

    CREATE TABLE IF NOT EXISTS office_task_comments (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES office_tasks(id) ON DELETE CASCADE,
      author_id INTEGER REFERENCES office_members(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS office_task_comments_task_created_idx ON office_task_comments(task_id, created_at);

    CREATE TABLE IF NOT EXISTS office_task_activity (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES office_tasks(id) ON DELETE CASCADE,
      actor_id INTEGER REFERENCES office_members(id) ON DELETE SET NULL,
      actor_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS office_task_activity_task_created_idx ON office_task_activity(task_id, created_at);

    CREATE TABLE IF NOT EXISTS office_notifications (
      id SERIAL PRIMARY KEY,
      member_id INTEGER NOT NULL REFERENCES office_members(id) ON DELETE CASCADE,
      task_id INTEGER NOT NULL REFERENCES office_tasks(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS office_notifications_member_created_idx ON office_notifications(member_id, created_at);
    CREATE INDEX IF NOT EXISTS office_notifications_member_read_idx ON office_notifications(member_id, read_at);
    CREATE UNIQUE INDEX IF NOT EXISTS office_notifications_member_dedupe_idx ON office_notifications(member_id, dedupe_key);

    CREATE TABLE IF NOT EXISTS office_attachments (
      id SERIAL PRIMARY KEY,
      project_id INTEGER REFERENCES office_projects(id) ON DELETE CASCADE,
      task_id INTEGER REFERENCES office_tasks(id) ON DELETE CASCADE,
      uploaded_by_id INTEGER REFERENCES office_members(id) ON DELETE SET NULL,
      uploaded_by_name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      object_path TEXT NOT NULL,
      status office_attachment_status NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT office_attachments_exactly_one_parent_check CHECK (
        (project_id IS NOT NULL AND task_id IS NULL) OR (project_id IS NULL AND task_id IS NOT NULL)
      )
    );
    CREATE INDEX IF NOT EXISTS office_attachments_project_idx ON office_attachments(project_id, created_at);
    CREATE INDEX IF NOT EXISTS office_attachments_task_idx ON office_attachments(task_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS office_attachments_object_path_idx ON office_attachments(object_path);
  `);
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!initialized) {
    await initDatabaseSchema();
    initialized = true;
  }
  app(req, res);
}