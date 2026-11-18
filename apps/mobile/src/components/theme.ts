import type { TaskStatus } from "@contracts";

export const colors = {
  canvas: "#f5f7f2",
  paper: "#ffffff",
  ink: "#1e2e26",
  muted: "#596860",
  primary: "#28644f",
  primaryDark: "#1c4e3b",
  greenWash: "#e9f2eb",
  line: "#dfe7df",
  blueWash: "#e8f0f6",
  blue: "#34566d",
  brown: "#674b1b",
  amberWash: "#fbf1dc",
  red: "#9d403a",
  redWash: "#fbefed",
};

export const statusLabels: Record<TaskStatus, string> = {
  todo: "待办",
  doing: "进行中",
  done: "已完成",
};

const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
});
const fullDateFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" });
const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function shortDate(value?: string | null, includeYear = false) {
  const date = new Date(value ?? "");
  return Number.isNaN(date.getTime())
    ? null
    : (includeYear ? fullDateFormat : dateFormat).format(date);
}

export function shortTime(value: number) {
  return timeFormat.format(new Date(value));
}
