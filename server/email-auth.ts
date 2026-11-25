import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { appOrigin, demoWorkspace, pilot } from "./config";
import { pool, sql } from "./db";
import { digest } from "./domain";
import { fail, member, newSession, setSession } from "./session";

type Role = "owner" | "editor" | "viewer";
type Purpose = "invite" | "login";
type EmailLink = {
  id: string;
  workspace_id: string;
  email: string;
  purpose: Purpose;
  role: Role | null;
};

const emailAddress = z
  .string()
  .trim()
  .max(254)
  .email()
  .transform((email) => email.toLowerCase());
const nameField = z.string().trim().min(1).max(80);
const linkToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const anonymous = {
  config: { publicAuth: true, rateLimit: { max: 10, timeWindow: "1 minute" } },
};

export function emailConfig() {
  const apiKey = process.env.COSPACE_EMAIL_API_KEY;
  const from = process.env.COSPACE_EMAIL_FROM;
  const endpoint = new URL(
    process.env.COSPACE_EMAIL_API_URL || "https://api.resend.com/emails",
  );
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname);
  if (
    !apiKey ||
    !from ||
    (endpoint.protocol !== "https:" &&
      !(local && endpoint.protocol === "http:"))
  )
    throw new Error(
      "Pilot mode requires COSPACE_EMAIL_API_KEY, COSPACE_EMAIL_FROM and an HTTPS email endpoint.",
    );
  return { apiKey, from, endpoint };
}

async function transaction<T>(use: (db: PoolClient) => Promise<T>) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await use(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

async function lockWorkspace(db: PoolClient, id: string) {
  await db.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [id]);
}

async function issueLink(
  db: PoolClient,
  workspaceId: string,
  email: string,
  purpose: Purpose,
  role: Role | null,
) {
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  await db.query(
    `INSERT INTO email_links (id,token_hash,workspace_id,email,purpose,role,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,now()+$7::interval)`,
    [
      id,
      digest(token),
      workspaceId,
      email,
      purpose,
      role,
      purpose === "invite" ? "2 days" : "15 minutes",
    ],
  );
  return { id, token, email, purpose };
}

async function sendLink(link: Awaited<ReturnType<typeof issueLink>>) {
  const { apiKey, from, endpoint } = emailConfig();
  const invitation = link.purpose === "invite";
  const url = new URL("/", appOrigin);
  url.hash = new URLSearchParams({ [link.purpose]: link.token }).toString();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        "Idempotency-Key": link.id,
      },
      body: JSON.stringify({
        from,
        to: [link.email],
        subject: invitation ? "加入 CoSpace 工作区" : "登录 CoSpace",
        text: invitation
          ? `你收到了一份 CoSpace 工作区邀请，有效期为 48 小时。打开链接后确认加入。\n\n${url.href}`
          : `打开链接并确认登录 CoSpace。此链接 15 分钟内有效，只能使用一次。\n\n${url.href}`,
      }),
    });
    if (!response.ok)
      throw new Error("Email provider did not accept the message");
  } catch {
    await sql(
      "UPDATE email_links SET revoked_at=now() WHERE id=$1 AND used_at IS NULL",
      [link.id],
    );
    fail("邮件服务暂时无法发送，请稍后重试。", 503);
  }
}

export async function bootstrapWorkspace(rawName: string, rawEmail: string) {
  if (!pilot)
    throw new Error("Workspace bootstrap is only available in pilot mode.");
  emailConfig();
  const name = nameField.parse(rawName);
  const email = emailAddress.parse(rawEmail);
  const { workspaceId, link } = await transaction(async (db) => {
    // A repeated bootstrap can reissue an unclaimed owner invitation.
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "bootstrap:" + name,
    ]);
    const {
      rows: [pending],
    } = await db.query<{ id: string }>(
      `SELECT w.id FROM workspaces w JOIN email_links l ON l.workspace_id=w.id
       WHERE w.name=$1 AND l.email=$2 AND l.role='owner'
       ORDER BY w.created_at DESC LIMIT 1`,
      [name, email],
    );
    const workspaceId = pending?.id ?? randomUUID();
    if (!pending)
      await db.query("INSERT INTO workspaces(id,name) VALUES($1,$2)", [
        workspaceId,
        name,
      ]);
    await lockWorkspace(db, workspaceId);
    if (pending) {
      const { rowCount } = await db.query(
        "SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND role='owner'",
        [workspaceId],
      );
      if (rowCount) fail("该工作区已由管理员领取。", 409);
    }
    await db.query(
      "UPDATE email_links SET revoked_at=now() WHERE workspace_id=$1 AND role='owner' AND used_at IS NULL AND revoked_at IS NULL",
      [workspaceId],
    );
    return {
      workspaceId,
      link: await issueLink(db, workspaceId, email, "invite", "owner"),
    };
  });
  await sendLink(link);
  return workspaceId;
}

export function registerEmailAuth(
  app: FastifyInstance,
  closeMemberConnections: (workspaceId: string, userId: string) => void,
) {
  app.get("/api/auth/config", { config: { publicAuth: true } }, async () => ({
    mode: pilot ? "pilot" : "demo",
  }));
  if (!pilot) return;

  app.post("/api/auth/login-link", anonymous, async (req) => {
    const { email } = z.strictObject({ email: emailAddress }).parse(req.body);
    const [workspace] = await sql(
      `SELECT m.workspace_id FROM workspace_members m JOIN users u ON u.id=m.user_id
       WHERE u.email=$1 AND m.revoked_at IS NULL AND m.workspace_id<>$2 ORDER BY m.workspace_id LIMIT 1`,
      [email, demoWorkspace],
    );
    if (workspace) {
      try {
        const link = await transaction((db) =>
          issueLink(db, workspace.workspace_id, email, "login", null),
        );
        await sendLink(link);
      } catch (error) {
        // The public response is the same for registered and unregistered addresses.
        req.log.warn(
          { code: error instanceof Error ? error.name : "MailFailure" },
          "Pilot login email failed",
        );
      }
    }
    return { ok: true };
  });

  app.post("/api/auth/redeem", anonymous, async (req, reply) => {
    const input = z
      .strictObject({
        token: linkToken,
        purpose: z.enum(["invite", "login"]),
        name: nameField.optional(),
      })
      .parse(req.body);
    const token = await transaction(async (db) => {
      const hash = digest(input.token);
      const unusable = () => fail("此链接无效、已使用或已过期。", 401);
      const {
        rows: [target],
      } = await db.query<{ workspace_id: string }>(
        "SELECT workspace_id FROM email_links WHERE token_hash=$1 AND purpose=$2",
        [hash, input.purpose],
      );
      if (!target) return unusable();
      await lockWorkspace(db, target.workspace_id);
      const {
        rows: [link],
      } = await db.query<EmailLink>(
        `UPDATE email_links SET used_at=now()
         WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now()
         RETURNING id,workspace_id,email,purpose,role`,
        [hash, input.purpose],
      );
      if (!link) return unusable();

      let {
        rows: [user],
      } = await db.query<{ id: string }>(
        "SELECT id FROM users WHERE email=$1",
        [link.email],
      );
      if (link.purpose === "invite") {
        if (!user && !input.name) fail("请填写显示名称");
        if (!user) {
          ({
            rows: [user],
          } = await db.query<{ id: string }>(
            `INSERT INTO users(id,email,name,color,role) VALUES($1,$2,$3,'#327660','viewer')
             ON CONFLICT(email) DO UPDATE SET email=EXCLUDED.email RETURNING id`,
            [randomUUID(), link.email, input.name],
          ));
        }
        await db.query(
          `INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)
           ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role,revoked_at=NULL
           WHERE workspace_members.revoked_at IS NOT NULL`,
          [link.workspace_id, user.id, link.role],
        );
      }
      if (!user) return unusable();
      const { rowCount } = await db.query(
        "SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND revoked_at IS NULL",
        [link.workspace_id, user.id],
      );
      if (!rowCount) return unusable();
      if (req.cookies.cs_session)
        await db.query("DELETE FROM sessions WHERE token=$1", [
          digest(req.cookies.cs_session),
        ]);
      return newSession(db, user.id, link.workspace_id);
    });
    setSession(reply, token);
    return { ok: true };
  });

  app.post("/api/workspaces/:id/switch", async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const user = member(req);
    const token = await transaction(async (db) => {
      const { rowCount } = await db.query(
        "SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND revoked_at IS NULL FOR SHARE",
        [id, user.id],
      );
      if (!rowCount) fail("工作区不存在", 404);
      await db.query("DELETE FROM sessions WHERE token=$1", [
        digest(req.cookies.cs_session!),
      ]);
      return newSession(db, user.id, id);
    });
    setSession(reply, token);
    return { ok: true };
  });

  app.post(
    "/api/invitations",
    { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { email, role } = z
        .strictObject({
          email: emailAddress,
          role: z.enum(["editor", "viewer"]).default("editor"),
        })
        .parse(req.body);
      const link = await transaction(async (db) => {
        await lockWorkspace(db, req.workspaceId);
        const { rowCount } = await db.query(
          "SELECT 1 FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND role='owner' AND revoked_at IS NULL",
          [req.workspaceId, member(req).id],
        );
        if (!rowCount) fail("只有工作区管理员可以邀请成员", 403);
        const { rowCount: existing } = await db.query(
          `SELECT 1 FROM workspace_members m JOIN users u ON u.id=m.user_id
         WHERE m.workspace_id=$1 AND u.email=$2 AND m.revoked_at IS NULL`,
          [req.workspaceId, email],
        );
        if (existing) fail("此邮箱已加入工作区", 409);
        return issueLink(db, req.workspaceId, email, "invite", role);
      });
      await sendLink(link);
      return reply.code(201).send({ id: link.id });
    },
  );

  app.get("/api/invitations", async (req) => {
    if (member(req).role !== "owner") fail("只有工作区管理员可以管理邀请", 403);
    return sql(
      `SELECT id,email,role,expires_at FROM email_links WHERE workspace_id=$1 AND purpose='invite'
       AND role<>'owner' AND expires_at>now() AND used_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC`,
      [req.workspaceId],
    );
  });

  app.delete("/api/invitations/:id", async (req) => {
    if (member(req).role !== "owner") fail("只有工作区管理员可以管理邀请", 403);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { rowCount } = await pool.query(
      `UPDATE email_links SET revoked_at=now() WHERE id=$1 AND workspace_id=$2 AND purpose='invite'
       AND role<>'owner' AND used_at IS NULL AND revoked_at IS NULL`,
      [id, req.workspaceId],
    );
    if (!rowCount) fail("邀请不存在或已失效", 404);
    return { ok: true };
  });

  app.delete("/api/members/:id", async (req) => {
    if (member(req).role !== "owner") fail("只有工作区管理员可以移除成员", 403);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    await transaction(async (db) => {
      await lockWorkspace(db, req.workspaceId);
      const { rowCount } = await db.query(
        `UPDATE workspace_members SET revoked_at=now() WHERE workspace_id=$1 AND user_id=$2
         AND role<>'owner' AND revoked_at IS NULL`,
        [req.workspaceId, id],
      );
      if (!rowCount) fail("可移除的成员不存在", 404);
      await db.query(
        "DELETE FROM sessions WHERE workspace_id=$1 AND user_id=$2",
        [req.workspaceId, id],
      );
      await db.query(
        "DELETE FROM tickets WHERE workspace_id=$1 AND user_id=$2",
        [req.workspaceId, id],
      );
      await db.query(
        `UPDATE email_links SET revoked_at=now() WHERE workspace_id=$1 AND used_at IS NULL
         AND email=(SELECT email FROM users WHERE id=$2)`,
        [req.workspaceId, id],
      );
    });
    closeMemberConnections(req.workspaceId, id);
    return { ok: true };
  });
}
