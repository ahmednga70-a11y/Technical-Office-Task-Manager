-- Existing task notifications keep their task association. Project files can
-- notify members even when a project has no tasks yet. No records are removed.
BEGIN;
ALTER TABLE office_notifications ALTER COLUMN task_id DROP NOT NULL;
ALTER TABLE office_notifications ADD COLUMN IF NOT EXISTS project_id integer
  REFERENCES office_projects(id) ON DELETE CASCADE;
COMMIT;
