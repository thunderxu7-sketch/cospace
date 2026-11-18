import { Redirect } from "expo-router";
import { View } from "react-native";
import { layout, ScreenState } from "@/components/ui";
import { useSession } from "@/core/session";

export default function EntryScreen() {
  const { account, restoring } = useSession();
  if (restoring) {
    return (
      <View style={[layout.screen, layout.centered]}>
        <ScreenState title="正在恢复工作区…" loading />
      </View>
    );
  }
  if (!account) return <Redirect href="/connect" />;
  if (account.pendingReview) {
    return (
      <Redirect
        href={{
          pathname: "/review/[id]",
          params: { id: account.pendingReview.id },
        }}
      />
    );
  }
  return <Redirect href="/(workspace)/inbox" />;
}
