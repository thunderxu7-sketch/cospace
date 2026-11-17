import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
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
import { collab, readDoc, applyDocument, undoDocument } from "./collab";
import { generate } from "./ai";
import type { Member, Operation } from "../src/lib/types";

const origin = process.env.APP_ORIGIN || "http://127.0.0.1:3027";
const app = Fastify({ logger: false, bodyLimit: 3 * 1024 * 1024 });
await app.register(cookie);
await app.register(rateLimit, { max: 600, timeWindow: 60000 });
await initDb();
const sockets = new Map<WebSocket, Member>();
const wss = new WebSocketServer({ noServer: true, maxPayload: 32768 });
function broadcast(event: unknown) {
  const data = JSON.stringify(event);
  for (const ws of sockets.keys())
    if (ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > 1048576) ws.close(1013);
      else ws.send(data);
    }
}
function presence() {
  broadcast({
    kind: "presence",
    users: [...new Set([...sockets.values()].map((u) => u.id))],
  });
}
async function session(token?: string): Promise<Member | undefined> {
  if (!token) return;
  return (
    await sql(
      "SELECT u.id,u.name,u.role,u.color FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires_at>now()",
      [digest(token)],
    )
  )[0];
}
function fail(message: string, statusCode = 400): never {
  throw Object.assign(new Error(message), { statusCode });
}
async function event(kind: string, payload: unknown) {
  const [e] = await sql(
    "INSERT INTO events(kind,payload) VALUES($1,$2) RETURNING id,kind,payload",
    [kind, JSON.stringify(payload)],
  );
  broadcast({ ...e, id: Number(e.id) });
}
const write = (req: any) => {
  if (req.user.role === "viewer") fail("当前身份仅可查看", 403);
};
app.decorateRequest("user", null);
app.addHook("preHandler", async (req: any) => {
  if (req.method !== "GET" && req.headers.origin !== origin)
    fail("来源校验失败", 403);
  if (req.url === "/api/login" || req.url === "/api/health") return;
  req.user = await session(req.cookies.cs_session);
  if (!req.user) fail("请先登录", 401);
});
app.setErrorHandler((error: any, req, reply) => {
  if (error instanceof z.ZodError)
    return reply.code(400).send({
      error: "输入格式不正确",
      details: error.issues.map((x) => x.message),
    });
  const code = error.statusCode || 500;
  if (code === 500)
    console.error("Request error", req.method, req.url, error.message);
  reply.code(code).send({
    error: code === 500 ? "服务处理失败，请重试" : error.message,
    ...(error.current ? { current: error.current } : {}),
  });
});
app.get("/api/health", async () => ({ ok: true }));
app.post(
  "/api/login",
  { config: { rateLimit: { max: 30, timeWindow: 60000 } } },
  async (req, reply) => {
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
    const token = randomBytes(32).toString("base64url");
    await sql(
      "INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,now()+interval '24 hours')",
      [digest(token), id],
    );
    reply.setCookie("cs_session", token, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 86400,
    });
    return { ok: true };
  },
);
app.post("/api/logout", async (req: any, reply) => {
  await sql("DELETE FROM sessions WHERE token=$1", [
    digest(req.cookies.cs_session),
  ]);
  reply.clearCookie("cs_session", { path: "/" });
  return { ok: true };
});
app.get("/api/workspace", async (req: any) => {
  const [members, messages, tasks, documents, cursor] = await Promise.all([
    sql("SELECT id,name,color,role FROM users ORDER BY id"),
    sql(
      "SELECT * FROM (SELECT * FROM messages ORDER BY created_at DESC LIMIT 100) m ORDER BY created_at",
    ),
    sql("SELECT * FROM tasks ORDER BY created_at"),
    sql("SELECT id,title FROM documents ORDER BY id"),
    sql("SELECT COALESCE(max(id),0) AS id FROM events"),
  ]);
  return {
    user: req.user,
    members,
    messages,
    tasks,
    documents,
    cursor: Number(cursor[0].id),
    ai: { provider: "Ollama", model: process.env.OLLAMA_MODEL || "qwen3:14b" },
  };
});
app.get("/api/messages", async (req: any) => {
  const before = z.string().datetime({ offset: true }).parse(req.query.before);
  return sql(
    "SELECT * FROM (SELECT * FROM messages WHERE created_at<$1 ORDER BY created_at DESC LIMIT 100) m ORDER BY created_at",
    [before],
  );
});
app.post("/api/messages", async (req: any) => {
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
app.post("/api/tasks", async (req: any) => {
  write(req);
  const b = z
    .object({
      title: z.string().trim().min(1).max(180),
      assignee: z.enum(["lin", "chen"]).default("lin"),
      clientId: z.string().uuid(),
    })
    .parse(req.body);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      req.user.id + b.clientId,
    ]);
    const old = await c.query(
      "SELECT result FROM mutations WHERE user_id=$1 AND client_id=$2",
      [req.user.id, b.clientId],
    );
    if (old.rows[0]) {
      await c.query("COMMIT");
      return old.rows[0].result;
    }
    const {
      rows: [task],
    } = await c.query(
      "INSERT INTO tasks(id,title,assignee) VALUES($1,$2,$3) RETURNING *",
      [randomUUID(), b.title, b.assignee],
    );
    await c.query("INSERT INTO mutations VALUES($1,$2,$3)", [
      req.user.id,
      b.clientId,
      JSON.stringify(task),
    ]);
    await c.query("COMMIT");
    await event("tasks", {});
    return task;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
});
app.patch("/api/tasks/:id", async (req: any) => {
  write(req);
  const id = z.string().uuid().parse(req.params.id);
  const patch = taskPatch.parse(req.body);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const {
      rows: [current],
    } = await c.query("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [id]);
    if (!current) fail("任务不存在", 404);
    if (current.version !== patch.version)
      throw Object.assign(new Error("任务已由其他人修改，已获取最新内容。"), {
        statusCode: 409,
        current,
      });
    const next = { ...current, ...patch };
    if (!validWindow(next.start_at, next.end_at))
      fail("结束时间必须晚于开始时间");
    const {
      rows: [task],
    } = await c.query(
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
    );
    await c.query("COMMIT");
    await event("tasks", {});
    return task;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
});
app.get("/api/documents/:id/context", async (req: any) =>
  readDoc(z.enum(["launch", "notes"]).parse(req.params.id)),
);
app.post("/api/collab/token", async (req: any) => {
  const token = randomBytes(24).toString("base64url");
  await sql("INSERT INTO tickets VALUES($1,$2,now()+interval '5 minutes')", [
    digest(token),
    req.user.id,
  ]);
  await sql("DELETE FROM tickets WHERE expires_at<now()");
  return { token };
});
app.get(
  "/api/budget",
  async () =>
    (await sql("SELECT snapshot,version FROM sheets WHERE id='budget'"))[0],
);
app.put("/api/budget", async (req: any) => {
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
app.get("/api/runs", async (req: any) =>
  sql("SELECT * FROM runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20", [
    req.user.id,
  ]),
);
app.post("/api/ai/generate", async (req: any, reply) => {
  write(req);
  const b = z
    .object({
      mode: z.enum(["summary", "tasks", "rewrite", "schedule"]),
      documentId: z.enum(["launch", "notes"]).default("launch"),
      prompt: z.string().max(2000).default(""),
      selectedText: z.string().max(8000).optional(),
      blockIndex: z.number().int().min(0).optional(),
      baseHash: z.string().optional(),
    })
    .parse(req.body);
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  });
  const abort = new AbortController();
  reply.raw.on("close", () => {
    if (!reply.raw.writableEnded) abort.abort();
  });
  try {
    await generate(req.user.id, b, abort.signal, (e) => {
      if (!reply.raw.destroyed) reply.raw.write(JSON.stringify(e) + "\n");
    });
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
});
app.post("/api/runs/:id/apply", async (req: any) => {
  write(req);
  const id = z.string().uuid().parse(req.params.id);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const {
      rows: [run],
    } = await c.query(
      "SELECT * FROM runs WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [id, req.user.id],
    );
    if (!run) fail("操作不存在", 404);
    if (run.status === "applied") {
      await c.query("COMMIT");
      return { ok: true, result: run.result };
    }
    if (run.status !== "ready") fail("当前建议无法应用", 409);
    const op: Operation = run.proposal;
    let result: unknown;
    if (op.type === "append_document" || op.type === "replace_paragraph") {
      result = await applyDocument(op, id);
    } else if (op.type === "create_tasks") {
      const ids = [];
      for (const t of op.tasks!) {
        const tid = randomUUID();
        await c.query(
          "INSERT INTO tasks(id,title,assignee,due_at,source) VALUES($1,$2,$3,$4,$5)",
          [tid, t.title, t.assignee, t.due_at || null, id],
        );
        ids.push(tid);
      }
      result = { taskIds: ids };
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
    await c.query("COMMIT");
    await event("tasks", {});
    await event("document", {});
    return { ok: true, result };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
});
app.post("/api/runs/:id/reject", async (req: any) => {
  write(req);
  const id = z.string().uuid().parse(req.params.id);
  const [run] = await sql(
    "UPDATE runs SET status='rejected' WHERE id=$1 AND user_id=$2 AND status IN ('ready','rejected') RETURNING id",
    [id, req.user.id],
  );
  if (!run) fail("当前建议无法放弃", 409);
  return { ok: true };
});
app.post("/api/runs/:id/undo", async (req: any) => {
  write(req);
  const id = z.string().uuid().parse(req.params.id);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const {
      rows: [run],
    } = await c.query(
      "SELECT * FROM runs WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [id, req.user.id],
    );
    if (!run) fail("操作不存在", 404);
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
        "SELECT * FROM tasks WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
        [run.result.taskIds],
      );
      if (
        tasks.length !== run.result.taskIds.length ||
        tasks.some((t) => t.version !== 1)
      )
        fail("任务有后续修改，无法整体撤销，请手动调整。", 409);
      await c.query("DELETE FROM tasks WHERE id=ANY($1::uuid[])", [
        run.result.taskIds,
      ]);
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
    await c.query("COMMIT");
    await event("tasks", {});
    await event("document", {});
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
    if (req.url !== "/events" || req.headers.origin !== origin) {
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
      presence();
      const timer = setInterval(async () => {
        try {
          if (!(await session(token))) {
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
        presence();
      });
      ws.on("error", () => ws.close());
    });
  } catch {
    socket.destroy();
  }
});
await app.listen({ host: "127.0.0.1", port: 4027 });
await collab.listen();
console.log(
  "CoSpace API http://127.0.0.1:4027 | collaboration ws://127.0.0.1:4028",
);
async function close() {
  for (const ws of sockets.keys()) ws.close();
  await collab.destroy();
  await app.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
