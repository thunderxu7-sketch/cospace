"use client";
import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  X,
  Check,
  Square,
  FileText,
  ListChecks,
  CalendarDays,
  History,
  ChevronRight,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { api, readStream } from "@/lib/api";
import type { DocContext, Operation, Run } from "@/lib/types";
const modes = {
  summary: "整理讨论",
  tasks: "提取行动项",
  rewrite: "改写段落",
  schedule: "建议排期",
};
export default function AiPanel({
  initialMode,
  model,
  context,
  documentId,
  readonly,
  onClose,
  onApplied,
}: {
  initialMode: string;
  model: string;
  context?: DocContext;
  documentId: string;
  readonly: boolean;
  onClose: () => void;
  onApplied: (mode: string) => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [id, setId] = useState("");
  const [proposal, setProposal] = useState<Operation | null>(null);
  const [sources, setSources] = useState<{ id: string; text: string }[]>([]);
  const [history, setHistory] = useState<Run[] | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function generate() {
    setError("");
    setOutput("");
    setProposal(null);
    setHistory(null);
    setStatus("running");
    const abort = new AbortController();
    controller.current = abort;
    let terminal = false;
    try {
      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          documentId,
          prompt,
          ...(mode === "rewrite"
            ? {
                selectedText: context?.selectedText,
                blockIndex: context?.blockIndex,
                baseHash: context?.hash,
              }
            : {}),
        }),
        signal: abort.signal,
      });
      if (!response.ok || !response.body)
        throw new Error((await response.json()).error || "生成失败");
      for await (const event of readStream(response.body)) {
        if (event.type === "start") {
          setId(event.id);
          setSources(event.sources);
        }
        if (event.type === "delta") {
          setOutput((s) => s + event.text);
        }
        if (event.type === "proposal") {
          setProposal(event.proposal);
          setStatus("ready");
          terminal = true;
        }
        if (event.type === "error") {
          setError(event.message);
          setStatus("failed");
          terminal = true;
        }
      }
      if (!terminal) throw new Error("连接中断，未收到完整建议，请重试。");
    } catch (e) {
      setStatus(abort.signal.aborted ? "cancelled" : "failed");
      setError(
        abort.signal.aborted
          ? "已停止生成，尚未修改任何内容。"
          : (e as Error).message,
      );
    } finally {
      controller.current = null;
    }
  }
  const structured = mode === "tasks" || mode === "schedule";
  return (
    <aside className="ai-panel">
      <header>
        <span className="ai-symbol">
          <Sparkles size={18} />
        </span>
        <div>
          <strong>一起，把事情推进</strong>
          <small>CoSpace AI · {model}</small>
        </div>
        <button
          className="icon-button"
          aria-label="关闭 AI 工作流"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="ai-panel-body">
        <div className="ai-context">
          <span className="eyebrow">当前上下文</span>
          <p>
            <FileText size={14} />
            {mode === "summary"
              ? "发布讨论 · 最近 20 条消息"
              : mode === "schedule"
                ? "团队行动项 · 未完成任务"
                : documentId === "notes"
                  ? "团队随手记"
                  : "CoSpace 1.0 发布方案"}
          </p>
        </div>
        <h3>想从哪里开始？</h3>
        <div className="ai-modes">
          {Object.entries(modes)
            .filter(([key]) => key !== "rewrite" || context?.selectedText)
            .map(([key, label]) => (
              <button
                key={key}
                className={mode === key ? "active" : ""}
                disabled={status === "running" || status === "applying"}
                onClick={() => {
                  setMode(key);
                  setStatus("idle");
                  setProposal(null);
                  setOutput("");
                  setError("");
                }}
              >
                {label}
              </button>
            ))}
        </div>
        {context?.selectedText && mode === "rewrite" && (
          <blockquote className="ai-selection">
            {context.selectedText}
          </blockquote>
        )}
        <label className="ai-prompt-label">
          补充你的要求
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            aria-label="AI 补充要求"
            placeholder={
              mode === "summary"
                ? "例如：突出已确认的决定与待讨论问题"
                : mode === "schedule"
                  ? "例如：给任务留出检查和反馈时间"
                  : "例如：保持简洁，给出清晰的下一步"
            }
            rows={3}
            maxLength={2000}
          />
        </label>
        <button
          className="primary ai-generate"
          disabled={readonly || status === "running" || status === "applying"}
          onClick={generate}
        >
          <Sparkles size={15} />
          生成{modes[mode as keyof typeof modes]}
        </button>
        <div className="ai-explain">建议会先展示，确认后才写入工作区。</div>
        {status === "running" && (
          <div className="ai-progress" role="status">
            <LoaderCircle className="spinning" size={17} />
            <span>{structured ? "正在整理可执行操作…" : "正在生成建议…"}</span>
            <button
              aria-label="停止生成"
              onClick={() => controller.current?.abort()}
            >
              <Square size={13} />
              停止
            </button>
          </div>
        )}
        {error && (
          <div className="ai-error" role="alert">
            {error}
          </div>
        )}
        {output && !structured && (
          <section className="ai-output">
            <div className="eyebrow">
              {status === "ready" ? "修改预览" : "生成内容"}
            </div>
            <p>{output}</p>
          </section>
        )}
        {structured && status === "running" && (
          <div className="stream-counter">
            正在接收模型输出 · {output.length} 字符
          </div>
        )}
        {proposal && (
          <section className="proposal">
            <div className="eyebrow">
              {proposal.type === "create_tasks"
                ? "拟创建任务"
                : proposal.type === "schedule_tasks"
                  ? "拟调整排期"
                  : "拟修改文档"}
            </div>
            {proposal.tasks?.map((t, i) => (
              <div className="proposal-task" key={i}>
                <ListChecks size={15} />
                <div>
                  <strong>{t.title}</strong>
                  <small>
                    {t.assignee === "lin" ? "林知夏" : "陈屿"} ·{" "}
                    {t.due_at
                      ? new Date(t.due_at).toLocaleDateString("zh-CN")
                      : "未指定截止日期"}
                  </small>
                </div>
              </div>
            ))}
            {proposal.schedules?.map((s) => (
              <div className="proposal-task" key={s.id}>
                <CalendarDays size={15} />
                <div>
                  <strong>{s.title || "任务排期"}</strong>
                  <small>
                    {s.assignee === "chen" ? "陈屿" : "林知夏"} ·{" "}
                    {new Date(s.start_at).toLocaleString("zh-CN", {
                      timeZone: "Asia/Shanghai",
                    })}{" "}
                    至{" "}
                    {new Date(s.end_at).toLocaleTimeString("zh-CN", {
                      timeZone: "Asia/Shanghai",
                    })}{" "}
                    · 北京时间
                  </small>
                </div>
              </div>
            ))}
            {["append_document", "replace_paragraph"].includes(
              proposal.type,
            ) && (
              <p>
                {proposal.type === "append_document"
                  ? `追加到《${proposal.documentId === "notes" ? "团队随手记" : "CoSpace 1.0 发布方案"}》末尾。`
                  : "替换所选段落，其他段落保持原样。"}
                应用前会检查文档是否发生变化。
              </p>
            )}
            {status === "ready" && (
              <button
                className="primary apply-button"
                disabled={readonly}
                onClick={async () => {
                  setStatus("applying");
                  setError("");
                  try {
                    await api("/runs/" + id + "/apply", { method: "POST" });
                    setStatus("applied");
                    onApplied(mode);
                  } catch (e) {
                    setStatus("ready");
                    setError((e as Error).message);
                  }
                }}
              >
                <Check size={15} />
                确认应用
              </button>
            )}
            {status === "applying" && (
              <div className="ai-progress">
                <LoaderCircle className="spinning" size={16} />
                正在写入工作区…
              </div>
            )}
            {status === "applied" && (
              <>
                <div className="applied-status">
                  <Check size={16} />
                  已应用到工作区
                </div>
                <button
                  className="text-button"
                  disabled={readonly}
                  onClick={async () => {
                    setError("");
                    try {
                      await api("/runs/" + id + "/undo", { method: "POST" });
                      setStatus("undone");
                      onApplied(mode);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <RotateCcw size={14} />
                  撤销本次修改
                </button>
              </>
            )}
            {status === "undone" && (
              <div className="applied-status">本次修改已撤销</div>
            )}
            {status === "ready" && (
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await api("/runs/" + id + "/reject", { method: "POST" });
                    setStatus("rejected");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                放弃本条建议
              </button>
            )}
            {status === "rejected" && (
              <div className="applied-status">已放弃，工作区未修改</div>
            )}
          </section>
        )}
        {sources.length > 0 && (
          <details className="ai-sources">
            <summary>{sources.length} 个上下文来源</summary>
            {sources.map((s, i) => (
              <div key={s.id}>
                <strong>
                  [{i + 1}]{" "}
                  {s.id === "launch"
                    ? "发布方案"
                    : s.id === "notes"
                      ? "团队随手记"
                      : mode === "schedule"
                        ? "任务快照"
                        : "团队消息"}
                </strong>
                <p>{s.text}</p>
              </div>
            ))}
          </details>
        )}
        <button
          className="history-button"
          onClick={async () => {
            try {
              setHistory(await api("/runs"));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <History size={15} />
          查看我的运行记录
          <ChevronRight size={14} />
        </button>
        {history && (
          <div className="run-history">
            {history.length === 0 && <p>还没有运行记录。</p>}
            {history.map((run) => (
              <button
                key={run.id}
                onClick={() => {
                  setId(run.id);
                  setMode(run.mode);
                  setOutput(run.output);
                  setProposal(run.proposal);
                  setStatus(run.status);
                  setSources(run.sources);
                  setError(run.error || "");
                  setHistory(null);
                }}
              >
                <span>
                  {modes[run.mode as keyof typeof modes]}
                  <small>
                    {new Date(run.created_at).toLocaleTimeString("zh-CN")}
                  </small>
                </span>
                <span>
                  {{
                    ready: "待确认",
                    applied: "已应用",
                    failed: "失败",
                    cancelled: "已停止",
                    running: "生成中",
                    undone: "已撤销",
                    rejected: "已放弃",
                  }[run.status] || run.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <footer>
        <span className="green-dot" />
        真实模型输出 · 请核对事实与操作范围
      </footer>
    </aside>
  );
}
