CREATE TABLE workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO workspaces (id,name) VALUES ('demo','CoSpace 演示');

ALTER TABLE users ADD COLUMN email text UNIQUE;
ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
CREATE TABLE workspace_members (
  workspace_id text NOT NULL REFERENCES workspaces(id),
  user_id text NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner','editor','viewer')),
  revoked_at timestamptz,
  PRIMARY KEY (workspace_id,user_id)
);
INSERT INTO workspace_members (workspace_id,user_id,role)
  SELECT 'demo',id,role FROM users WHERE id IN ('lin','chen','guest');
CREATE INDEX workspace_members_user_idx ON workspace_members (user_id, workspace_id)
  WHERE revoked_at IS NULL;

ALTER TABLE sessions ADD COLUMN workspace_id text NOT NULL DEFAULT 'demo' REFERENCES workspaces(id);
ALTER TABLE tickets ADD COLUMN workspace_id text NOT NULL DEFAULT 'demo' REFERENCES workspaces(id);
ALTER TABLE tickets ADD COLUMN document_id text;
ALTER TABLE tickets ADD COLUMN session_hash text;
ALTER TABLE documents ADD COLUMN workspace_id text NOT NULL DEFAULT 'demo' REFERENCES workspaces(id);
ALTER TABLE documents ADD COLUMN revision integer NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN workspace_id text NOT NULL DEFAULT 'demo' REFERENCES workspaces(id);
ALTER TABLE events ADD COLUMN workspace_id text NOT NULL DEFAULT 'demo' REFERENCES workspaces(id);
ALTER TABLE runs ADD COLUMN workspace_id text NOT NULL DEFAULT 'demo' REFERENCES workspaces(id);
ALTER TABLE mutations ADD COLUMN workspace_id text NOT NULL DEFAULT 'demo' REFERENCES workspaces(id);
ALTER TABLE mutations DROP CONSTRAINT mutations_pkey;
ALTER TABLE mutations ADD PRIMARY KEY (workspace_id,user_id,client_id);
CREATE INDEX documents_workspace_idx ON documents (workspace_id,id);
CREATE INDEX tasks_workspace_idx ON tasks (workspace_id,created_at DESC,id DESC);
CREATE INDEX runs_workspace_user_idx ON runs (workspace_id,user_id,created_at DESC);

CREATE TABLE email_links (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  email text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('invite','login')),
  role text CHECK (role IN ('owner','editor','viewer')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  revoked_at timestamptz,
  CHECK ((purpose='invite') = (role IS NOT NULL))
);
CREATE INDEX email_links_workspace_email_idx ON email_links (workspace_id,email);
