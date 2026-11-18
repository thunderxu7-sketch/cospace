import type {
  ApplyRunResponse,
  Member,
  Operation,
  RunDetail,
  Task,
} from "@contracts";
import { useIsFocused } from "@react-navigation/native";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, shortDate } from "@/components/theme";
import {
  Button,
  ConnectionNotice,
  layout,
  Notice,
  RowCard,
  ScreenState,
  StatusPill,
} from "@/components/ui";
import {
  isUncertain,
  reviewKeys,
  taskKeys,
  useConnected,
  useForeground,
  useIdentity,
  useRefreshOnFocus,
} from "@/core/queries";
import { useSession } from "@/core/session";
import { ApiError, friendlyError } from "@/core/transport";

type ReviewAction = "apply" | "reject";

const otherStatuses: Record<string, string> = {
  rejected: "已放弃建议",
  undone: "已撤销创建",
  running: "正在生成建议",
  failed: "建议生成失败",
  cancelled: "已取消生成",
};

function taskIds(result: unknown): string[] {
  if (!result || typeof result !== "object" || !("taskIds" in result))
    return [];
  const ids = result.taskIds;
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string")
    : [];
}

export default function ReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { account, call, rememberReview, clearReview } = useSession();
  const { user, members } = useIdentity();
  const connected = useConnected();
  const foreground = useForeground();
  const visible = useIsFocused();
  const client = useQueryClient();
  const [showSource, setShowSource] = useState(false);
  const [posting, setPosting] = useState<ReviewAction | null>(null);
  const [notice, setNotice] = useState("");
  const [check, setCheck] = useState(0);
  const [checkError, setCheckError] = useState("");
  const working = useRef(false);
  const hasPending = !!id && id === account?.pendingReview?.id;
  const detail = useQuery({
    queryKey: reviewKeys.detail(id),
    queryFn: ({ signal }) => call<RunDetail>(`/runs/${id}`, { signal }),
    enabled: !!id && !hasPending && !posting,
  });
  useRefreshOnFocus(detail.refetch, !hasPending && !posting);

  useEffect(() => {
    if (!id || !hasPending || posting || !foreground || !visible || !connected)
      return;
    const controller = new AbortController();
    void (async () => {
      setCheckError("");
      try {
        const latest = await call<RunDetail>(`/runs/${id}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        client.setQueryData(reviewKeys.detail(id), latest);
        if (latest.status !== "ready") setShowSource(false);
        setNotice(
          latest.status === "ready"
            ? "工作区尚未处理这份建议，你可以重新确认或放弃。"
            : "",
        );
        await clearReview(id);
        void client.invalidateQueries({ queryKey: reviewKeys.list });
        if (latest.status === "applied") {
          void client.invalidateQueries({ queryKey: taskKeys.list });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 404) {
          await clearReview(id).catch(() => undefined);
          setNotice("这份建议已经不可用。");
        } else {
          setCheckError(friendlyError(error));
        }
      }
    })();
    return () => controller.abort();
  }, [
    call,
    check,
    clearReview,
    client,
    connected,
    foreground,
    hasPending,
    id,
    posting,
    visible,
  ]);

  const run = detail.data;
  const proposed =
    run?.proposal?.type === "create_tasks" ? (run.proposal.tasks ?? []) : [];
  const canReview =
    run?.status === "ready" &&
    proposed.length > 0 &&
    user?.role === "editor" &&
    !hasPending;
  const anotherReviewPending = !!account?.pendingReview && !hasPending;
  const error =
    detail.isError && !hasPending ? friendlyError(detail.error) : "";

  async function submit(action: ReviewAction) {
    if (
      !run ||
      !canReview ||
      !connected ||
      anotherReviewPending ||
      working.current
    )
      return;
    working.current = true;
    setPosting(action);
    setNotice("");
    setCheckError("");
    let persisted = false;
    try {
      await client.cancelQueries({ queryKey: reviewKeys.detail(id) });
      await rememberReview(id);
      persisted = true;
      const response = await call<ApplyRunResponse | { ok: true }>(
        `/runs/${id}/${action}`,
        {
          method: "POST",
        },
      );
      client.setQueryData<RunDetail>(reviewKeys.detail(id), {
        ...run,
        status: action === "apply" ? "applied" : "rejected",
        result: "result" in response ? response.result : null,
      });
      setShowSource(false);
      await clearReview(id).catch(() => undefined);
      void client.invalidateQueries({ queryKey: reviewKeys.list });
      if (action === "apply")
        void client.invalidateQueries({ queryKey: taskKeys.list });
    } catch (error) {
      if (
        persisted &&
        !isUncertain(error) &&
        !(error instanceof ApiError && error.status === 409)
      ) {
        await clearReview(id).catch(() => undefined);
      }
      setNotice(friendlyError(error));
    } finally {
      working.current = false;
      setPosting(null);
    }
  }

  const recoverPending = hasPending && !posting;
  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={layout.screen}>
      <ScrollView contentContainerStyle={[layout.body, layout.wide]}>
        {!router.canGoBack() && (
          <Button
            label="返回待确认"
            icon="arrow-left"
            tone="outline"
            onPress={() => router.replace("/(workspace)/inbox")}
          />
        )}
        <ConnectionNotice
          connected={connected}
          updatedAt={detail.dataUpdatedAt}
        />
        {posting && (
          <Notice
            testID="review-sending"
            title="正在提交…"
            message="工作区正在处理本次操作。"
          />
        )}
        {recoverPending && (
          <>
            <Notice
              testID="review-pending"
              title="正在核对结果"
              message={checkError || "联网后，从工作区查询这次操作的结果。"}
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
        {notice && !recoverPending ? <Notice title={notice} /> : null}
        {error && run && (
          <Notice title="暂时无法获取最新状态" message={error} />
        )}
        {!run &&
          !hasPending &&
          (error ? (
            <ScreenState
              icon="alert-circle"
              title="暂时无法打开建议"
              message={error}
              action={
                connected && (
                  <Button
                    label="重试"
                    tone="outline"
                    onPress={() => void detail.refetch()}
                  />
                )
              }
            />
          ) : (
            connected && <ScreenState loading title="正在加载建议…" />
          ))}
        {run && (
          <>
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={layout.heading}>
                {run.documentTitle ?? "文档行动项"}
              </Text>
              <Text style={layout.bodyText}>
                {[shortDate(run.created_at, true), `${proposed.length} 项建议`]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
            {run.sources.length > 0 && (
              <View style={layout.card}>
                <Button
                  testID="show-source"
                  label={showSource ? "收起原文快照" : "原文快照"}
                  tone="outline"
                  icon={showSource ? "chevron-up" : "file-text"}
                  onPress={() => setShowSource((value) => !value)}
                />
                {showSource &&
                  run.sources.map((source, index) => (
                    <Text
                      key={source.id}
                      testID={index === 0 ? "review-source-text" : undefined}
                      selectable
                      style={styles.source}
                    >
                      {source.text}
                    </Text>
                  ))}
              </View>
            )}
            {run.status === "applied" ? (
              <Receipt ids={taskIds(run.result)} />
            ) : (
              <>
                {otherStatuses[run.status] && (
                  <Notice title={otherStatuses[run.status]} />
                )}
                {proposed.length > 0 && (
                  <View style={layout.card}>
                    <Text accessibilityRole="header" style={layout.section}>
                      拟创建的任务
                    </Text>
                    {proposed.map((task, index) => (
                      <Proposal key={index} task={task} members={members} />
                    ))}
                  </View>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
      {canReview || posting ? (
        <View style={styles.actions}>
          <View style={[layout.wide, styles.actionButtons]}>
            <Button
              testID="apply-review"
              label={`确认创建 ${proposed.length} 项任务`}
              icon="check"
              busy={posting === "apply"}
              disabled={!connected || !!posting || anotherReviewPending}
              onPress={() => void submit("apply")}
            />
            <Button
              testID="reject-review"
              label="放弃建议"
              tone="danger"
              busy={posting === "reject"}
              disabled={!connected || !!posting || anotherReviewPending}
              onPress={() =>
                Alert.alert("放弃这份建议？", "这份建议会从待确认列表移除。", [
                  { text: "返回", style: "cancel" },
                  {
                    text: "确认放弃",
                    style: "destructive",
                    onPress: () => void submit("reject"),
                  },
                ])
              }
            />
            {anotherReviewPending && (
              <Text style={layout.small}>请先核对上一条操作的结果。</Text>
            )}
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function Proposal({
  task,
  members,
}: {
  task: NonNullable<Operation["tasks"]>[number];
  members: Member[];
}) {
  const member = members.find((person) => person.id === task.assignee);
  return (
    <View style={styles.proposal}>
      <Text style={styles.proposalTitle}>{task.title}</Text>
      <Text style={layout.small}>
        {member?.name ?? task.assignee} ·{" "}
        {shortDate(task.due_at, true) ?? "截止日期未指定"}
      </Text>
    </View>
  );
}

function Receipt({ ids }: { ids: string[] }) {
  const { call } = useSession();
  const router = useRouter();
  const tasks = useQueries({
    queries: ids.map((id) => ({
      queryKey: taskKeys.detail(id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        call<Task>(`/tasks/${id}`, { signal }),
    })),
  });
  return (
    <View style={styles.receipt} testID="review-receipt">
      <Notice
        title="已创建任务"
        message={`${ids.length} 项任务已同步到 Web 工作区。`}
        tone="success"
      />
      {ids.map((id, index) => (
        <RowCard
          key={id}
          title={tasks[index]?.data?.title ?? "查看已创建的任务"}
          description={
            tasks[index]?.data ? "查看任务详情" : "打开详情以读取最新任务"
          }
          icon="check-square"
          trailing={
            tasks[index]?.data && (
              <StatusPill status={tasks[index].data.status} />
            )
          }
          testID={`task-${id}`}
          onPress={() =>
            router.push({ pathname: "/task/[id]", params: { id } })
          }
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 8 },
  source: { color: colors.ink, fontSize: 15, lineHeight: 23, padding: 4 },
  proposal: {
    gap: 5,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 11,
    paddingBottom: 3,
  },
  proposalTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 22,
  },
  receipt: { gap: 10 },
  actions: {
    backgroundColor: colors.paper,
    borderTopColor: colors.line,
    borderTopWidth: 1,
  },
  actionButtons: { gap: 8, paddingHorizontal: 20, paddingVertical: 12 },
});
