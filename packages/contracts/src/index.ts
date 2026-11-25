export type Member = {
  id: string;
  name: string;
  color: string;
  role: "owner" | "editor" | "viewer";
};

export type TaskStatus = "todo" | "doing" | "done";

export type Task = {
  id: string;
  title: string;
  assignee: string | null;
  status: TaskStatus;
  priority: "high" | "medium" | "low";
  due_at: string | null;
  start_at: string | null;
  end_at: string | null;
  version: number;
  source: string | null;
};

export type Operation = {
  type:
    | "append_document"
    | "replace_paragraph"
    | "create_tasks"
    | "schedule_tasks";
  documentId?: string;
  documentRevision?: number;
  baseHash?: string;
  blockIndex?: number;
  text?: string;
  tasks?: ActionItem[];
  schedules?: {
    id: string;
    title?: string;
    assignee?: string;
    version: number;
    start_at: string;
    end_at: string;
  }[];
};

export type ActionItem = {
  title: string;
  assignee: string | null;
  due_at?: string | null;
  evidence?: string;
};

export type Run = {
  id: string;
  mode: string;
  status: string;
  output: string;
  proposal: Operation | null;
  error: string | null;
  result: unknown;
  sources: { id: string; text: string }[];
  created_at: string;
};

export type RunDetail = Run & { documentTitle: string | null };

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

export type MobileReviewSummary = {
  id: string;
  createdAt: string;
  documentTitle: string | null;
  taskCount: number;
};

export type MobilePairing = {
  code: string;
  expiresAt: string;
};

export type MobileSession = {
  token: string;
  expiresAt: string;
  user: Member;
};

export type MobileIdentity = {
  user: Member;
  members: Member[];
};

export type ApplyRunResponse = { ok: true; result: unknown };
export type CreateTasksResult = { taskIds: string[] };
