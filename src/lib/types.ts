import type { Member, Task } from "../../packages/contracts/src";
export type {
  Member,
  Operation,
  Run,
  Task,
} from "../../packages/contracts/src";

export type Message = {
  id: string;
  body: string;
  user_id: string;
  created_at: string;
  reply_to: string | null;
  client_id: string;
};
export type DocMeta = { id: string; title: string };
export type WorkspaceMeta = { id: string; name: string };
export type Workspace = {
  mode: "demo" | "pilot";
  workspace: WorkspaceMeta;
  workspaces: WorkspaceMeta[];
  user: Member;
  members: Member[];
  messages: Message[];
  tasks: Task[];
  documents: DocMeta[];
  cursor: number;
  ai: { provider: string; model: string };
};
export type DocContext = {
  text: string;
  hash: string;
  savedHash?: string;
  revision?: number;
  blockIndex?: number;
  selectedText?: string;
};
export type View = "chat" | "document" | "tasks" | "calendar" | "budget";
