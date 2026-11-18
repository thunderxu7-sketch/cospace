import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import { type ReactNode, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  type ListRenderItem,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useConnected, type useFeed, useIdentity } from "@/core/queries";
import { friendlyError } from "@/core/transport";
import { colors } from "./theme";
import {
  Avatar,
  Brand,
  Button,
  ConnectionNotice,
  layout,
  Notice,
  ScreenState,
} from "./ui";

export function WorkspaceHeader({
  title,
  message,
}: {
  title: string;
  message?: string;
}) {
  const { user } = useIdentity();
  const router = useRouter();
  return (
    <View style={styles.header}>
      <View style={styles.brandRow}>
        <Brand />
        {user && (
          <Pressable
            testID="workspace-account"
            accessibilityRole="button"
            accessibilityLabel={`工作区账号，${user.name}`}
            onPress={() => router.push("/account")}
            hitSlop={5}
          >
            <Avatar user={user} />
          </Pressable>
        )}
      </View>
      <Text accessibilityRole="header" style={layout.heading}>
        {title}
      </Text>
      {message && <Text style={layout.bodyText}>{message}</Text>}
    </View>
  );
}

export function FeedList<Item extends { id: string }>({
  feed,
  renderItem,
  header,
  emptyTitle,
  emptyMessage,
}: {
  feed: ReturnType<typeof useFeed<Item>>;
  renderItem: ListRenderItem<Item>;
  header: ReactNode;
  emptyTitle: string;
  emptyMessage?: string;
}) {
  const connected = useConnected();
  const [refreshing, setRefreshing] = useState(false);
  const hasRows = feed.items.length > 0;

  async function refresh() {
    if (!connected) return;
    setRefreshing(true);
    try {
      await feed.refetch({ cancelRefetch: false });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <FlatList
      data={feed.items}
      style={layout.wide}
      contentContainerStyle={styles.list}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      ItemSeparatorComponent={Separator}
      initialNumToRender={10}
      maxToRenderPerBatch={10}
      windowSize={7}
      onEndReachedThreshold={0.45}
      onEndReached={() => {
        if (
          connected &&
          feed.hasNextPage &&
          !feed.isFetching &&
          !feed.isFetchNextPageError
        ) {
          void feed.fetchNextPage({ cancelRefetch: false });
        }
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          colors={[colors.primary]}
          tintColor={colors.primary}
        />
      }
      ListHeaderComponent={
        <View style={styles.listHeader}>
          {header}
          <ConnectionNotice
            connected={connected}
            updatedAt={feed.dataUpdatedAt}
          />
          {connected &&
            hasRows &&
            feed.isRefetchError &&
            !feed.isFetchNextPageError && (
              <Notice
                title="更新失败"
                message="正在显示已加载记录，下拉可重试。"
              />
            )}
        </View>
      }
      ListEmptyComponent={
        feed.isPending && connected ? (
          <ScreenState loading title="正在加载…" />
        ) : connected && feed.isError ? (
          <ScreenState
            icon="alert-circle"
            title="暂时载入失败"
            message={friendlyError(feed.error)}
            action={
              <Button
                label="重试"
                tone="outline"
                onPress={() => void refresh()}
              />
            }
          />
        ) : !connected && !feed.data ? null : (
          <ScreenState icon="inbox" title={emptyTitle} message={emptyMessage} />
        )
      }
      ListFooterComponent={
        feed.isFetchingNextPage ? (
          <ActivityIndicator style={styles.footer} color={colors.primary} />
        ) : connected && feed.isFetchNextPageError ? (
          <View style={styles.footer}>
            <Button
              label="重新加载更多"
              tone="outline"
              onPress={() => void feed.fetchNextPage({ cancelRefetch: false })}
            />
          </View>
        ) : null
      }
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

export function PendingReviewLink({
  id,
  onPress,
}: {
  id: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      testID={`pending-review-${id}`}
      onPress={onPress}
      style={styles.pendingLink}
    >
      <Feather name="refresh-cw" size={17} color={colors.brown} />
      <Text style={styles.pendingLinkText}>查看待核对的操作</Text>
      <Feather name="chevron-right" size={17} color={colors.brown} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { gap: 7 },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 13,
  },
  list: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 22,
    paddingTop: 14,
  },
  listHeader: { gap: 13, marginBottom: 16 },
  separator: { height: 9 },
  footer: { marginTop: 14 },
  pendingLink: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.amberWash,
    borderRadius: 12,
    padding: 11,
  },
  pendingLinkText: {
    flex: 1,
    color: colors.brown,
    fontSize: 14,
    fontWeight: "700",
  },
});
