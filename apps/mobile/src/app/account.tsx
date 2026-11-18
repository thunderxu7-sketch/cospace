import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar, Button, layout } from "@/components/ui";
import { useIdentity } from "@/core/queries";
import { useSession } from "@/core/session";

export default function AccountScreen() {
  const { user } = useIdentity();
  const { disconnect } = useSession();
  const [working, setWorking] = useState(false);
  if (!user) return null;

  async function leave() {
    setWorking(true);
    try {
      await disconnect();
    } finally {
      setWorking(false);
    }
  }

  return (
    <SafeAreaView edges={["bottom", "left", "right"]} style={layout.screen}>
      <ScrollView contentContainerStyle={[layout.wide, layout.body]}>
        <View style={[layout.card, styles.identity]}>
          <Avatar user={user} large />
          <View style={styles.person}>
            <Text accessibilityRole="header" style={layout.section}>
              {user.name}
            </Text>
            <Text style={layout.bodyText}>
              {user.role === "editor" ? "编辑者" : "观察者"}
            </Text>
          </View>
        </View>
        <Button
          label="断开此手机"
          icon="log-out"
          testID="disconnect-button"
          tone="danger"
          busy={working}
          onPress={() => void leave()}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: "row", alignItems: "center", gap: 15 },
  person: { flex: 1, gap: 4 },
});
