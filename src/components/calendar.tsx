"use client";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import zhLocale from "@fullcalendar/core/locales/zh-cn";
import { Sparkles, CalendarDays, X } from "lucide-react";
import { useState } from "react";
import type { Workspace, Task } from "@/lib/types";
export default function Calendar({
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
  const [selected, setSelected] = useState<Task | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useDialogFocus(!!selected, () => setSelected(null));
  // ISO inputs display Asia/Shanghai explicitly; do not conflate deadline with scheduled time.
  const inputTime = (s: string) =>
    new Date(Date.parse(s) + 8 * 3600000).toISOString().slice(0, 16);
  const scheduled = data.tasks.filter((t) => t.start_at && t.end_at);
  const conflicts: Task[] = [];
  for (const t of scheduled)
    if (
      scheduled.some(
        (o) =>
          o.id !== t.id &&
          o.assignee === t.assignee &&
          Date.parse(o.start_at!) < Date.parse(t.end_at!) &&
          Date.parse(t.start_at!) < Date.parse(o.end_at!),
      )
    )
      conflicts.push(t);
  async function move(info: any) {
    const task = data.tasks.find((t) => t.id === info.event.id)!;
    try {
      await update(task, {
        start_at: info.event.start.toISOString(),
        end_at: info.event.end.toISOString(),
      });
    } catch (e) {
      info.revert();
      setError((e as Error).message);
    }
  }
  function choose(task: Task, date?: Date) {
    setSelected(task);
    setStart(
      date
        ? inputTime(date.toISOString())
        : task.start_at
          ? inputTime(task.start_at)
          : "2026-11-23T09:00",
    );
    setEnd(
      date
        ? inputTime(new Date(date.getTime() + 3600000).toISOString())
        : task.end_at
          ? inputTime(task.end_at)
          : "2026-11-23T10:00",
    );
    setError("");
  }
  return (
    <div className="calendar-view">
      <div className="section-toolbar">
        <div>
          <CalendarDays size={17} />
          <strong>团队日程</strong>
          <span className="muted">显示时区：浏览器本地</span>
        </div>
        <button className="text-button" disabled={readonly} onClick={onAi}>
          <Sparkles size={14} />
          生成发布排期
        </button>
      </div>
      {conflicts.length > 0 && (
        <div className="conflict-banner">
          <span>{conflicts.length} 个任务存在同一成员的时间重叠</span>
          <button onClick={onAi}>生成调整建议</button>
        </div>
      )}
      {error && (
        <div role="alert" className="inline-error">
          {error}
        </div>
      )}
      <div className="calendar-body">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          locale={zhLocale}
          initialView="timeGridWeek"
          initialDate="2026-11-17"
          firstDay={1}
          height="100%"
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek",
          }}
          slotMinTime="08:00:00"
          slotMaxTime="20:00:00"
          allDaySlot={false}
          editable={!readonly}
          eventDurationEditable={!readonly}
          events={scheduled.map((t) => ({
            id: t.id,
            title: t.title,
            start: t.start_at!,
            end: t.end_at!,
            backgroundColor: data.members.find((m) => m.id === t.assignee)
              ?.color,
            borderColor: "transparent",
          }))}
          eventDrop={move}
          eventResize={move}
          eventClick={(info) =>
            choose(data.tasks.find((t) => t.id === info.event.id)!)
          }
          dateClick={(info) => {
            const task = data.tasks.find(
              (t) => !t.start_at && t.status !== "done",
            );
            if (!readonly && task) choose(task, info.date);
          }}
        />
      </div>
      <div className="unscheduled">
        <strong>待安排</strong>
        {data.tasks
          .filter((t) => !t.start_at && t.status !== "done")
          .map((t) => (
            <button disabled={readonly} key={t.id} onClick={() => choose(t)}>
              {t.title}
              <span>安排时间 ↗</span>
            </button>
          ))}
      </div>
      {selected && (
        <div className="modal-backdrop">
          <form
            className="task-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="安排任务"
            onSubmit={async (e) => {
              e.preventDefault();
              setSaving(true);
              try {
                await update(selected, {
                  start_at: new Date(start + ":00+08:00").toISOString(),
                  end_at: new Date(end + ":00+08:00").toISOString(),
                });
                setSelected(null);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            <div>
              <h3>安排任务</h3>
              <button
                type="button"
                className="icon-button"
                aria-label="关闭安排任务"
                onClick={() => setSelected(null)}
              >
                <X size={18} />
              </button>
            </div>
            <p>{selected.title}</p>
            <label>
              开始时间 · 北京时间
              <input
                type="datetime-local"
                aria-label="开始时间"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
                disabled={readonly}
              />
            </label>
            <label>
              结束时间 · 北京时间
              <input
                type="datetime-local"
                aria-label="结束时间"
                value={end}
                min={start}
                onChange={(e) => setEnd(e.target.value)}
                required
                disabled={readonly}
              />
            </label>
            <small>仅修改安排时段，任务截止日期保持不变。</small>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <button className="primary" disabled={saving || readonly}>
              {saving ? "正在保存…" : "保存排期"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
