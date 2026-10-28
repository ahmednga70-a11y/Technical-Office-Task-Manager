-- Preserve existing project dates; projects without a schedule are valid.
BEGIN;
ALTER TABLE office_projects ALTER COLUMN start_date DROP NOT NULL;
ALTER TABLE office_projects ALTER COLUMN end_date DROP NOT NULL;
COMMIT;
