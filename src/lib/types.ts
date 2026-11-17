export type Member = {
  id: string;
  name: string;
  color: string;
  role: "editor" | "viewer";
};
export type Message = {
  id: string;
  body: string;
  user_id: string;
  created_at: string;
  reply_to: string | null;
  client_id: string;
};
export type Task = {
  id: string;
  title: string;
  assignee: string;
  status: "todo" | "doing" | "done";
  priority: "high" | "medium" | "low";
  due_at: string | null;
  start_at: string | null;
  end_at: string | null;
  version: number;
  source: string | null;
};
export type DocMeta = { id: string; title: string };
export type Workspace = {
  user: Member;
  members: Member[];
  messages: Message[];
  tasks: Task[];
  documents: DocMeta[];
  cursor: number;
  ai: { provider: string; model: string };
};
export type Operation = {
  type:
    | "append_document"
    | "replace_paragraph"
    | "create_tasks"
    | "schedule_tasks";
  documentId?: string;
  baseHash?: string;
  blockIndex?: number;
  text?: string;
  tasks?: { title: string; assignee: string; due_at?: string | null }[];
  schedules?: {
    id: string;
    title?: string;
    assignee?: string;
    version: number;
    start_at: string;
    end_at: string;
  }[];
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
export type DocContext = {
  text: string;
  hash: string;
  blockIndex?: number;
  selectedText?: string;
};
export type View = "chat" | "document" | "tasks" | "calendar" | "budget";
