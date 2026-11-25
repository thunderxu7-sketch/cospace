import type { FastifyInstance } from "fastify";
import { pilot } from "./config";
import { z } from "zod";
import { pool } from "./db";
import { fail, member } from "./session";
import type {
  MobileReviewSummary,
  Page,
  RunDetail,
  Task,
} from "../packages/contracts/src/index";

export const actionItemRun =
  "mode='tasks' AND proposal->>'type'='create_tasks'";

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z
    .string()
    .min(1)
    .max(150)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});
const cursorValue = z.tuple([
  z.iso.datetime().refine((value) => !value.startsWith("0000")),
  z.uuid(),
]);

function decodeCursor(cursor?: string): [string | null, string | null] {
  if (!cursor) return [null, null];
  try {
    return cursorValue.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
  } catch {
    fail("分页游标无效，请刷新列表");
  }
}

type CursorRow = { id: string; cursor_time: string };

function page<Row extends CursorRow>(
  rows: Row[],
  limit: number,
): Page<Omit<Row, "cursor_time">> {
  const last = rows[limit - 1];
  return {
    items: rows.slice(0, limit).map(({ cursor_time, ...row }) => row),
    nextCursor:
      rows.length > limit
        ? Buffer.from(JSON.stringify([last.cursor_time, last.id])).toString(
            "base64url",
          )
        : null,
  };
}

export function registerMobileDataRoutes(app: FastifyInstance) {
  if (!pilot)
    app.get(
      "/api/mobile/reviews",
      { config: { mobileAuth: "required" } },
      async (req): Promise<Page<MobileReviewSummary>> => {
        const { limit, cursor } = pageQuery.parse(req.query);
        const { rows } = await pool.query<MobileReviewSummary & CursorRow>(
          `SELECT r.id,r.created_at AS "createdAt",d.title AS "documentTitle",
           CASE WHEN jsonb_typeof(r.proposal->'tasks')='array'
             THEN jsonb_array_length(r.proposal->'tasks') ELSE 0 END AS "taskCount",
           to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
         FROM runs r LEFT JOIN documents d ON d.id=COALESCE(r.proposal->>'documentId',r.sources->0->>'id') AND d.workspace_id=r.workspace_id
         WHERE r.user_id=$1 AND (${actionItemRun}) AND r.status='ready'
           AND ($2::timestamptz IS NULL OR (r.created_at,r.id)<($2::timestamptz,$3::uuid))
         ORDER BY r.created_at DESC,r.id DESC LIMIT $4`,
          [member(req).id, ...decodeCursor(cursor), limit + 1],
        );
        return page(rows, limit);
      },
    );

  app.get(
    "/api/runs/:id",
    { config: { mobileAuth: "allowed" } },
    async (req): Promise<RunDetail> => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const {
        rows: [run],
      } = await pool.query<RunDetail>(
        `SELECT r.id,r.mode,r.status,r.output,r.proposal,r.error,r.result,r.sources,r.created_at,
           d.title AS "documentTitle"
         FROM runs r LEFT JOIN documents d ON d.id=COALESCE(r.proposal->>'documentId',r.sources->0->>'id') AND d.workspace_id=r.workspace_id
         WHERE r.id=$1 AND r.user_id=$2 AND (NOT $3::boolean OR (${actionItemRun})) AND r.workspace_id=$4`,
        [id, member(req).id, !!req.mobileTokenHash, req.workspaceId],
      );
      return run ?? fail("操作不存在", 404);
    },
  );

  app.get(
    "/api/tasks",
    { config: { mobileAuth: "allowed" } },
    async (req): Promise<Page<Task>> => {
      const { limit, cursor, assignee } = pageQuery
        .extend({ assignee: z.enum(["me", "all"]).default("all") })
        .parse(req.query);
      const { rows } = await pool.query<Task & CursorRow>(
        `SELECT t.*,to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
         FROM tasks t WHERE ($1::text IS NULL OR t.assignee=$1)
           AND ($2::timestamptz IS NULL OR (t.created_at,t.id)<($2::timestamptz,$3::uuid))
           AND t.workspace_id=$5
         ORDER BY t.created_at DESC,t.id DESC LIMIT $4`,
        [
          assignee === "me" ? member(req).id : null,
          ...decodeCursor(cursor),
          limit + 1,
          req.workspaceId,
        ],
      );
      return page(rows, limit);
    },
  );

  app.get(
    "/api/tasks/:id",
    { config: { mobileAuth: "allowed" } },
    async (req): Promise<Task> => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const {
        rows: [task],
      } = await pool.query<Task>(
        "SELECT * FROM tasks WHERE id=$1 AND workspace_id=$2",
        [id, req.workspaceId],
      );
      return task ?? fail("任务不存在", 404);
    },
  );
}
