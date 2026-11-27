"use client";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { useEffect, useState, useRef } from "react";
import dynamic from "next/dynamic";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Aperture,
  MessageSquare,
  FileText,
  Table2,
  CalendarDays,
  Sheet,
  Sparkles,
  ChevronDown,
  ArrowUpRight,
  LogOut,
  Search,
  X,
  Menu,
  Check,
  Users,
  ArrowRight,
} from "lucide-react";
import { api, ApiError, websocketUrl } from "@/lib/api";
import type { Workspace, Task, View, DocContext } from "@/lib/types";
import Chat from "./chat";
import Tasks from "./tasks";
import AiPanel from "./ai-panel";
import MobilePairing from "./mobile-pairing";
import PilotAccess, {
  emailLinkFromLocation,
  type EmailLink,
} from "./pilot-access";
import PilotWorkspace from "./pilot-workspace";
const Editor = dynamic(() => import("./editor"), {
  ssr: false,
  loading: () => <Loading text="正在打开协作文档…" />,
});
const Calendar = dynamic(() => import("./calendar"), {
  ssr: false,
  loading: () => <Loading text="正在载入日历…" />,
});
const Budget = dynamic(() => import("./budget"), {
  ssr: false,
  loading: () => <Loading text="正在载入预算表…" />,
});
export function Loading({ text = "正在连接工作区…" }: { text?: string }) {
  return (
    <div className="loading">
      <span className="spinner" />
      {text}
    </div>
  );
}
const tabs = [
  { id: "chat", label: "讨论", Icon: MessageSquare },
  { id: "document", label: "文档", Icon: FileText },
  { id: "tasks", label: "任务", Icon: Table2 },
  { id: "calendar", label: "日历", Icon: CalendarDays },
  { id: "budget", label: "预算", Icon: Sheet },
] as const;
export function Avatar({
  name,
  color,
  small = false,
}: {
  name: string;
  color: string;
  small?: boolean;
}) {
  return (
    <span
      className={"avatar" + (small ? " small" : "")}
      style={{
        background: color + "16",
        color: `color-mix(in srgb, ${color} 72%, #18241d)`,
      }}
    >
      {name.slice(-2)}
    </span>
  );
}

export default function WorkspaceApp() {
  const client = useQueryClient();
  const { data, error, isPending } = useQuery<Workspace>({
    queryKey: ["workspace"],
    queryFn: () => api("/workspace"),
  });
  const [emailLink, setEmailLink] = useState<EmailLink | null>(null);
  const { data: authConfig } = useQuery({
    queryKey: ["auth-config"],
    queryFn: () =>
      api<{ mode: "demo" | "pilot"; emailEnabled: boolean }>("/auth/config"),
    enabled: !data || !!emailLink,
  });
  useEffect(() => {
    const read = () => setEmailLink(emailLinkFromLocation());
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const [view, setView] = useState<View>("chat");
  const [online, setOnline] = useState(false);
  const [people, setPeople] = useState<string[]>([]);
  const [ai, setAi] = useState<{ mode: string; context?: DocContext } | null>(
    null,
  );
  const [notice, setNotice] = useState("");
  const [docId, setDocId] = useState("launch");
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useDialogFocus(search !== null, () => setSearch(null));
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearch("");
      }
      if (e.key === "Escape") {
        setSearch(null);
        setAi(null);
        setMenu(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (search !== null) searchRef.current?.focus();
  }, [search !== null]);
  useEffect(() => {
    if (!data?.user) return;
    let stopped = false;
    let ws: WebSocket;
    let timer: ReturnType<typeof setTimeout>;
    let delay = 500;
    const connect = () => {
      ws = new WebSocket(
        data.mode === "pilot"
          ? websocketUrl("/ws/events")
          : `ws://${window.location.hostname}:4027/events`,
      );
      ws.onopen = () => {
        setOnline(true);
        delay = 500;
      };
      ws.onmessage = (e) => {
        const event = JSON.parse(e.data);
        if (event.kind === "presence") {
          setPeople(event.users);
          if (data.mode === "pilot")
            void client.invalidateQueries({ queryKey: ["workspace"] });
          return;
        }
        if (["refresh", "message", "tasks", "document"].includes(event.kind))
          void client.invalidateQueries({ queryKey: ["workspace"] });
      };
      ws.onclose = (event) => {
        setOnline(false);
        setPeople([]);
        if (event.code === 4001) {
          void client.invalidateQueries({ queryKey: ["workspace"] });
          return;
        }
        if (!stopped) {
          timer = setTimeout(connect, delay);
          delay = Math.min(delay * 2, 10000);
        }
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [data?.user.id, data?.mode, data?.workspace?.id, client]);
  async function updateTask(task: Task, patch: Partial<Task>) {
    const optimistic = { ...task, ...patch };
    client.setQueryData<Workspace>(["workspace"], (old) =>
      old
        ? {
            ...old,
            tasks: old.tasks.map((t) => (t.id === task.id ? optimistic : t)),
          }
        : old,
    );
    try {
      await api("/tasks/" + task.id, {
        method: "PATCH",
        body: JSON.stringify({ ...patch, version: task.version }),
      });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "更新失败");
      throw e;
    } finally {
      await client.invalidateQueries({ queryKey: ["workspace"] });
    }
  }
  if (authConfig?.mode === "pilot" && emailLink)
    return <PilotAccess key={emailLink.token} link={emailLink} />;
  if (error instanceof ApiError && error.status === 401) {
    if (!authConfig) return <Loading />;
    if (authConfig.mode === "pilot") {
      if (authConfig.emailEnabled) return <PilotAccess link={null} />;
      return (
        <div className="login-shell">
          <section className="login-card">
            <h1>CoSpace 团队工作区</h1>
            <p>
              邮件登录暂未开放。已收到邀请的成员可以通过邮件中的链接加入工作区。
            </p>
          </section>
        </div>
      );
    }
    return (
      <Login
        onLogin={() => client.invalidateQueries({ queryKey: ["workspace"] })}
      />
    );
  }
  if (isPending) return <Loading />;
  if (!data) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <Aperture size={36} />
          <h1>暂时无法连接工作区</h1>
          <p>{error?.message}</p>
          <button
            className="primary"
            onClick={() =>
              client.invalidateQueries({ queryKey: ["workspace"] })
            }
          >
            重新连接
          </button>
        </div>
      </div>
    );
  }
  if (data.mode === "pilot")
    return (
      <PilotWorkspace
        key={data.workspace.id + ":" + data.user.id}
        data={data}
        online={online}
        updateTask={updateTask}
      />
    );
  const readonly = data.user.role === "viewer";
  const complete = data.tasks.filter((t) => t.status === "done").length;
  return (
    <div className={"workspace" + (ai ? " has-ai" : "")}>
      <aside className={"sidebar" + (menu ? " open" : "")}>
        <a className="brand" href="/" aria-label="CoSpace 首页">
          <span className="brand-mark">
            <Aperture size={25} />
          </span>
          cospace<span className="version">beta</span>
        </a>
        <button
          className="workspace-select"
          onClick={() =>
            setNotice(
              "当前工作区：CoSpace 产品团队。成员共享同一份消息、文档与任务。",
            )
          }
        >
          <span className="workspace-monogram">C</span>
          <span>
            产品工作室<small>3 位成员 · 本地工作区</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <button className="search-button" onClick={() => setSearch("")}>
          <Search size={15} />
          搜索工作区<kbd>⌘ K</kbd>
        </button>
        <div className="nav-label">工作空间</div>
        <button
          className="side-link selected"
          onClick={() => {
            setView("chat");
            setMenu(false);
          }}
        >
          <span className="project-dot" />
          CoSpace 1.0 发布<span className="count">{data.tasks.length}</span>
        </button>
        <button
          className={
            "side-link " +
            (docId === "notes" && view === "document" ? "active" : "")
          }
          onClick={() => {
            setDocId("notes");
            setView("document");
            setMenu(false);
          }}
        >
          <FileText size={16} />
          团队随手记
        </button>
        <button
          className="side-link"
          onClick={() => {
            setView("tasks");
            setMenu(false);
          }}
        >
          <Check size={16} />
          全部任务<span className="count">{data.tasks.length}</span>
        </button>
        <div className="sidebar-note">
          <span className="eyebrow">一个空间，持续向前</span>
          <p>
            让讨论有结果，
            <br />
            让每一步都有回应。
          </p>
          <div className="mini-lines">
            <i />
            <i />
            <i />
          </div>
        </div>
        <div className="team-list">
          <div className="nav-label">
            空间成员 <span>{people.length} 在线</span>
          </div>
          {data.members.map((m) => (
            <div className="team-member" key={m.id}>
              <Avatar name={m.name} color={m.color} small />
              <span>{m.name}</span>
              <span
                className={
                  "presence-dot " + (people.includes(m.id) ? "on" : "")
                }
              />
            </div>
          ))}
        </div>
        <div className="profile">
          <Avatar name={data.user.name} color={data.user.color} />
          <div>
            {data.user.name}
            <small>{readonly ? "只读成员" : "协作成员"}</small>
          </div>
          <button
            className="icon-button"
            aria-label="退出登录"
            onClick={async () => {
              await api("/logout", { method: "POST" });
              client.clear();
              window.location.reload();
            }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              aria-label="打开导航"
              onClick={() => setMenu(!menu)}
            >
              <Menu size={18} />
            </button>
            工作空间 <span>/</span>
            <strong>CoSpace 1.0 发布</strong>
          </div>
          <div className="top-actions">
            <span className={"connection " + (online ? "online" : "")}>
              <i />
              {online ? "实时连接" : "正在重连"}
            </span>
            <div className="avatar-stack">
              {data.members
                .filter((m) => people.includes(m.id))
                .map((m) => (
                  <Avatar key={m.id} name={m.name} color={m.color} small />
                ))}
            </div>
            <MobilePairing key={data.user.id} name={data.user.name} />
            <button
              className={"ai-toggle " + (ai ? "active" : "")}
              onClick={() =>
                setAi(
                  ai
                    ? null
                    : { mode: view === "document" ? "tasks" : "summary" },
                )
              }
            >
              <Sparkles size={15} />
              AI 工作流
            </button>
          </div>
        </header>
        <section className="project-header">
          <div>
            <div className="eyebrow">
              TEAM WORKSPACE <span className="soft-label">进行中</span>
            </div>
            <h1>
              好想法，一起落地<span className="title-dot">.</span>
            </h1>
            <p>
              CoSpace 1.0 发布计划 <span>·</span> 从团队讨论，到清晰的下一步。
            </p>
          </div>
          <div className="project-progress">
            <div>
              <span>发布准备</span>
              <strong>
                {complete}/{data.tasks.length}
              </strong>
            </div>
            <div className="progress-track">
              <i
                style={{
                  width: `${data.tasks.length ? (complete / data.tasks.length) * 100 : 0}%`,
                }}
              />
            </div>
            <small>任务已完成</small>
          </div>
        </section>
        <nav className="tabs" aria-label="项目视图">
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              aria-current={view === id ? "page" : undefined}
              className={view === id ? "active" : ""}
              onClick={() => {
                setView(id);
                if (id === "document") setDocId("launch");
              }}
            >
              <Icon size={16} />
              {label}
              {id === "tasks" && <span>{data.tasks.length}</span>}
            </button>
          ))}
          <div className="tabs-spacer" />
          <span className="workspace-tag">
            <Users size={13} />
            共同编辑，共同完成
          </span>
        </nav>
        {notice && (
          <div className="notice" role="alert">
            {notice}
            <button
              className="icon-button"
              aria-label="关闭提示"
              onClick={() => setNotice("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
        <div className="content-area">
          {view === "chat" && (
            <Chat
              onDocument={() => {
                setDocId("launch");
                setView("document");
              }}
              data={data}
              readonly={readonly}
              onAi={() => setAi({ mode: "summary" })}
            />
          )}
          {view === "document" && (
            <Editor
              key={docId + data.user.id}
              id={docId}
              user={data.user}
              title={
                data.documents.find((d) => d.id === docId)?.title || "文档"
              }
              onAi={(context) =>
                setAi({
                  mode: context.selectedText ? "rewrite" : "tasks",
                  context,
                })
              }
            />
          )}
          {view === "tasks" && (
            <Tasks
              data={data}
              readonly={readonly}
              update={updateTask}
              onAi={() => setAi({ mode: "tasks" })}
            />
          )}
          {view === "calendar" && (
            <Calendar
              data={data}
              readonly={readonly}
              update={updateTask}
              onAi={() => setAi({ mode: "schedule" })}
            />
          )}
          {view === "budget" && <Budget readonly={readonly} />}
        </div>
      </main>
      {ai && (
        <AiPanel
          model={data.ai.model}
          key={ai.mode + JSON.stringify(ai.context)}
          initialMode={ai.mode}
          context={ai.context}
          documentId={docId}
          readonly={readonly}
          onClose={() => setAi(null)}
          onApplied={(mode) => {
            void client.invalidateQueries({ queryKey: ["workspace"] });
            if (mode === "summary" || mode === "rewrite") setView("document");
            else if (mode === "tasks") setView("tasks");
            else setView("calendar");
          }}
        />
      )}
      {search !== null && (
        <div className="modal-backdrop" onMouseDown={() => setSearch(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="搜索工作区"
            className="search-dialog"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div>
              <Search size={18} />
              <input
                ref={searchRef}
                aria-label="搜索内容"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索任务、文档和消息…"
              />
              <button
                className="icon-button"
                aria-label="关闭搜索"
                onClick={() => setSearch(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="search-results">
              {[
                { label: "CoSpace 1.0 发布方案", view: "document" as View },
                ...data.tasks.map((t) => ({
                  label: t.title,
                  view: "tasks" as View,
                })),
                ...data.messages.map((m) => ({
                  label: m.body,
                  view: "chat" as View,
                })),
              ]
                .filter((x) =>
                  x.label.toLowerCase().includes(search.toLowerCase()),
                )
                .slice(0, 12)
                .map((x, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setView(x.view);
                      setSearch(null);
                    }}
                  >
                    <span>{x.label}</span>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function Login({ onLogin }: { onLogin: () => unknown }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="login-shell">
      <div className="login-story">
        <span className="brand">
          <Aperture size={32} />
          cospace
        </span>
        <div>
          <span className="eyebrow">A SPACE TO MAKE THINGS HAPPEN</span>
          <h1>
            把想法放在一起，
            <br />
            把事情向前推进。
          </h1>
          <p>
            讨论、文档、任务与日历。
            <br />
            团队协作，在一个空间自然发生。
          </p>
        </div>
        <span className="login-caption">CoSpace / 团队协作工作台</span>
      </div>
      <section className="login-card">
        <span className="eyebrow">WELCOME TO YOUR WORKSPACE</span>
        <h2>进入产品工作室</h2>
        <p>
          选择一个演示身份。使用两个独立浏览器窗口，
          <br />
          体验真实的多人协作与状态同步。
        </p>
        {[
          {
            id: "lin",
            name: "林知夏",
            color: "#327660",
            title: "产品与设计 · 可编辑",
          },
          {
            id: "chen",
            name: "陈屿",
            color: "#8773bf",
            title: "工程与交付 · 可编辑",
          },
          {
            id: "guest",
            name: "观察者",
            color: "#8a7865",
            title: "体验工作区 · 只读",
          },
        ].map((m) => (
          <button
            className="login-person"
            disabled={busy}
            key={m.id}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api("/login", {
                  method: "POST",
                  body: JSON.stringify({
                    id: m.id,
                    password: "cospace-demo-2026",
                  }),
                });
                await onLogin();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Avatar name={m.name} color={m.color} />
            <span>
              <strong>{m.name}</strong>
              <small>{m.title}</small>
            </span>
            <ArrowRight size={17} />
          </button>
        ))}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <small className="login-footnote">
          本地演示空间 · 数据会持久保存 · AI 接入本机 Ollama
        </small>
      </section>
    </div>
  );
}
