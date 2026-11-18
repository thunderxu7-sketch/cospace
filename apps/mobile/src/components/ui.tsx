import type { Member, TaskStatus } from "@contracts";
import Feather from "@expo/vector-icons/Feather";
import type { ComponentProps, ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { colors, shortTime, statusLabels } from "./theme";

type IconName = ComponentProps<typeof Feather>["name"];

export function Brand({ large = false }: { large?: boolean }) {
  return (
    <View accessible accessibilityLabel="CoSpace" style={styles.brand}>
      <View style={[styles.brandMark, large && styles.brandMarkLarge]}>
        <Feather name="aperture" size={large ? 25 : 19} color={colors.paper} />
      </View>
      <Text style={[styles.wordmark, large && styles.wordmarkLarge]}>
        CoSpace
      </Text>
    </View>
  );
}

export function Avatar({
  user,
  large = false,
}: {
  user: Member;
  large?: boolean;
}) {
  return (
    <View style={[styles.avatar, large && styles.avatarLarge]}>
      <Text style={[styles.avatarText, large && styles.avatarTextLarge]}>
        {user.name.slice(-2)}
      </Text>
    </View>
  );
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  testID?: string;
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  tone?: "primary" | "outline" | "danger";
  style?: StyleProp<ViewStyle>;
};

export function Button({
  label,
  onPress,
  testID,
  icon,
  disabled,
  busy,
  tone = "primary",
  style,
}: ButtonProps) {
  const color =
    tone === "primary"
      ? colors.paper
      : tone === "danger"
        ? colors.red
        : colors.primary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy || false, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === "primary" ? styles.primaryButton : styles.outlineButton,
        (disabled || busy) && styles.dimmed,
        pressed && styles.pressed,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={color} />
      ) : (
        icon && <Feather name={icon} color={color} size={17} />
      )}
      <Text style={[styles.buttonLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function ScreenState({
  icon,
  title,
  message,
  loading = false,
  action,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  loading?: boolean;
  action?: ReactNode;
}) {
  return (
    <View style={styles.state} accessibilityLiveRegion="polite">
      <View style={styles.stateIcon}>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          icon && <Feather name={icon} color={colors.primary} size={24} />
        )}
      </View>
      <Text style={styles.stateTitle}>{title}</Text>
      {message ? <Text style={styles.stateMessage}>{message}</Text> : null}
      {action}
    </View>
  );
}

export function Notice({
  title,
  message,
  testID,
  tone = "warning",
}: {
  title: string;
  message?: string;
  testID?: string;
  tone?: "warning" | "danger" | "success";
}) {
  const background =
    tone === "danger"
      ? colors.redWash
      : tone === "success"
        ? colors.greenWash
        : colors.amberWash;
  const color =
    tone === "danger"
      ? colors.red
      : tone === "success"
        ? colors.primaryDark
        : colors.brown;
  return (
    <View
      testID={testID}
      accessibilityLiveRegion="polite"
      style={[styles.notice, { backgroundColor: background }]}
    >
      <Feather
        name={tone === "success" ? "check-circle" : "info"}
        size={16}
        color={color}
      />
      <View style={styles.grow}>
        <Text style={[styles.noticeTitle, { color }]}>{title}</Text>
        {message ? (
          <Text style={[styles.noticeMessage, { color }]}>{message}</Text>
        ) : null}
      </View>
    </View>
  );
}

export function ConnectionNotice({
  connected,
  updatedAt,
}: {
  connected: boolean;
  updatedAt: number;
}) {
  if (connected) return null;
  return (
    <Notice
      title="当前离线"
      message={
        updatedAt
          ? `显示 ${shortTime(updatedAt)} 的记录，联网后可提交操作。`
          : "请联网以加载工作区。"
      }
    />
  );
}

export function StatusPill({ status }: { status: TaskStatus }) {
  const backgroundColor =
    status === "done"
      ? colors.greenWash
      : status === "doing"
        ? colors.blueWash
        : colors.canvas;
  const color =
    status === "done"
      ? colors.primaryDark
      : status === "doing"
        ? colors.blue
        : colors.muted;
  return (
    <View style={[styles.statusPill, { backgroundColor }]}>
      <Text style={[styles.statusLabel, { color }]}>
        {statusLabels[status]}
      </Text>
    </View>
  );
}

export function RowCard({
  title,
  description,
  icon,
  trailing,
  testID,
  onPress,
}: {
  title: string;
  description: string;
  icon: IconName;
  trailing?: ReactNode;
  testID: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.rowCard,
        pressed && styles.rowCardPressed,
      ]}
    >
      <View style={styles.rowIcon}>
        <Feather name={icon} size={19} color={colors.primary} />
      </View>
      <View style={styles.grow}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDescription}>{description}</Text>
      </View>
      {trailing}
      <Feather name="chevron-right" size={17} color={colors.muted} />
    </Pressable>
  );
}

export const layout = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  centered: { flex: 1, justifyContent: "center" },
  wide: { width: "100%", maxWidth: 600, alignSelf: "center" },
  body: { paddingHorizontal: 20, paddingVertical: 22, gap: 16 },
  card: {
    padding: 18,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 18,
    backgroundColor: colors.paper,
    gap: 10,
  },
  heading: { color: colors.ink, fontSize: 32, fontWeight: "700" },
  section: { color: colors.ink, fontSize: 18, fontWeight: "700" },
  bodyText: { color: colors.muted, fontSize: 15, lineHeight: 23 },
  small: { color: colors.muted, fontSize: 13, lineHeight: 19 },
});

const styles = StyleSheet.create({
  brand: { flexDirection: "row", alignItems: "center", gap: 9 },
  brandMark: {
    alignItems: "center",
    justifyContent: "center",
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: colors.primary,
  },
  brandMarkLarge: { width: 46, height: 46, borderRadius: 14 },
  wordmark: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.6,
  },
  wordmarkLarge: { fontSize: 28 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.greenWash,
  },
  avatarLarge: { width: 60, height: 60, borderRadius: 21 },
  avatarText: { fontSize: 13, fontWeight: "700", color: colors.primary },
  avatarTextLarge: { fontSize: 19 },
  button: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderWidth: 1,
    borderRadius: 14,
    gap: 8,
  },
  buttonLabel: {
    flexShrink: 1,
    textAlign: "center",
    fontSize: 15,
    fontWeight: "700",
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  outlineButton: { backgroundColor: colors.paper, borderColor: colors.line },
  dimmed: { opacity: 0.58 },
  pressed: { opacity: 0.8 },
  state: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 35,
  },
  stateIcon: {
    width: 50,
    height: 50,
    borderRadius: 18,
    backgroundColor: colors.greenWash,
    alignItems: "center",
    justifyContent: "center",
  },
  stateTitle: {
    color: colors.ink,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "700",
  },
  stateMessage: {
    color: colors.muted,
    textAlign: "center",
    lineHeight: 21,
    fontSize: 14,
  },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    borderRadius: 13,
    padding: 12,
  },
  noticeTitle: { fontSize: 14, fontWeight: "700" },
  noticeMessage: { fontSize: 13, marginTop: 4, lineHeight: 20 },
  grow: { flex: 1, minWidth: 0 },
  statusPill: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    maxWidth: "40%",
  },
  statusLabel: { fontSize: 12, fontWeight: "700" },
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.paper,
    borderRadius: 17,
    borderColor: colors.line,
    borderWidth: 1,
    padding: 13,
    minHeight: 74,
  },
  rowCardPressed: { backgroundColor: colors.greenWash },
  rowIcon: {
    borderRadius: 12,
    width: 39,
    height: 39,
    backgroundColor: colors.greenWash,
    justifyContent: "center",
    alignItems: "center",
  },
  rowTitle: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  rowDescription: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4,
    lineHeight: 17,
  },
});
