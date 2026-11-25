import { createHash } from "node:crypto";
import { z } from "zod";
export const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const taskPatch = z
  .object({
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(180).optional(),
    assignee: z
      .union([z.uuid(), z.enum(["lin", "chen", "guest"])])
      .nullable()
      .optional(),
    status: z.enum(["todo", "doing", "done"]).optional(),
    priority: z.enum(["high", "medium", "low"]).optional(),
    due_at: z.string().datetime({ offset: true }).nullable().optional(),
    start_at: z.string().datetime({ offset: true }).nullable().optional(),
    end_at: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();
export function validWindow(start: string | null, end: string | null) {
  return (
    (!start && !end) ||
    (!!start && !!end && new Date(end).getTime() > new Date(start).getTime())
  );
}
export function overlaps(
  a: {
    start_at: string | null;
    end_at: string | null;
    assignee: string | null;
  },
  b: {
    start_at: string | null;
    end_at: string | null;
    assignee: string | null;
  },
) {
  return (
    !!a.assignee &&
    a.assignee === b.assignee &&
    !!a.start_at &&
    !!a.end_at &&
    !!b.start_at &&
    !!b.end_at &&
    Date.parse(a.start_at) < Date.parse(b.end_at) &&
    Date.parse(b.start_at) < Date.parse(a.end_at)
  );
}
export function textFromXml(node: any): string {
  if (typeof node.toDelta === "function")
    return node
      .toDelta()
      .map((part: { insert: unknown }) =>
        typeof part.insert === "string" ? part.insert : "",
      )
      .join("");
  if (typeof node.toArray !== "function") return node.toString();
  return node
    .toArray()
    .map((child: any) => textFromXml(child))
    .join(["paragraph", "heading"].includes(node.nodeName) ? "" : "\n");
}
export const aiTasks = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().min(1).max(180),
        assignee: z.enum(["lin", "chen"]),
        due_at: z.string().nullable().optional(),
      }),
    )
    .min(1)
    .max(8),
});
