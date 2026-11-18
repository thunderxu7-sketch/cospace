import pg from "pg";
import { randomBytes, scryptSync } from "node:crypto";
export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://cospace:cospace_local_only@127.0.0.1:55437/cospace",
});
export const sql = async (query: string, args: unknown[] = []) =>
  (await pool.query(query, args)).rows;
export const members = [
  { id: "lin", name: "林知夏", color: "#327660", role: "editor" },
  { id: "chen", name: "陈屿", color: "#8773bf", role: "editor" },
  { id: "guest", name: "观察者", color: "#8a7865", role: "viewer" },
];
export async function initDb() {
  await pool.query(`
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
    DELETE FROM mobile_pairings WHERE expires_at<=now();
    DELETE FROM mobile_sessions WHERE expires_at<=now();
  `);
  for (const m of members) {
    const salt = randomBytes(16).toString("hex");
    const password =
      salt + ":" + scryptSync("cospace-demo-2026", salt, 32).toString("hex");
    await sql(
      "INSERT INTO users(id,name,color,role,password) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [m.id, m.name, m.color, m.role, password],
    );
  }
  await sql(
    "INSERT INTO documents(id,title) VALUES('launch','CoSpace 1.0 发布方案'),('notes','团队随手记') ON CONFLICT DO NOTHING",
  );
  await sql("INSERT INTO sheets(id) VALUES('budget') ON CONFLICT DO NOTHING");
  const seedMessages = [
    [
      "11111111-1111-4111-8111-111111111111",
      "lin",
      "欢迎来到 CoSpace 发布空间 👋\n这一轮我们把协作文档、任务和日历连起来，让团队讨论可以直接变成下一步行动。",
    ],
    [
      "11111111-1111-4111-8111-111111111112",
      "chen",
      "我来负责协同编辑和断线重连。周四之前交付双人同时编辑的可验证版本。",
    ],
    [
      "11111111-1111-4111-8111-111111111113",
      "lin",
      "我负责发布页面和体验走查，周五前完成。预算先按设计 16 小时、开发 32 小时、验证 12 小时估算。",
    ],
    [
      "11111111-1111-4111-8111-111111111114",
      "chen",
      "建议把性能验收也放进计划：长消息列表、万行任务表格，以及输入法和键盘操作。可以先用右上角 AI 整理讨论，再确认写入文档。",
    ],
  ];
  for (let i = 0; i < seedMessages.length; i++) {
    const [id, user, body] = seedMessages[i];
    await sql(
      "INSERT INTO messages(id,body,user_id,client_id,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [
        id,
        body,
        user,
        "seed-" + i,
        new Date(Date.UTC(2026, 10, 17, 1, 30 + i * 5)),
      ],
    );
  }
  const seedTasks = [
    [
      "22222222-2222-4222-8222-222222222221",
      "梳理发布方案与验收清单",
      "lin",
      "doing",
      "high",
      "2026-11-18T02:00:00Z",
      "2026-11-18T03:00:00Z",
    ],
    [
      "22222222-2222-4222-8222-222222222222",
      "完成文档协作与断线恢复",
      "chen",
      "doing",
      "high",
      "2026-11-19T02:00:00Z",
      "2026-11-19T04:00:00Z",
    ],
    [
      "22222222-2222-4222-8222-222222222223",
      "发布页面视觉与移动端适配",
      "lin",
      "todo",
      "medium",
      "2026-11-19T06:00:00Z",
      "2026-11-19T08:00:00Z",
    ],
    [
      "22222222-2222-4222-8222-222222222224",
      "任务表格性能与键盘走查",
      "chen",
      "todo",
      "medium",
      "2026-11-20T02:00:00Z",
      "2026-11-20T03:30:00Z",
    ],
    [
      "22222222-2222-4222-8222-222222222225",
      "准备产品演示与体验反馈",
      "lin",
      "todo",
      "low",
      null,
      null,
    ],
    [
      "22222222-2222-4222-8222-222222222226",
      "确定工作区信息结构",
      "lin",
      "done",
      "medium",
      null,
      null,
    ],
  ];
  for (const [id, title, assignee, status, priority, start, end] of seedTasks)
    await sql(
      "INSERT INTO tasks(id,title,assignee,status,priority,start_at,end_at,due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
      [
        id,
        title,
        assignee,
        status,
        priority,
        start,
        end,
        "2026-11-20T10:00:00Z",
      ],
    );
  // Interrupted runs must not remain stuck in a running/applying state after restart.
  await sql(
    "UPDATE runs SET status='failed',error='服务已重启，请重新生成建议。' WHERE status='running'",
  );
}
