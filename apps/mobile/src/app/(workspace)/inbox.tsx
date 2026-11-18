import type { MobileReviewSummary } from "@contracts";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import type { ListRenderItem } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  FeedList,
  PendingReviewLink,
  WorkspaceHeader,
} from "@/components/feed";
import { shortDate } from "@/components/theme";
import { layout, RowCard } from "@/components/ui";
import { reviewKeys, useFeed } from "@/core/queries";
import { useSession } from "@/core/session";

export default function InboxScreen() {
  const feed = useFeed<MobileReviewSummary>({
    route: "/mobile/reviews",
    queryKey: reviewKeys.list,
    pollInterval: 15_000,
  });
  const router = useRouter();
  const { account } = useSession();
  const pending = account?.pendingReview;

  const openReview = useCallback(
    (id: string) => router.push({ pathname: "/review/[id]", params: { id } }),
    [router],
  );
  const renderReview: ListRenderItem<MobileReviewSummary> = useCallback(
    ({ item }) => (
      <RowCard
        title={item.documentTitle ?? "文档行动项"}
        description={`${item.taskCount} 项拟建任务${shortDate(item.createdAt) ? ` · ${shortDate(item.createdAt)}` : ""}`}
        icon="file-text"
        testID={`review-${item.id}`}
        onPress={() => openReview(item.id)}
      />
    ),
    [openReview],
  );

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={layout.screen}>
      <FeedList
        feed={feed}
        renderItem={renderReview}
        header={
          <>
            <WorkspaceHeader
              title="待确认"
              message="核对网页版生成的行动项，确认后同步到团队任务。"
            />
            {pending && (
              <PendingReviewLink
                id={pending.id}
                onPress={() => openReview(pending.id)}
              />
            )}
          </>
        }
        emptyTitle="暂无待确认的建议"
        emptyMessage="从网页版文档提取行动项，新建议会出现在这里。"
      />
    </SafeAreaView>
  );
}
