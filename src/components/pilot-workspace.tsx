"use client";

import dynamic from "next/dynamic";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import type { DocContext, DocMeta, Task, Workspace } from "@/lib/types";
import AiPanel from "./ai-panel";
import Tasks from "./tasks";

const Editor = dynamic(() => import("./editor"), { ssr: false });
type Invitation = {
  id: string;
  email: string;
  role: string;
  expires_at: string;
};

export default function PilotWorkspace({
  data,
  online,
  updateTask,
}: {
  data: Workspace;
  online: boolean;
  updateTask: (task: Task, patch: Partial<Task>) => Promise<void>;
}) {
  const client = useQueryClient();
  const [view, setView] = useState<"documents" | "tasks" | "members">(
    "documents",
  );
  const [id, setId] = useState("");
  const [review, setReview] = useState<{
    document: DocMeta;
    context: DocContext;
  } | null>(null);
  const [documentForm, setDocumentForm] = useState<"create" | "rename" | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const document =
    data.documents.find((item) => item.id === id) ?? data.documents[0];
  const readonly = data.user.role === "viewer";
  const owner = data.user.role === "owner";
  const workspaceId = data.workspace.id;
  const invitations = useQuery({
    queryKey: ["invitations", workspaceId],
    queryFn: () => api<Invitation[]>("/invitations", { workspaceId }),
    enabled: owner && view === "members",
  });

  const refresh = () => client.invalidateQueries({ queryKey: ["workspace"] });
  async function act(use: () => Promise<unknown>, success = "") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await use();
      setNotice(success);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "暂时无法操作，请重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  function saveDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = new FormData(event.currentTarget).get("title");
    const creating = documentForm === "create";
    if (!creating && !document) return;
    void act(async () => {
      const saved = await api<DocMeta>(
        creating ? "/documents" : "/documents/" + document.id,
        {
          method: creating ? "POST" : "PATCH",
          workspaceId,
          body: JSON.stringify({ title }),
        },
      );
      await refresh();
      setId(saved.id);
      setDocumentForm(null);
    });
  }
  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    void act(async () => {
      await api("/invitations", {
        method: "POST",
        workspaceId,
        body: JSON.stringify({
          email: values.get("email"),
          role: values.get("role"),
        }),
      });
      form.reset();
      await invitations.refetch();
    }, "邀请邮件已发出。");
  }

  return (
    <div className={"workspace pilot-workspace" + (review ? " has-ai" : "")}>
      <aside className="pilot-sidebar">
        <a className="brand" href="/">
          CoSpace
        </a>
        <strong>{data.workspace.name}</strong>
        {data.workspaces.length > 1 && (
          <label className="pilot-form">
            切换工作区
            <select
              aria-label="切换工作区"
              value={data.workspace.id}
              disabled={busy}
              onChange={(event) => {
                const target = event.target.value;
                void act(async () => {
                  await api(`/workspaces/${target}/switch`, {
                    method: "POST",
                    workspaceId,
                  });
                  client.clear();
                  window.location.reload();
                });
              }}
            >
              {data.workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <nav aria-label="工作区导航">
          {(["documents", "tasks", "members"] as const).map((tab) => (
            <button
              key={tab}
              aria-current={view === tab ? "page" : undefined}
              onClick={() => {
                setView(tab);
                setDocumentForm(null);
                setError("");
                setNotice("");
              }}
            >
              {{ documents: "文档", tasks: "任务", members: "成员" }[tab]}
            </button>
          ))}
        </nav>
        <div className="pilot-user">
          <span>{data.user.name}</span>
          <button
            className="text-button"
            onClick={() =>
              void act(async () => {
                await api("/logout", { method: "POST" });
                client.clear();
                window.location.reload();
              })
            }
          >
            退出登录
          </button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <h1>{data.workspace.name}</h1>
          <span className={"connection " + (online ? "online" : "")}>
            <i />
            {online ? "实时连接" : "正在重连"}
          </span>
        </header>
        <div className="pilot-content">
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          {view === "documents" && (
            <>
              <div className="section-toolbar pilot-document-toolbar">
                <div>
                  {document && (
                    <label>
                      打开文档
                      <select
                        aria-label="打开文档"
                        value={document.id}
                        onChange={(event) => {
                          setId(event.target.value);
                          setReview(null);
                          setDocumentForm(null);
                        }}
                      >
                        {data.documents.map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                {!readonly && (
                  <div>
                    {document && (
                      <button
                        className="text-button"
                        onClick={() => setDocumentForm("rename")}
                      >
                        重命名
                      </button>
                    )}
                    <button
                      className="primary"
                      onClick={() => setDocumentForm("create")}
                    >
                      新建文档
                    </button>
                  </div>
                )}
              </div>
              {documentForm && (
                <form
                  className="pilot-form pilot-inline-form"
                  onSubmit={saveDocument}
                  key={documentForm}
                >
                  <label>
                    文档名称
                    <input
                      name="title"
                      maxLength={120}
                      required
                      defaultValue={
                        documentForm === "rename" ? document?.title : ""
                      }
                    />
                  </label>
                  <button className="primary" disabled={busy}>
                    保存名称
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setDocumentForm(null)}
                  >
                    取消
                  </button>
                </form>
              )}
              {document ? (
                <Editor
                  key={document.id}
                  id={document.id}
                  title={document.title}
                  user={data.user}
                  pilot
                  onAi={(context) => setReview({ document, context })}
                />
              ) : (
                <p className="muted">工作区还没有文档。</p>
              )}
            </>
          )}
          {view === "tasks" && (
            <Tasks
              data={data}
              readonly={readonly}
              update={updateTask}
              onAi={() => setView("documents")}
            />
          )}
          {view === "members" && (
            <section className="pilot-members">
              <h2>工作区成员</h2>
              <ul>
                {data.members.map((person) => (
                  <li key={person.id}>
                    <span>
                      {person.name} ·{" "}
                      {
                        {
                          owner: "管理员",
                          editor: "编辑者",
                          viewer: "只读成员",
                        }[person.role]
                      }
                    </span>
                    {owner && person.role !== "owner" && (
                      <button
                        className="text-button"
                        disabled={busy}
                        aria-label={`移除 ${person.name}`}
                        onClick={() =>
                          void act(async () => {
                            await api("/members/" + person.id, {
                              method: "DELETE",
                              workspaceId,
                            });
                            await refresh();
                          }, "成员已移除。")
                        }
                      >
                        移除
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {owner && (
                <>
                  <form
                    className="pilot-form pilot-inline-form"
                    onSubmit={invite}
                  >
                    <label>
                      邀请邮箱
                      <input
                        name="email"
                        type="email"
                        required
                        maxLength={254}
                      />
                    </label>
                    <label>
                      角色
                      <select name="role" aria-label="角色">
                        <option value="editor">编辑者</option>
                        <option value="viewer">只读成员</option>
                      </select>
                    </label>
                    <button className="primary" disabled={busy}>
                      发送邀请
                    </button>
                  </form>
                  {invitations.error && (
                    <p className="inline-error" role="alert">
                      {invitations.error.message}
                    </p>
                  )}
                  {!!invitations.data?.length && (
                    <ul aria-label="待接受邀请">
                      {invitations.data.map((item) => (
                        <li key={item.id}>
                          <span>{item.email} · 待接受</span>
                          <button
                            className="text-button"
                            disabled={busy}
                            aria-label={`撤销 ${item.email} 的邀请`}
                            onClick={() =>
                              void act(async () => {
                                await api("/invitations/" + item.id, {
                                  method: "DELETE",
                                  workspaceId,
                                });
                                await invitations.refetch();
                              }, "邀请已撤销。")
                            }
                          >
                            撤销邀请
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>
          )}
        </div>
      </main>
      {review && (
        <AiPanel
          key={review.document.id + ":" + review.context.revision}
          initialMode="tasks"
          model={data.ai.model}
          documentId={review.document.id}
          context={review.context}
          readonly={readonly}
          pilotReview={{ title: review.document.title, members: data.members }}
          onClose={() => setReview(null)}
          onApplied={() => {
            void refresh();
            setView("tasks");
          }}
        />
      )}
    </div>
  );
}
