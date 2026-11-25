"use client";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { useMemo, useRef, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Sparkles, ArrowDownUp, X } from "lucide-react";
import type { Workspace, Task } from "@/lib/types";
import { api } from "@/lib/api";
const statuses = { todo: "待开始", doing: "进行中", done: "已完成" };
const priorities = { high: "高优先", medium: "中优先", low: "低优先" };
export default function Tasks({
  data,
  readonly,
  update,
  onAi,
}: {
  data: Workspace;
  readonly: boolean;
  update: (task: Task, patch: Partial<Task>) => Promise<void>;
  onAi: () => void;
}) {
  const client = useQueryClient();
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const pending = useRef<{ title: string; clientId: string }[] | null>(null);
  useDialogFocus(creating, () => setCreating(false));
  const save = (task: Task, patch: Partial<Task>) => {
    void update(task, patch).catch((e) => setError(e.message));
  };
  const columns = useMemo<ColumnDef<Task>[]>(
    () => [
      {
        accessorKey: "title",
        header: "任务名称",
        cell: ({ row }) => (
          <input
            className="task-title-input"
            aria-label={"任务名称 " + row.original.title}
            defaultValue={row.original.title}
            key={row.original.version}
            readOnly={readonly}
            onBlur={(e) => {
              if (
                e.target.value.trim() &&
                e.target.value !== row.original.title
              )
                save(row.original, { title: e.target.value.trim() });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        ),
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => (
          <select
            className={"status-select " + row.original.status}
            aria-label={"任务状态 " + row.original.title}
            disabled={readonly}
            value={row.original.status}
            onChange={(e) =>
              save(row.original, { status: e.target.value as Task["status"] })
            }
          >
            {Object.entries(statuses).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        ),
      },
      {
        accessorKey: "assignee",
        header: "负责人",
        cell: ({ row }) => (
          <select
            aria-label={"负责人 " + row.original.title}
            disabled={readonly}
            value={row.original.assignee ?? ""}
            onChange={(e) =>
              save(row.original, { assignee: e.target.value || null })
            }
          >
            {data.mode === "pilot" && <option value="">未分配</option>}
            {row.original.assignee &&
              !data.members.some((m) => m.id === row.original.assignee) && (
                <option value={row.original.assignee}>已离开工作区</option>
              )}
            {data.members
              .filter((m) => m.role !== "viewer")
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        ),
      },
      {
        accessorKey: "priority",
        header: "优先级",
        cell: ({ row }) => (
          <select
            className={"priority " + row.original.priority}
            aria-label={"优先级 " + row.original.title}
            disabled={readonly}
            value={row.original.priority}
            onChange={(e) =>
              save(row.original, {
                priority: e.target.value as Task["priority"],
              })
            }
          >
            {Object.entries(priorities).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        ),
      },
      {
        accessorKey: "due_at",
        header: "截止日期",
        cell: ({ row }) => (
          <input
            type="date"
            aria-label={"截止日期 " + row.original.title}
            disabled={readonly}
            value={row.original.due_at?.slice(0, 10) || ""}
            onChange={(e) =>
              save(row.original, {
                due_at: e.target.value
                  ? e.target.value + "T18:00:00+08:00"
                  : null,
              })
            }
          />
        ),
      },
      {
        accessorKey: "start_at",
        header: "安排时段",
        cell: ({ row }) => (
          <span className="schedule-cell">
            {row.original.start_at
              ? new Date(row.original.start_at).toLocaleString("zh-CN", {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Asia/Shanghai",
                })
              : "尚未排期"}
          </span>
        ),
      },
    ],
    [data.members, readonly, update],
  );
  const table = useReactTable({
    data: data.tasks,
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    globalFilterFn: (row, _columnId, value) => {
      const task = row.original;
      return [
        task.title,
        statuses[task.status],
        task.status,
        task.assignee,
        data.members.find((m) => m.id === task.assignee)?.name,
        priorities[task.priority],
      ]
        .join(" ")
        .toLowerCase()
        .includes(String(value).toLowerCase());
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const rows = table.getRowModel().rows;
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 54,
    overscan: 8,
  });
  async function add() {
    const lines = title
      .split("\n")
      .map((x) => x.split("\t")[0].trim())
      .filter(Boolean);
    if (!lines.length) return;
    if (lines.length > 50) {
      setError("一次最多创建 50 项，请分批粘贴。");
      return;
    }
    const queue =
      pending.current ||
      lines.map((title) => ({ title, clientId: crypto.randomUUID() }));
    pending.current = queue;
    setBusy(true);
    setError("");
    let done = 0;
    try {
      for (const item of queue) {
        await api("/tasks", {
          method: "POST",
          workspaceId: data.mode === "pilot" ? data.workspace.id : undefined,
          body: JSON.stringify({
            ...item,
            assignee: data.user.id === "guest" ? "lin" : data.user.id,
          }),
        });
        done++;
      }
      setTitle("");
      setCreating(false);
      pending.current = null;
    } catch (e) {
      pending.current = queue.slice(done);
      setTitle(pending.current.map((t) => t.title).join("\n"));
      setError(`已创建 ${done} 项。${(e as Error).message}`);
    } finally {
      setBusy(false);
      await client.invalidateQueries({ queryKey: ["workspace"] });
    }
  }
  return (
    <section className="tasks-view">
      <div className="section-toolbar">
        <div>
          <strong>团队行动项</strong>
          <span className="muted">{data.tasks.length} 个任务</span>
        </div>
        <div>
          <button className="text-button" disabled={readonly} onClick={onAi}>
            <Sparkles size={14} />
            从文档提取
          </button>
          <button
            className="primary"
            disabled={readonly}
            onClick={() => setCreating(true)}
          >
            <Plus size={15} />
            新建任务
          </button>
        </div>
      </div>
      <div className="task-controls">
        <label>
          <Search size={15} />
          <input
            aria-label="筛选任务"
            placeholder="搜索任务、状态或负责人…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <span>点击名称编辑 · 按 Tab 切换单元格</span>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <div className="task-table-scroll" ref={scroll}>
        <div role="table" aria-label="任务表格" aria-rowcount={rows.length + 1}>
          <div role="rowgroup" className="task-table-head">
            {table.getHeaderGroups().map((hg) => (
              <div role="row" className="task-row" key={hg.id}>
                {hg.headers.map((h) => (
                  <div role="columnheader" key={h.id}>
                    <button onClick={h.column.getToggleSortingHandler()}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      <ArrowDownUp size={11} />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div
            role="rowgroup"
            style={{ height: virtual.getTotalSize(), position: "relative" }}
          >
            {virtual.getVirtualItems().map((v) => {
              const row = rows[v.index];
              return (
                <div
                  role="row"
                  className={
                    "task-row " +
                    (row.original.status === "done" ? "completed" : "")
                  }
                  key={row.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: v.size,
                    transform: `translateY(${v.start}px)`,
                  }}
                >
                  {row.getVisibleCells().map((c) => (
                    <div role="cell" key={c.id}>
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
        {rows.length === 0 && <div className="empty-state">没有匹配的任务</div>}
      </div>
      <div className="table-footer">
        <span>{rows.length} 个行动项 · 数据与日历共享</span>
        <span>更改自动保存</span>
      </div>
      {creating && (
        <div className="modal-backdrop">
          <form
            className="task-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="新建任务"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <div>
              <h3>新建行动项</h3>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭新建任务"
                onClick={() => setCreating(false)}
              >
                <X size={18} />
              </button>
            </div>
            <p>每行一个任务，也可以从表格粘贴多行内容。</p>
            <textarea
              data-dialog-autofocus
              aria-label="任务内容"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                pending.current = null;
              }}
              placeholder="例如：完成发布页面的移动端走查"
              rows={5}
            />
            <button className="primary" disabled={busy || !title.trim()}>
              {busy ? "正在创建…" : "创建任务"}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
