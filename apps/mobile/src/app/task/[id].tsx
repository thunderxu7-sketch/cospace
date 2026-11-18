import type { Task, TaskStatus } from "@contracts";
import Feather from "@expo/vector-icons/Feather";
import { useIsFocused } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, shortDate, statusLabels } from "@/components/theme";
import {
  Button,
  ConnectionNotice,
  layout,
  Notice,
  ScreenState,
  StatusPill,
} from "@/components/ui";
import {
  isUncertain,
  taskKeys,
  useConnected,
  useForeground,
  useIdentity,
  useRefreshOnFocus,
} from "@/core/queries";
import { useSession } from "@/core/session";
import { ApiError, friendlyError } from "@/core/transport";

type Draft = { status: TaskStatus; version: number };
type Resolution = {
  title: string;
  message?: string;
  tone: "success" | "warning" | "danger";
};
const statuses = Object.keys(statusLabels) as TaskStatus[];

function currentTask(value: unknown, id: string): Task | undefined {
  if (
    value &&
    typeof value === "object" &&
    "id" in value &&
    value.id === id &&
    "version" in value &&
    typeof value.version === "number" &&
    "title" in value &&
    typeof value.title === "string" &&
    "status" in value &&
    typeof value.status === "string" &&
    statuses.includes(value.status as TaskStatus)
  )
    return value as Task;
}

export default function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const client = useQueryClient();
  const { call } = useSession();
  const { user, members } = useIdentity();
  const connected = useConnected();
  const foreground = useForeground();
  const visible = useIsFocused();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [conflict, setConflict] = useState<TaskStatus | null>(null);
  const [uncertain, setUncertain] = useState<Draft | null>(null);
  const [check, setCheck] = useState(0);
  const [checkError, setCheckError] = useState("");
  const savingRef = useRef(false);

  const query = useQuery({
    queryKey: taskKeys.detail(id),
    queryFn: ({ signal }) => call<Task>(`/tasks/${id}`, { signal }),
    enabled: !!id && !uncertain && !saving,
  });
  useRefreshOnFocus(query.refetch, !uncertain && !saving);
  const task = query.data;
  const owner = members.find((member) => member.id === task?.assignee);

  useEffect(() => {
    if (!id || !uncertain || !foreground || !visible || !connected) return;
    const controller = new AbortController();
    void (async () => {
      setCheckError("");
      try {
        const latest = await call<Task>(`/tasks/${id}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        client.setQueryData(taskKeys.detail(id), latest);
        void client.invalidateQueries({ queryKey: taskKeys.list });
        setDraft(null);
        setUncertain(null);
        setResolution({
          title: "已核对任务状态",
          message: `工作区当前显示「${statusLabels[latest.status]}」。`,
          tone: latest.status === uncertain.status ? "success" : "warning",
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 404) {
          setUncertain(null);
          setResolution({ title: "这项任务已不存在", tone: "warning" });
        } else {
          setCheckError(friendlyError(error));
        }
      }
    })();
    return () => controller.abort();
  }, [call, check, client, connected, foreground, id, uncertain, visible]);

  function select(status: TaskStatus) {
    if (!task || savingRef.current || uncertain) return;
    setDraft(
      status === task.status
        ? null
        : { status, version: draft?.version ?? task.version },
    );
    setConflict(null);
    setResolution(null);
  }

  async function save() {
    if (
      !task ||
      !draft ||
      !connected ||
      savingRef.current ||
      uncertain ||
      user?.role !== "editor"
    )
      return;
    savingRef.current = true;
    setSaving(true);
    setConflict(null);
    setResolution(null);
    try {
      await client.cancelQueries({ queryKey: taskKeys.detail(id) });
      const updated = await call<Task>(`/tasks/${id}`, {
        method: "PATCH",
        body: draft,
      });
      client.setQueryData(taskKeys.detail(id), updated);
      setDraft(null);
      setResolution({ title: "任务状态已更新", tone: "success" });
      void client.invalidateQueries({ queryKey: taskKeys.list });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const latest = currentTask(error.current, id);
        if (latest) client.setQueryData(taskKeys.detail(id), latest);
        else void query.refetch();
        setDraft(null);
        setConflict(draft.status);
        void client.invalidateQueries({ queryKey: taskKeys.list });
      } else if (isUncertain(error)) {
        setCheckError("");
        setUncertain(draft);
      } else {
        setResolution({ title: friendlyError(error), tone: "danger" });
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={layout.screen}>
      <ScrollView contentContainerStyle={[layout.body, layout.wide]}>
        {!router.canGoBack() && (
          <Button
            label="返回任务"
            icon="arrow-left"
            tone="outline"
            onPress={() => router.replace("/(workspace)/tasks")}
          />
        )}
        <ConnectionNotice
          connected={connected}
          updatedAt={query.dataUpdatedAt}
        />
        {!task &&
          (query.isError ? (
            <ScreenState
              icon="alert-circle"
              title="暂时无法打开任务"
              message={friendlyError(query.error)}
              action={
                connected && (
                  <Button
                    label="重试"
                    tone="outline"
                    onPress={() => void query.refetch()}
                  />
                )
              }
            />
          ) : (
            connected && <ScreenState loading title="正在加载任务…" />
          ))}
        {task && (
          <>
            {query.isError && (
              <Notice
                title="暂时无法获取最新任务"
                message={friendlyError(query.error)}
              />
            )}
            <View style={styles.taskHeader}>
              <Text accessibilityRole="header" style={layout.heading}>
                {task.title}
              </Text>
              <StatusPill status={task.status} />
            </View>
            <View style={layout.card}>
              <TaskField
                icon="user"
                label="负责人"
                value={owner?.name ?? task.assignee}
              />
              <TaskField
                icon="calendar"
                label="截止日期"
                value={shortDate(task.due_at, true) ?? "未指定"}
              />
            </View>
            {conflict && (
              <Notice
                testID="task-conflict"
                title="另一端已更新这项任务"
                message={`当前状态是「${statusLabels[task.status]}」，你拟改为「${statusLabels[conflict]}」。请选择要保存的状态。`}
              />
            )}
            {uncertain && (
              <>
                <Notice
                  title="正在核对任务状态"
                  message={checkError || "恢复连接后读取工作区的最新状态。"}
                />
                {checkError && connected && (
                  <Button
                    label="重新核对"
                    tone="outline"
                    onPress={() => setCheck((value) => value + 1)}
                  />
                )}
              </>
            )}
            {resolution && <Notice {...resolution} />}
            {user?.role === "editor" ? (
              <View style={layout.card}>
                <Text accessibilityRole="header" style={layout.section}>
                  更新状态
                </Text>
                {statuses.map((status) => {
                  const selected = (draft?.status ?? task.status) === status;
                  return (
                    <Pressable
                      key={status}
                      testID={`task-status-${status}`}
                      accessibilityRole="radio"
                      accessibilityState={{
                        checked: selected,
                        disabled: saving || !!uncertain,
                      }}
                      disabled={saving || !!uncertain}
                      onPress={() => select(status)}
                      style={[styles.option, selected && styles.optionSelected]}
                    >
                      <Feather
                        name={selected ? "check-circle" : "circle"}
                        size={18}
                        color={colors.primary}
                      />
                      <Text style={styles.optionText}>
                        {statusLabels[status]}
                      </Text>
                    </Pressable>
                  );
                })}
                <Button
                  testID="save-task-status"
                  label="保存状态"
                  icon="check"
                  disabled={!draft || !connected || !!uncertain}
                  busy={saving}
                  onPress={() => void save()}
                />
              </View>
            ) : (
              <Notice
                title="当前账号可查看任务"
                message="如需修改状态，请用编辑者账号连接。"
              />
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function TaskField({
  icon,
  label,
  value,
}: {
  icon: "user" | "calendar";
  label: string;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Feather name={icon} color={colors.primary} size={17} />
      <Text style={layout.small}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  taskHeader: { alignItems: "flex-start", gap: 11 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    minHeight: 47,
    padding: 11,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
  },
  optionSelected: {
    backgroundColor: colors.greenWash,
    borderColor: colors.greenWash,
  },
  optionText: { color: colors.ink, fontSize: 14, fontWeight: "600" },
  field: { alignItems: "flex-start", flexDirection: "row", gap: 8 },
  fieldValue: {
    flex: 1,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "right",
  },
});
