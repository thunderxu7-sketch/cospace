CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY,name text NOT NULL,color text NOT NULL,role text NOT NULL,password text NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token text PRIMARY KEY,user_id text REFERENCES users(id),expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS mobile_pairings (code_hash text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS mobile_sessions (token_hash text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS tickets (token text PRIMARY KEY,user_id text REFERENCES users(id),expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id uuid PRIMARY KEY,body text NOT NULL,user_id text REFERENCES users(id),created_at timestamptz DEFAULT now(),reply_to uuid REFERENCES messages(id),client_id text NOT NULL,UNIQUE(user_id,client_id));
CREATE TABLE IF NOT EXISTS documents (id text PRIMARY KEY,title text NOT NULL,state bytea,updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS tasks (id uuid PRIMARY KEY,title text NOT NULL,assignee text REFERENCES users(id),status text NOT NULL DEFAULT 'todo',priority text NOT NULL DEFAULT 'medium',due_at timestamptz,start_at timestamptz,end_at timestamptz,version integer NOT NULL DEFAULT 1,source text,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS events (id bigserial PRIMARY KEY,kind text NOT NULL,payload jsonb NOT NULL,created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS runs (id uuid PRIMARY KEY,user_id text REFERENCES users(id),mode text,status text,output text DEFAULT '',proposal jsonb,error text,result jsonb,sources jsonb DEFAULT '[]',created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS sheets (id text PRIMARY KEY,snapshot jsonb,version integer DEFAULT 1);
CREATE TABLE IF NOT EXISTS mutations (user_id text,client_id text,result jsonb,PRIMARY KEY(user_id,client_id));
CREATE INDEX IF NOT EXISTS tasks_created_at_id_idx ON tasks (created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS tasks_assignee_created_at_id_idx ON tasks (assignee,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS runs_pending_action_items_idx ON runs (user_id,created_at DESC,id DESC)
  WHERE mode='tasks' AND proposal->>'type'='create_tasks' AND status='ready';
