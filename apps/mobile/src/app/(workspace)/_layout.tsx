import Feather from "@expo/vector-icons/Feather";
import { Tabs } from "expo-router";
import { colors } from "@/components/theme";
import { measureTaskTab } from "@/core/task-measurement";

export default function WorkspaceTabs() {
  return (
    <Tabs
      initialRouteName="inbox"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.paper,
          borderTopColor: colors.line,
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Tabs.Screen
        name="inbox"
        options={{
          title: "待确认",
          tabBarButtonTestID: "reviews-tab",
          tabBarIcon: ({ color, size }) => (
            <Feather name="inbox" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="tasks"
        listeners={{ tabPress: measureTaskTab }}
        options={{
          title: "任务",
          tabBarButtonTestID: "tasks-tab",
          tabBarIcon: ({ color, size }) => (
            <Feather name="check-square" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
