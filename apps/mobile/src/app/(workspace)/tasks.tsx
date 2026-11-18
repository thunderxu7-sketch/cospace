import type { Task } from "@contracts";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  type ListRenderItem,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FeedList, WorkspaceHeader } from "@/components/feed";
import { colors, shortDate } from "@/components/theme";
import { layout, RowCard, StatusPill } from "@/components/ui";
import { taskKeys, useFeed, useIdentity } from "@/core/queries";
import { measureFirstTaskLayout } from "@/core/task-measurement";

const filters = [
  { id: "me", label: "我的", testID: "my-tasks" },
  { id: "all", label: "全部", testID: "all-tasks" },
] as const;
type Filter = (typeof filters)[number]["id"];

export default function TasksScreen() {
  const [filter, setFilter] = useState<Filter>("me");
  const router = useRouter();
  const { members } = useIdentity();
  const feed = useFeed<Task>({
    route: `/tasks?assignee=${filter}`,
    queryKey: [...taskKeys.list, filter],
  });
  const renderTask: ListRenderItem<Task> = useCallback(
    ({ item, index }) => {
      const name =
        members.find((member) => member.id === item.assignee)?.name ?? "未分配";
      const dueOn = shortDate(item.due_at);
      return (
        <View onLayout={index === 0 ? measureFirstTaskLayout : undefined}>
          <RowCard
            title={item.title}
            description={`${name} · ${dueOn ? `${dueOn} 截止` : "无截止日期"}`}
            icon={item.status === "done" ? "check-circle" : "check-square"}
            trailing={<StatusPill status={item.status} />}
            testID={`task-${item.id}`}
            onPress={() =>
              router.push({ pathname: "/task/[id]", params: { id: item.id } })
            }
          />
        </View>
      );
    },
    [members, router],
  );

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={layout.screen}>
      <FeedList
        feed={feed}
        renderItem={renderTask}
        header={
          <>
            <WorkspaceHeader title="任务" />
            <View style={styles.filters}>
              {filters.map(({ id, label, testID }) => (
                <Pressable
                  key={id}
                  testID={testID}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: filter === id }}
                  onPress={() => setFilter(id)}
                  style={[styles.filter, filter === id && styles.selected]}
                >
                  <Text
                    style={[
                      styles.filterLabel,
                      filter === id && styles.selectedText,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        }
        emptyTitle={filter === "me" ? "暂无分给你的任务" : "工作区暂无任务"}
        emptyMessage={
          filter === "me" ? "切换到「全部」可查看团队任务。" : undefined
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  filters: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: 14,
    backgroundColor: colors.greenWash,
  },
  filter: {
    flex: 1,
    minHeight: 43,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  filterLabel: { color: colors.muted, fontWeight: "600", fontSize: 14 },
  selected: { backgroundColor: colors.paper },
  selectedText: { color: colors.primaryDark, fontWeight: "700" },
});
