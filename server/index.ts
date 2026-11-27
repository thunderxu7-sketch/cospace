import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import type { PoolClient } from "pg";
import { WebSocketServer, WebSocket } from "ws";
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { pool, sql, initDb } from "./db";
import { digest, taskPatch, validWindow, overlaps } from "./domain";
import {
  collab,
  readDoc,
  readSavedDoc,
  applyDocument,
  undoDocument,
  closeDocumentConnections,
  recheckDocumentConnections,
} from "./collab";
import {
  appOrigin,
  apiPort,
  collabPort,
  demoWorkspace,
  pilot,
  validateRuntime,
} from "./config";
import { registerEmailAuth } from "./email-auth";
import { requireMigrations } from "./migrate";
import { aiInfo, generate } from "./ai";
import { actionItemRun, registerMobileDataRoutes } from "./mobile-data";
import {
  fail,
  member,
  registerMobileSessionRoutes,
  registerRequestAuth,
  session,
  newSession,
  setSession,
  type WorkspaceSession,
} from "./session";
import type {
  ApplyRunResponse,
  CreateTasksResult,
  Member,
  Operation,
  Task,
} from "../packages/contracts/src/index";

validateRuntime();
const origin = appOrigin;
const mobileTaskPatch = taskPatch
  .pick({ status: true, version: true })
  .required();
const app = Fastify({
  logger: pilot
    ? { redact: ["req.headers.cookie", "req.headers.authorization"] }
    : false,
  trustProxy: pilot ? "loopback" : false,
  bodyLimit: 3 * 1024 * 1024,
});
await app.register(cookie);
await app.register(rateLimit, { max: 600, timeWindow: 60000 });
if (pilot) await requireMigrations(pool);
else await initDb();
await sql(
  "UPDATE runs SET status='failed',error='服务已重启，请重新生成建议。' WHERE status='running' AND ((workspace_id<>$1)=$2)",
  [demoWorkspace, pilot],
);
const sockets = new Map<WebSocket, WorkspaceSession>();
const wss = new WebSocketServer({ noServer: true, maxPayload: 32768 });
function broadcast(event: unknown, workspaceId = demoWorkspace) {
  const data = JSON.stringify(event);
  for (const [ws, identity] of sockets)
    if (
      identity.workspaceId === workspaceId &&
      ws.readyState === WebSocket.OPEN
    ) {
      if (ws.bufferedAmount > 1048576) ws.close(1013);
      else ws.send(data);
    }
}
function presence(workspaceId: string) {
  const users = [...sockets.values()].filter(
    (identity) => identity.workspaceId === workspaceId,
  );
  broadcast(
    {
      kind: "presence",
      users: [...new Set(users.map((identity) => identity.id))],
    },
    workspaceId,
  );
}
function closeMemberConnections(workspaceId: string, userId: string) {
  for (const [ws, identity] of sockets) {
    if (identity.workspaceId === workspaceId && identity.id === userId)
      ws.close(4001);
  }
  closeDocumentConnections(workspaceId, userId);
}
async function recordEvent(
  kind: string,
  payload: unknown,
  db: Pick<PoolClient, "query"> = pool,
  workspaceId = demoWorkspace,
) {
  const {
    rows: [row],
  } = await db.query<{ id: string; kind: string; payload: unknown }>(
    "INSERT INTO events(kind,payload,workspace_id) VALUES($1,$2,$3) RETURNING id,kind,payload",
    [kind, JSON.stringify(payload), workspaceId],
  );
  return { ...row, id: Number(row.id) };
}
async function event(kind: string, payload: unknown) {
  broadcast(await recordEvent(kind, payload));
}
function write(req: FastifyRequest): Member {
  const user = member(req);
  if (user.role === "viewer") fail("当前身份仅可查看", 403);
  return user;
}
registerRequestAuth(app, origin);
registerEmailAuth(app, closeMemberConnections);

async function validateAssignee(
  db: PoolClient,
  workspaceId: string,
  userId: string | null,
) {
  if (userId === null) return;
  const { rowCount } = await db.query(
    "SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND revoked_at IS NULL AND (NOT $3 OR role<>'viewer') FOR SHARE",
    [workspaceId, userId, pilot],
  );
  if (!rowCount) fail("负责人必须是此工作区的成员。");
}

async function canStillWrite(db: PoolClient, req: FastifyRequest) {
  if (!pilot) return;
  const { rowCount } = await db.query(
    "SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND role<>'viewer' AND revoked_at IS NULL FOR SHARE",
    [req.workspaceId, member(req).id],
  );
  if (!rowCount) fail("此工作区的写入权限已失效。", 403);
}
app.setErrorHandler((error: any, req, reply) => {
  if (error instanceof z.ZodError)
    return reply.code(400).send({
      error: "输入格式不正确",
      details: error.issues.map((x) => x.message),
    });
  const code = error.statusCode || 500;
  if (code >= 500)
    req.log.error(
      { errorCode: error.code, statusCode: code },
      "Request failed",
    );
  reply.code(code).send({
    error: code === 500 ? "服务处理失败，请重试" : error.message,
    ...(error.current ? { current: error.current } : {}),
  });
});
app.get("/api/health", { config: { publicAuth: true } }, async () => ({
  ok: true,
}));
app.get("/api/ready", { config: { publicAuth: true } }, async (_req, reply) => {
  try {
    await pool.query("SELECT 1");
    return { ok: true };
  } catch {
    return reply.code(503).send({ ok: false });
  }
});
if (!pilot) registerMobileSessionRoutes(app);
registerMobileDataRoutes(app);
app.post(
  "/api/login",
  { config: { publicAuth: true, rateLimit: { max: 30, timeWindow: 60000 } } },
  async (req, reply) => {
    if (pilot) fail("请通过邮箱登录", 404);
    const { id, password } = z
      .object({
        id: z.enum(["lin", "chen", "guest"]),
        password: z.string().max(100),
      })
      .parse(req.body);
    const [user] = await sql("SELECT * FROM users WHERE id=$1", [id]);
    const [salt, hash] = user.password.split(":");
    const actual = scryptSync(password, salt, 32);
    if (!timingSafeEqual(actual, Buffer.from(hash, "hex")))
      fail("身份或密码不正确", 401);
    setSession(reply, await newSession(pool, id, demoWorkspace));
    return { ok: true };
  },
);
app.post("/api/logout", async (req: any, reply) => {
  await sql("DELETE FROM sessions WHERE token=$1", [
    digest(req.cookies.cs_session),
  ]);
  closeMemberConnections(req.workspaceId, member(req).id);
  reply.clearCookie("cs_session", { path: "/" });
  return { ok: true };
});
app.get("/api/workspace", async (req) => {
  const workspaceId = req.workspaceId;
  const user = member(req);
  const [members, messages, tasks, documents, cursor, workspaces] =
    await Promise.all([
      sql(
        `SELECT u.id,u.name,u.color,m.role FROM workspace_members m JOIN users u ON u.id=m.user_id
         WHERE m.workspace_id=$1 AND m.revoked_at IS NULL ORDER BY u.id`,
        [workspaceId],
      ),
      pilot
        ? []
        : sql(
            "SELECT * FROM (SELECT * FROM messages ORDER BY created_at DESC LIMIT 100) m ORDER BY created_at",
          ),
      sql("SELECT * FROM tasks WHERE workspace_id=$1 ORDER BY created_at,id", [
        workspaceId,
      ]),
      sql("SELECT id,title FROM documents WHERE workspace_id=$1 ORDER BY id", [
        workspaceId,
      ]),
      sql(
        "SELECT COALESCE(max(id),0) AS id FROM events WHERE workspace_id=$1",
        [workspaceId],
      ),
      sql(
        `SELECT w.id,w.name FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id
         WHERE m.user_id=$1 AND m.revoked_at IS NULL AND ((w.id<>$2)=$3) ORDER BY w.name,w.id`,
        [user.id, demoWorkspace, pilot],
      ),
    ]);
  return {
    mode: pilot ? "pilot" : "demo",
    workspace: workspaces.find((workspace) => workspace.id === workspaceId),
    workspaces,
    user,
    members,
    messages,
    tasks,
    documents,
    cursor: Number(cursor[0].id),
    ai: aiInfo,
  };
});
app.get("/api/messages", async (req: any) => {
  if (pilot) fail("此功能暂未开放", 404);
  const before = z.string().datetime({ offset: true }).parse(req.query.before);
  return sql(
    "SELECT * FROM (SELECT * FROM messages WHERE created_at<$1 ORDER BY created_at DESC LIMIT 100) m ORDER BY created_at",
    [before],
  );
});
app.post("/api/messages", async (req: any) => {
  if (pilot) fail("此功能暂未开放", 404);
  write(req);
  const b = z
    .object({
      body: z.string().trim().min(1).max(5000),
      clientId: z.string().uuid(),
      replyTo: z.string().uuid().nullable().optional(),
    })
    .parse(req.body);
  let [m] = await sql(
    "INSERT INTO messages(id,body,user_id,client_id,reply_to) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,client_id) DO NOTHING RETURNING *",
    [randomUUID(), b.body, req.user.id, b.clientId, b.replyTo || null],
  );
  if (!m)
    [m] = await sql(
      "SELECT * FROM messages WHERE user_id=$1 AND client_id=$2",
      [req.user.id, b.clientId],
    );
  await event("message", m);
  return m;
});
app.post("/api/tasks", async (req) => {
  const user = write(req);
  const b = z
    .object({
      title: z.string().trim().min(1).max(180),
      assignee: z
        .union([z.uuid(), z.enum(["lin", "chen"])])
        .nullable()
        .optional(),
      clientId: z.string().uuid(),
    })
    .parse(req.body);
  const c = await pool.connect();
  let task: Task;
  let change: Awaited<ReturnType<typeof recordEvent>>;
  try {
    await c.query("BEGIN");
    await canStillWrite(c, req);
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      req.workspaceId + user.id + b.clientId,
    ]);
    const old = await c.query(
      "SELECT result FROM mutations WHERE user_id=$1 AND client_id=$2 AND workspace_id=$3",
      [user.id, b.clientId, req.workspaceId],
    );
    if (old.rows[0]) {
      await c.query("COMMIT");
      return old.rows[0].result;
    }
    const assignee =
      b.assignee === undefined ? (pilot ? user.id : "lin") : b.assignee;
    await validateAssignee(c, req.workspaceId, assignee);
    ({
      rows: [task],
    } = await c.query<Task>(
      "INSERT INTO tasks(id,title,assignee,workspace_id) VALUES($1,$2,$3,$4) RETURNING *",
      [randomUUID(), b.title, assignee, req.workspaceId],
    ));
    await c.query(
      "INSERT INTO mutations(user_id,client_id,result,workspace_id) VALUES($1,$2,$3,$4)",
      [user.id, b.clientId, JSON.stringify(task), req.workspaceId],
    );
    change = await recordEvent("tasks", {}, c, req.workspaceId);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  broadcast(change, req.workspaceId);
  return task;
});
app.patch(
  "/api/tasks/:id",
  { config: { mobileAuth: "allowed" } },
  async (req) => {
    write(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const patch = (req.mobileTokenHash ? mobileTaskPatch : taskPatch).parse(
      req.body,
    );
    const c = await pool.connect();
    let task: Task;
    let change: Awaited<ReturnType<typeof recordEvent>>;
    try {
      await c.query("BEGIN");
      await canStillWrite(c, req);
      const {
        rows: [current],
      } = await c.query(
        "SELECT * FROM tasks WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [id, req.workspaceId],
      );
      if (!current) fail("任务不存在", 404);
      if (current.version !== patch.version)
        throw Object.assign(new Error("任务已由其他人修改，已获取最新内容。"), {
          statusCode: 409,
          current,
        });
      const next = { ...current, ...patch };
      if ("assignee" in patch)
        await validateAssignee(c, req.workspaceId, next.assignee);
      if (!validWindow(next.start_at, next.end_at))
        fail("结束时间必须晚于开始时间");
      ({
        rows: [task],
      } = await c.query<Task>(
        "UPDATE tasks SET title=$2,assignee=$3,status=$4,priority=$5,due_at=$6,start_at=$7,end_at=$8,version=version+1 WHERE id=$1 RETURNING *",
        [
          id,
          next.title,
          next.assignee,
          next.status,
          next.priority,
          next.due_at,
          next.start_at,
          next.end_at,
        ],
      ));
      change = await recordEvent("tasks", {}, c, req.workspaceId);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    broadcast(change, req.workspaceId);
    return task;
  },
);
const docId = z.union([z.uuid(), z.enum(["launch", "notes"])]);
app.get("/api/documents/:id/context", async (req) => {
  const { id } = z.object({ id: docId }).parse(req.params);
  if (pilot) return readSavedDoc(req.workspaceId, id);
  return readDoc(id);
});
app.post("/api/documents", async (req, reply) => {
  if (!pilot) fail("此功能仅适用于试用工作区", 404);
  write(req);
  const { title } = z
    .strictObject({ title: z.string().trim().min(1).max(120) })
    .parse(req.body);
  const [document] = await sql(
    `INSERT INTO documents(id,title,workspace_id) SELECT $1,$2,$3
     WHERE EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id=$3 AND user_id=$4 AND role<>'viewer' AND revoked_at IS NULL)
     RETURNING id,title`,
    [randomUUID(), title, req.workspaceId, member(req).id],
  );
  if (!document) fail("此工作区的写入权限已失效。", 403);
  broadcast({ kind: "document" }, req.workspaceId);
  return reply.code(201).send(document);
});
app.patch("/api/documents/:id", async (req) => {
  if (!pilot) fail("此功能仅适用于试用工作区", 404);
  write(req);
  const { id } = z.object({ id: z.uuid() }).parse(req.params);
  const { title } = z
    .strictObject({ title: z.string().trim().min(1).max(120) })
    .parse(req.body);
  const [document] = await sql(
    `UPDATE documents SET title=$3 WHERE id=$1 AND workspace_id=$2
     AND EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id=$2 AND user_id=$4 AND role<>'viewer' AND revoked_at IS NULL)
     RETURNING id,title`,
    [id, req.workspaceId, title, member(req).id],
  );
  if (!document) fail("文档不存在", 404);
  broadcast({ kind: "document" }, req.workspaceId);
  return document;
});
app.post("/api/collab/token", async (req) => {
  const user = member(req);
  const token = randomBytes(24).toString("base64url");
  const documentId = pilot
    ? z.strictObject({ documentId: z.uuid() }).parse(req.body).documentId
    : null;
  if (documentId) {
    const [document] = await sql(
      "SELECT id FROM documents WHERE id=$1 AND workspace_id=$2",
      [documentId, req.workspaceId],
    );
    if (!document) fail("文档不存在", 404);
  }
  await sql(
    `INSERT INTO tickets(token,user_id,expires_at,workspace_id,document_id,session_hash)
     VALUES($1,$2,now()+interval '5 minutes',$3,$4,$5)`,
    [
      digest(token),
      user.id,
      req.workspaceId,
      documentId,
      req.cookies.cs_session ? digest(req.cookies.cs_session) : null,
    ],
  );
  await sql("DELETE FROM tickets WHERE expires_at<now()");
  return { token };
});
app.get("/api/budget", async () => {
  if (pilot) fail("此功能暂未开放", 404);
  return (
    await sql("SELECT snapshot,version FROM sheets WHERE id='budget'")
  )[0];
});
app.put("/api/budget", async (req: any) => {
  if (pilot) fail("此功能暂未开放", 404);
  write(req);
  const b = z
    .object({
      version: z.number().int().positive(),
      snapshot: z.record(z.string(), z.unknown()),
    })
    .parse(req.body);
  const [row] = await sql(
    "UPDATE sheets SET snapshot=$1,version=version+1 WHERE id='budget' AND version=$2 RETURNING version",
    [JSON.stringify(b.snapshot), b.version],
  );
  if (!row)
    fail("预算表已由其他人保存。请导出本地副本，再重新加载最新版本。", 409);
  await event("budget", {});
  return row;
});
app.get("/api/runs", async (req) =>
  sql(
    "SELECT * FROM runs WHERE user_id=$1 AND workspace_id=$2 ORDER BY created_at DESC LIMIT 20",
    [member(req).id, req.workspaceId],
  ),
);
app.post(
  "/api/ai/generate",
  { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } },
  async (req, reply) => {
    const user = write(req);
    const b = z
      .object({
        mode: z.enum(["summary", "tasks", "rewrite", "schedule"]),
        documentId: docId.default("launch"),
        documentRevision: z.number().int().nonnegative().optional(),
        prompt: z.string().max(2000).default(""),
        selectedText: z.string().max(8000).optional(),
        blockIndex: z.number().int().min(0).optional(),
        baseHash: z.string().optional(),
      })
      .parse(req.body);
    const saved = pilot
      ? await readSavedDoc(req.workspaceId, b.documentId)
      : undefined;
    if (pilot && (b.mode !== "tasks" || saved?.revision !== b.documentRevision))
      fail("请在文档保存后，从当前版本重新提取行动项。", 409);
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    });
    const abort = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) abort.abort();
    });
    try {
      await generate(
        user.id,
        req.workspaceId,
        b,
        abort.signal,
        (e) => {
          if (!reply.raw.destroyed) reply.raw.write(JSON.stringify(e) + "\n");
        },
        saved,
      );
    } catch (e) {
      if (!reply.raw.destroyed)
        reply.raw.write(
          JSON.stringify({
            type: "error",
            message: e instanceof Error ? e.message : "生成失败",
          }) + "\n",
        );
    } finally {
      reply.raw.end();
    }
  },
);
app.post(
  "/api/runs/:id/apply",
  { config: { mobileAuth: "allowed" } },
  applyRun,
);
async function approvedItems(
  db: PoolClient,
  req: FastifyRequest,
  op: Operation,
) {
  const revision = op.documentRevision;
  const {
    rows: [document],
  } = await db.query<{ revision: number }>(
    "SELECT revision FROM documents WHERE id=$1 AND workspace_id=$2 FOR SHARE",
    [op.documentId, req.workspaceId],
  );
  if (!document || document.revision !== revision)
    fail("来源文档已变更，请重新提取行动项。", 409);
  const { tasks } = z
    .strictObject({
      tasks: z
        .array(
          z.strictObject({
            index: z.number().int().nonnegative(),
            title: z.string().trim().min(1).max(180),
            assignee: z.uuid().nullable(),
            due_at: z.iso.datetime({ offset: true }).nullable(),
          }),
        )
        .min(1)
        .max(8),
    })
    .parse(req.body);
  const approved: NonNullable<Operation["tasks"]> = [];
  const selected = new Set<number>();
  for (const { index, ...task } of tasks) {
    const proposal = op.tasks?.[index];
    if (!proposal || selected.has(index)) fail("请检查所选行动项。");
    selected.add(index);
    await validateAssignee(db, req.workspaceId, task.assignee);
    approved.push({ ...task, evidence: proposal.evidence });
  }
  return approved;
}

async function applyRun(req: FastifyRequest): Promise<ApplyRunResponse> {
  const user = write(req);
  const { id } = z.object({ id: z.uuid() }).parse(req.params);
  const c = await pool.connect();
  let result: unknown;
  let changes: Awaited<ReturnType<typeof recordEvent>>[];
  try {
    await c.query("BEGIN");
    await canStillWrite(c, req);
    const {
      rows: [run],
    } = await c.query(
      `SELECT * FROM runs WHERE id=$1 AND user_id=$2 AND workspace_id=$4
       AND (NOT $3::boolean OR (${actionItemRun})) FOR UPDATE`,
      [id, user.id, pilot || !!req.mobileTokenHash, req.workspaceId],
    );
    if (!run) fail("操作不存在", 404);
    if (run.status === "applied") {
      await c.query("COMMIT");
      return { ok: true, result: run.result };
    }
    if (run.status !== "ready") fail("当前建议无法应用", 409);
    const op: Operation = run.proposal;
    if (op.type === "append_document" || op.type === "replace_paragraph") {
      result = await applyDocument(op, id);
    } else if (op.type === "create_tasks") {
      const approved = pilot ? await approvedItems(c, req, op) : op.tasks!;
      const taskIds: string[] = [];
      for (const t of approved) {
        const tid = randomUUID();
        await c.query(
          "INSERT INTO tasks(id,title,assignee,due_at,source,workspace_id) VALUES($1,$2,$3,$4,$5,$6)",
          [tid, t.title, t.assignee, t.due_at || null, id, req.workspaceId],
        );
        taskIds.push(tid);
      }
      result = {
        taskIds,
        ...(pilot ? { approved } : {}),
      } satisfies CreateTasksResult & { approved?: Operation["tasks"] };
    } else {
      const { rows: all } = await c.query(
        "SELECT * FROM tasks ORDER BY id FOR UPDATE",
      );
      const previous = all
        .filter((t) => op.schedules!.some((s) => s.id === t.id))
        .map((t) => ({
          id: t.id,
          start_at: t.start_at,
          end_at: t.end_at,
          version: t.version + 1,
        }));
      for (const s of op.schedules!) {
        const t = all.find((t) => t.id === s.id);
        if (!t || t.version !== s.version)
          fail("部分任务已被修改，请重新生成排期。", 409);
        if (!validWindow(s.start_at, s.end_at)) fail("排期时间无效");
        Object.assign(t, s);
      }
      for (let i = 0; i < all.length; i++)
        for (let j = i + 1; j < all.length; j++)
          if (
            overlaps(all[i], all[j]) &&
            op.schedules!.some((s) => s.id === all[i].id || s.id === all[j].id)
          )
            fail("建议中存在同一成员的时间冲突，请调整后重新生成。", 409);
      for (const s of op.schedules!)
        await c.query(
          "UPDATE tasks SET start_at=$2,end_at=$3,version=version+1 WHERE id=$1",
          [s.id, s.start_at, s.end_at],
        );
      result = { count: op.schedules!.length, previous };
    }
    await c.query("UPDATE runs SET status='applied',result=$2 WHERE id=$1", [
      id,
      JSON.stringify(result),
    ]);
    changes = [
      await recordEvent(
        "tasks",
        { runId: id, actorId: user.id },
        c,
        req.workspaceId,
      ),
    ];
    if (!pilot)
      changes.push(await recordEvent("document", {}, c, req.workspaceId));
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  for (const change of changes) broadcast(change, req.workspaceId);
  return { ok: true, result };
}
app.post(
  "/api/runs/:id/reject",
  { config: { mobileAuth: "allowed" } },
  async (req) => {
    const user = write(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const [run] = await sql(
      `UPDATE runs SET status='rejected' WHERE id=$1 AND user_id=$2
       AND (NOT $3::boolean OR (${actionItemRun})) AND workspace_id=$4
       AND status IN ('ready','rejected') RETURNING id`,
      [id, user.id, pilot || !!req.mobileTokenHash, req.workspaceId],
    );
    if (run) return { ok: true };
    if (pilot || req.mobileTokenHash) {
      const [owned] = await sql(
        `SELECT id FROM runs WHERE id=$1 AND user_id=$2 AND (${actionItemRun}) AND workspace_id=$3`,
        [id, user.id, req.workspaceId],
      );
      if (!owned) fail("操作不存在", 404);
    }
    fail("当前建议无法放弃", 409);
  },
);
app.post("/api/runs/:id/undo", async (req: any) => {
  write(req);
  const id = z.string().uuid().parse(req.params.id);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const {
      rows: [run],
    } = await c.query(
      "SELECT * FROM runs WHERE id=$1 AND user_id=$2 AND workspace_id=$3 FOR UPDATE",
      [id, req.user.id, req.workspaceId],
    );
    if (!run) fail("操作不存在", 404);
    await canStillWrite(c, req);
    if (pilot && run.proposal?.type !== "create_tasks") fail("操作不存在", 404);
    if (run.status === "undone") {
      await c.query("COMMIT");
      return { ok: true };
    }
    if (run.status !== "applied") fail("当前操作无法撤销", 409);
    if (
      run.proposal.type === "append_document" ||
      run.proposal.type === "replace_paragraph"
    )
      await undoDocument(run.proposal.documentId, id);
    else if (run.proposal.type === "create_tasks") {
      const { rows: tasks } = await c.query(
        "SELECT * FROM tasks WHERE id=ANY($1::uuid[]) AND workspace_id=$2 ORDER BY id FOR UPDATE",
        [run.result.taskIds, req.workspaceId],
      );
      if (
        tasks.length !== run.result.taskIds.length ||
        tasks.some((t) => t.version !== 1)
      )
        fail("任务有后续修改，无法整体撤销，请手动调整。", 409);
      await c.query(
        "DELETE FROM tasks WHERE id=ANY($1::uuid[]) AND workspace_id=$2",
        [run.result.taskIds, req.workspaceId],
      );
    } else {
      const previous = run.result.previous;
      const { rows: tasks } = await c.query(
        "SELECT * FROM tasks WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [previous.map((t: any) => t.id)],
      );
      if (
        tasks.length !== previous.length ||
        previous.some(
          (p: any) => tasks.find((t) => t.id === p.id)?.version !== p.version,
        )
      )
        fail("排期有后续修改，请手动调整。", 409);
      for (const p of previous)
        await c.query(
          "UPDATE tasks SET start_at=$2,end_at=$3,version=version+1 WHERE id=$1",
          [p.id, p.start_at, p.end_at],
        );
    }
    await c.query("UPDATE runs SET status='undone' WHERE id=$1", [id]);
    const change = await recordEvent(
      "tasks",
      { runId: id },
      c,
      req.workspaceId,
    );
    await c.query("COMMIT");
    broadcast(change, req.workspaceId);
    if (!pilot) await event("document", {});
    return { ok: true };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
});
app.server.on("upgrade", async (req, socket, head) => {
  try {
    if (
      req.url !== (pilot ? "/ws/events" : "/events") ||
      req.headers.origin !== origin
    ) {
      socket.destroy();
      return;
    }
    const token = app.parseCookie(req.headers.cookie || "").cs_session;
    const user = await session(token);
    if (!user) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.set(ws, user);
      ws.send(JSON.stringify({ kind: "refresh" }));
      presence(user.workspaceId);
      const timer = setInterval(async () => {
        try {
          const current = await session(token);
          if (!current || current.workspaceId !== user.workspaceId) {
            ws.close(4001);
            return;
          }
          if (ws.readyState === WebSocket.OPEN) ws.ping();
        } catch {
          ws.close(1011, "Session check unavailable");
        }
      }, 30000);
      ws.on("close", () => {
        clearInterval(timer);
        sockets.delete(ws);
        presence(user.workspaceId);
      });
      ws.on("error", () => ws.close());
    });
  } catch {
    socket.destroy();
  }
});
await app.listen({ host: "127.0.0.1", port: apiPort });
await collab.listen();
console.log(
  `CoSpace API http://127.0.0.1:${apiPort} | collaboration ws://127.0.0.1:${collabPort}`,
);
const collabSessionCheck = pilot
  ? setInterval(() => void recheckDocumentConnections(), 15_000)
  : undefined;
collabSessionCheck?.unref();
async function close() {
  clearInterval(collabSessionCheck);
  for (const ws of sockets.keys()) ws.close();
  await collab.destroy();
  await app.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
