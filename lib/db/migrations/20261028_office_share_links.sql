CREATE TABLE IF NOT EXISTS office_share_links (
  id serial PRIMARY KEY,
  title text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  scope text NOT NULL CONSTRAINT office_share_links_scope_check CHECK (scope IN ('all', 'selected')),
  project_ids integer[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT office_share_links_selection_check CHECK ((scope = 'all' AND cardinality(project_ids) = 0)
    OR (scope = 'selected' AND cardinality(project_ids) > 0))
);
