import Feather from "@expo/vector-icons/Feather";
import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@/components/theme";
import { Brand, Button, layout, Notice } from "@/components/ui";
import { useConnected } from "@/core/queries";
import { useSession } from "@/core/session";
import { friendlyError } from "@/core/transport";

export default function ConnectScreen() {
  const { connect, notice, restoring } = useSession();
  const connected = useConnected();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const workingRef = useRef(false);
  const cleanCode = code.toUpperCase().replace(/[\s-]/g, "");
  const canSubmit = /^[A-Z0-9]{8}$/.test(cleanCode) && connected && !restoring;

  async function submit() {
    if (!canSubmit || workingRef.current) return;
    workingRef.current = true;
    setWorking(true);
    setError("");
    try {
      await connect(cleanCode);
    } catch (error) {
      setError(friendlyError(error));
    } finally {
      workingRef.current = false;
      setWorking(false);
    }
  }

  return (
    <SafeAreaView style={layout.screen}>
      <KeyboardAvoidingView
        style={layout.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[layout.wide, styles.sheet]}>
            <Brand large />
            <View style={styles.intro}>
              <Text accessibilityRole="header" style={layout.heading}>
                连接工作区
              </Text>
              <Text style={layout.bodyText}>
                在 CoSpace 网页中打开「连接手机」，输入网页显示的 8 位配对码。
              </Text>
            </View>
            <View style={layout.card}>
              <Text style={styles.fieldLabel}>配对码</Text>
              <TextInput
                testID="pairing-code"
                accessibilityLabel="配对码"
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                editable={!working}
                maxLength={16}
                placeholder="输入配对码"
                placeholderTextColor={colors.muted}
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
                spellCheck={false}
                value={code}
                onChangeText={(value) => {
                  setCode(value);
                  setError("");
                }}
                style={styles.input}
              />
              <Button
                testID="connect-button"
                label="连接"
                icon="arrow-right"
                disabled={!canSubmit}
                busy={working}
                onPress={() => void submit()}
              />
            </View>
            {error || notice ? (
              <Notice
                title={error || notice}
                tone={error ? "danger" : "warning"}
              />
            ) : null}
            {!connected && (
              <Notice title="当前离线" message="请联网后连接工作区。" />
            )}
            <View style={styles.securityTip}>
              <Feather name="lock" size={15} color={colors.muted} />
              <Text style={layout.small}>
                配对码 5 分钟有效，仅可使用一次。
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: "center", padding: 24 },
  sheet: { gap: 23, maxWidth: 440 },
  intro: { gap: 9 },
  fieldLabel: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  input: {
    minHeight: 54,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.canvas,
    paddingHorizontal: 13,
    paddingVertical: 10,
    color: colors.ink,
    fontSize: 19,
    letterSpacing: 1,
  },
  securityTip: { flexDirection: "row", alignItems: "center", gap: 8 },
});
