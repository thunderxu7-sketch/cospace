import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { colors } from "@/components/theme";
import { WorkspaceQueries } from "@/core/queries";
import { SessionProvider, useSession } from "@/core/session";

export default function RootLayout() {
  return (
    <SessionProvider>
      <WorkspaceQueries>
        <StatusBar style="dark" />
        <Routes />
      </WorkspaceQueries>
    </SessionProvider>
  );
}

function Routes() {
  const { account } = useSession();
  return (
    <Stack
      initialRouteName="index"
      screenOptions={{
        headerStyle: { backgroundColor: colors.canvas },
        contentStyle: { backgroundColor: colors.canvas },
        headerShadowVisible: false,
        headerTintColor: colors.ink,
        headerTitleStyle: { fontWeight: "700" },
        headerBackTitle: "返回",
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Protected guard={!account}>
        <Stack.Screen name="connect" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!!account}>
        <Stack.Screen name="(workspace)" options={{ headerShown: false }} />
        <Stack.Screen name="review/[id]" options={{ title: "行动项建议" }} />
        <Stack.Screen name="task/[id]" options={{ title: "任务详情" }} />
        <Stack.Screen name="account" options={{ title: "工作区" }} />
      </Stack.Protected>
    </Stack>
  );
}
