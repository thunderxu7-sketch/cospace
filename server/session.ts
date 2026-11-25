import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "./db";
import { digest } from "./domain";
import { appOrigin, demoWorkspace, pilot } from "./config";
import type {
  Member,
  MobileIdentity,
  MobilePairing,
  MobileSession,
} from "../packages/contracts/src/index";

declare module "fastify" {
  interface FastifyRequest {
    user: Member | null;
    mobileTokenHash: string | null;
    workspaceId: string;
  }

  interface FastifyContextConfig {
    mobileAuth?: "allowed" | "required" | "exchange";
    publicAuth?: boolean;
  }
}

const pairingAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const pairingRateLimit = { max: 30, timeWindow: 60_000 };

export function fail(message: string, statusCode = 400): never {
  throw Object.assign(new Error(message), { statusCode });
}

export function member(req: FastifyRequest): Member {
  return req.user ?? fail("请先登录", 401);
}

export type WorkspaceSession = Member & { workspaceId: string };

export async function session(
  token?: string,
): Promise<WorkspaceSession | undefined> {
  if (!token) return;
  const { rows } = await pool.query<WorkspaceSession>(
    `SELECT u.id,u.name,m.role,u.color,s.workspace_id AS "workspaceId"
     FROM sessions s JOIN users u ON u.id=s.user_id
     JOIN workspace_members m ON m.user_id=s.user_id AND m.workspace_id=s.workspace_id
     WHERE s.token=$1 AND s.expires_at>now() AND m.revoked_at IS NULL
       AND ((s.workspace_id <> $2) = $3)`,
    [digest(token), demoWorkspace, pilot],
  );
  return rows[0];
}

export async function newSession(
  db: Pick<PoolClient, "query">,
  userId: string,
  workspaceId: string,
) {
  const token = randomBytes(32).toString("base64url");
  await db.query(
    "INSERT INTO sessions(token,user_id,workspace_id,expires_at) VALUES($1,$2,$3,now()+interval '24 hours')",
    [digest(token), userId, workspaceId],
  );
  return token;
}

export function setSession(reply: FastifyReply, token: string) {
  reply.setCookie("cs_session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: appOrigin.startsWith("https:"),
    path: "/",
    maxAge: 86400,
  });
}

export function registerRequestAuth(app: FastifyInstance, origin: string) {
  app.decorateRequest("user", null);
  app.decorateRequest("mobileTokenHash", null);
  app.decorateRequest("workspaceId", demoWorkspace);
  app.addHook("preHandler", async (req, reply) => {
    const cookie = req.cookies.cs_session;
    const authorization = req.headers.authorization;
    const { mobileAuth, publicAuth } = req.routeOptions.config;
    if (pilot) reply.header("Cache-Control", "no-store");

    if (mobileAuth === "exchange") {
      if (cookie || authorization !== undefined) fail("请使用配对码连接手机");
      reply.header("Cache-Control", "no-store");
      return;
    }

    if (authorization !== undefined) {
      if (pilot) fail("请使用网页版登录", 403);
      if (cookie) fail("请求只能使用一种会话凭据");
      if (mobileAuth !== "allowed" && mobileAuth !== "required")
        fail("移动端会话无法访问此接口", 403);
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(authorization)?.[1];
      if (!token) fail("移动端会话无效，请重新配对", 401);
      const tokenHash = digest(token);
      const {
        rows: [user],
      } = await pool.query<Member>(
        "SELECT u.id,u.name,u.role,u.color FROM mobile_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
        [tokenHash],
      );
      if (!user) fail("移动端会话已失效，请重新配对", 401);
      req.user = user;
      req.mobileTokenHash = tokenHash;
      reply.header("Cache-Control", "no-store");
      return;
    }

    if (mobileAuth === "required") fail("请先配对手机", 401);
    if (!["GET", "HEAD"].includes(req.method) && req.headers.origin !== origin)
      fail("来源校验失败", 403);
    if (publicAuth) return;
    const identity = (await session(cookie)) ?? fail("请先登录", 401);
    const workspace = req.headers["x-cospace-workspace"];
    if (pilot && workspace !== undefined && workspace !== identity.workspaceId)
      fail("当前工作区已切换，请刷新页面后重试。", 409);
    req.workspaceId = identity.workspaceId;
    req.user = identity;
  });
}

export function registerMobileSessionRoutes(app: FastifyInstance) {
  app.post(
    "/api/mobile/pairings",
    { config: { rateLimit: pairingRateLimit } },
    async (req, reply): Promise<MobilePairing> => {
      reply.header("Cache-Control", "no-store");
      const code = Array.from(
        randomBytes(8),
        (byte) => pairingAlphabet[byte % pairingAlphabet.length],
      ).join("");
      await pool.query("DELETE FROM mobile_pairings WHERE expires_at<=now()");
      const {
        rows: [pairing],
      } = await pool.query<{ expires_at: Date }>(
        `INSERT INTO mobile_pairings(code_hash,user_id,expires_at)
         VALUES($1,$2,now()+interval '5 minutes') ON CONFLICT DO NOTHING
         RETURNING expires_at`,
        [digest(code), member(req).id],
      );
      if (!pairing) fail("生成配对码失败，请重试", 503);
      return { code, expiresAt: pairing.expires_at.toISOString() };
    },
  );

  app.post(
    "/api/mobile/session",
    {
      config: {
        mobileAuth: "exchange",
        rateLimit: pairingRateLimit,
      },
    },
    async (req): Promise<MobileSession> => {
      const { code } = z
        .strictObject({
          code: z
            .string()
            .trim()
            .toUpperCase()
            .regex(/^[A-Z0-9]{8}$/),
        })
        .parse(req.body);
      const token = randomBytes(32).toString("base64url");
      const {
        rows: [issued],
      } = await pool.query<Member & { expires_at: Date }>(
        `WITH pairing AS (
           DELETE FROM mobile_pairings WHERE code_hash=$1 AND expires_at>now()
           RETURNING user_id
         ), issued AS (
           INSERT INTO mobile_sessions(token_hash,user_id,expires_at)
           SELECT $2,user_id,now()+interval '24 hours' FROM pairing
           RETURNING user_id,expires_at
         )
         SELECT u.id,u.name,u.role,u.color,s.expires_at
         FROM issued s JOIN users u ON u.id=s.user_id`,
        [digest(code), digest(token)],
      );
      if (!issued) fail("配对码无效或已过期，请在网页上生成新码", 401);
      const { expires_at, ...user } = issued;
      return { token, expiresAt: expires_at.toISOString(), user };
    },
  );

  app.get(
    "/api/mobile/me",
    { config: { mobileAuth: "required" } },
    async (req): Promise<MobileIdentity> => ({
      user: member(req),
      members: (
        await pool.query<Member>(
          "SELECT id,name,color,role FROM users ORDER BY id",
        )
      ).rows,
    }),
  );

  app.delete(
    "/api/mobile/session",
    { config: { mobileAuth: "required" } },
    async (req) => {
      await pool.query("DELETE FROM mobile_sessions WHERE token_hash=$1", [
        req.mobileTokenHash,
      ]);
      return { ok: true };
    },
  );
}
