"use client";
import { useState, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  Reply,
  X,
  Sparkles,
  Hash,
  CheckCheck,
  FileText,
  CornerDownRight,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Workspace, Message } from "@/lib/types";
import { Avatar } from "./workspace";
export default function Chat({
  data,
  readonly,
  onAi,
  onDocument,
}: {
  data: Workspace;
  readonly: boolean;
  onAi: () => void;
  onDocument: () => void;
}) {
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [reply, setReply] = useState<Message | null>(null);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<{
    body: string;
    clientId: string;
    replyTo: string | null;
  } | null>(null);
  const [error, setError] = useState("");
  const [older, setOlder] = useState<Message[]>([]);
  const scroll = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [pending, setPending] = useState<{
    body: string;
    clientId: string;
    replyTo: string | null;
  } | null>(null);
  const [hasOlder, setHasOlder] = useState(data.messages.length >= 100);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const messages = [
    ...older.filter((m) => !data.messages.some((n) => n.id === m.id)),
    ...data.messages,
  ];
  const delivery = pending || failed;
  const visibleMessages: (Message & { delivery?: string })[] =
    delivery && !messages.some((m) => m.client_id === delivery.clientId)
      ? [
          ...messages,
          {
            id: "pending:" + delivery.clientId,
            client_id: delivery.clientId,
            body: delivery.body,
            reply_to: delivery.replyTo,
            user_id: data.user.id,
            created_at: new Date().toISOString(),
            delivery: pending ? "发送中" : "发送失败",
          },
        ]
      : messages;
  const virtual = useVirtualizer({
    count: visibleMessages.length + 1,
    getScrollElement: () => scroll.current,
    getItemKey: (index) =>
      index === 0 ? "intro" : visibleMessages[index - 1].id,
    estimateSize: (index) => (index === 0 ? 190 : 100),
    overscan: 6,
  });
  useEffect(() => {
    if (stickToBottom.current)
      virtual.scrollToIndex(visibleMessages.length, { align: "end" });
  }, [visibleMessages.length, data.messages.at(-1)?.id]);
  async function send(retry = false) {
    const body =
      failed &&
      (retry ||
        (failed.body === text.trim() && failed.replyTo === (reply?.id || null)))
        ? failed
        : {
            body: text.trim(),
            clientId: crypto.randomUUID(),
            replyTo: reply?.id || null,
          };
    if (!body.body || sending) return;
    stickToBottom.current = true;
    setPending(body);
    setSending(true);
    setError("");
    try {
      await api("/messages", { method: "POST", body: JSON.stringify(body) });
      setText((current) => (current.trim() === body.body ? "" : current));
      setReply(null);
      setFailed(null);
      await client.invalidateQueries({ queryKey: ["workspace"] });
    } catch (e) {
      setFailed(body);
      setError((e as Error).message);
    } finally {
      setPending(null);
      setSending(false);
    }
  }
  return (
    <div className="chat-layout">
      <section className="conversation">
        <div className="section-toolbar">
          <div>
            <Hash size={19} />
            <strong>发布讨论</strong>
            <span className="muted">把想法聊清楚</span>
          </div>
          <button className="text-button" onClick={onAi}>
            <Sparkles size={14} />
            整理讨论
          </button>
        </div>
        <div
          className="messages"
          aria-label="团队消息"
          ref={scroll}
          onScroll={(e) => {
            const node = e.currentTarget;
            stickToBottom.current =
              node.scrollHeight - node.scrollTop - node.clientHeight < 120;
          }}
        >
          <div
            style={{
              height: virtual.getTotalSize(),
              width: "100%",
              position: "relative",
            }}
          >
            {virtual.getVirtualItems().map((item) => {
              const m = visibleMessages[item.index - 1];
              const member = m
                ? data.members.find((u) => u.id === m.user_id)!
                : null;
              const parent = m
                ? messages.find((x) => x.id === m.reply_to)
                : null;
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtual.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${item.start}px)`,
                    paddingBottom: item.index ? 20 : 0,
                  }}
                >
                  {item.index === 0 ? (
                    <>
                      <div className="channel-intro">
                        <div className="channel-symbol">
                          <MessageSymbol />
                        </div>
                        <h2>从一个好问题开始</h2>
                        <p>
                          这里是团队的讨论空间。分享进展、提出问题，一起找到下一步。
                        </p>
                      </div>
                      <div className="date-divider">
                        <span>2026 年 11 月 · 产品发布</span>
                      </div>
                      {hasOlder && (
                        <button
                          className="text-button"
                          disabled={loadingOlder}
                          onClick={async () => {
                            setLoadingOlder(true);
                            try {
                              const rows = await api<Message[]>(
                                "/messages?before=" +
                                  encodeURIComponent(messages[0].created_at),
                              );
                              setOlder((old) => [...rows, ...old]);
                              setHasOlder(rows.length === 100);
                              stickToBottom.current = false;
                              requestAnimationFrame(() =>
                                virtual.scrollToIndex(rows.length + 1, {
                                  align: "start",
                                }),
                              );
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setLoadingOlder(false);
                            }
                          }}
                        >
                          {loadingOlder ? "正在加载…" : "加载更早的消息"}
                        </button>
                      )}
                    </>
                  ) : (
                    <article className="message" style={{ marginBottom: 0 }}>
                      <Avatar name={member!.name} color={member!.color} />
                      <div className="message-main">
                        <div className="message-meta">
                          <strong>{member!.name}</strong>
                          {member!.id === data.user.id && (
                            <span className="you-badge">你</span>
                          )}
                          <time>
                            {new Date(m.created_at).toLocaleTimeString(
                              "zh-CN",
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                                timeZone: "Asia/Shanghai",
                              },
                            )}
                          </time>
                        </div>
                        {m.reply_to && (
                          <div className="quoted">
                            <CornerDownRight size={13} />
                            {parent?.body.slice(0, 80) || "回复较早的消息"}
                          </div>
                        )}
                        <p>{m.body}</p>
                        {m.delivery ? (
                          <small role="status">{m.delivery}</small>
                        ) : (
                          <button
                            className="reply-button"
                            disabled={readonly}
                            aria-label={"回复 " + member!.name + " 的消息"}
                            onClick={() => setReply(m)}
                          >
                            <Reply size={14} />
                            回复
                          </button>
                        )}
                      </div>
                    </article>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="composer-wrap">
          {reply && (
            <div className="reply-preview">
              <Reply size={14} />
              <span>{reply.body.slice(0, 70)}</span>
              <button
                className="icon-button"
                aria-label="取消回复"
                onClick={() => setReply(null)}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {error && (
            <div className="inline-error" role="alert">
              {error}
              <button onClick={() => send(true)}>重试发送</button>
            </div>
          )}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              aria-label="输入消息"
              placeholder={
                readonly
                  ? "只读成员可以查看讨论"
                  : "分享进展，或用 @ 提及一位伙伴…"
              }
              disabled={readonly}
              value={text}
              maxLength={5000}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div>
              <span>
                <button
                  type="button"
                  className="mention-button"
                  disabled={readonly}
                  onClick={() => setText(text + "@陈屿 ")}
                >
                  ＠
                </button>
                <small>Enter 发送 · Shift + Enter 换行</small>
              </span>
              <button
                className="send-button"
                type="submit"
                disabled={readonly || sending || !text.trim()}
                aria-label="发送消息"
              >
                {sending ? <span className="spinner" /> : <ArrowUp size={17} />}
              </button>
            </div>
          </form>
          <div className="composer-hint">
            <CheckCheck size={13} />
            消息保存在工作区，成员之间实时同步
          </div>
        </div>
      </section>
      <aside className="context-sidebar">
        <span className="eyebrow">PROJECT CONTEXT</span>
        <h3>这一次，我们一起完成</h3>
        <p>把协作文档、任务安排与 AI 操作连接成完整的产品体验。</p>
        <div className="context-line" />
        <h4>当前里程碑</h4>
        <div className="milestone">
          <span className="milestone-dot" />
          <div>
            <strong>1.0 产品体验发布</strong>
            <small>2026.11.27 · 团队协作</small>
          </div>
        </div>
        <h4>关联文档</h4>
        <a
          className="document-card"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onDocument();
          }}
        >
          <span>
            <FileText size={19} />
          </span>
          <strong>
            CoSpace 1.0 发布方案<small>目标、范围与验收标准</small>
          </strong>
        </a>
        <div className="ai-invitation">
          <Sparkles size={20} />
          <h4>让讨论有下一步</h4>
          <p>整理大家的想法，形成带消息来源的纪要，确认后加入方案。</p>
          <button onClick={onAi}>
            试试整理讨论 <ArrowUp size={14} />
          </button>
        </div>
      </aside>
    </div>
  );
}
function MessageSymbol() {
  return <Hash size={24} />;
}
