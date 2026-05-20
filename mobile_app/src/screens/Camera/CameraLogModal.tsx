import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  Button,
  IconButton,
  Surface,
  Text,
  useTheme,
} from "react-native-paper";
import {
  useLogStore,
  type LogEntry,
  type LogLevel,
} from "../../store/logStore";

interface Props {
  visible: boolean;
  onClose: () => void;
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  log: "#e5e7eb",
  info: "#93c5fd",
  warn: "#fbbf24",
  error: "#f87171",
  debug: "#c4b5fd",
};

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function getLineCount(message: string): number {
  return message.split(/\r\n|\r|\n/).length;
}

function LogRow({ entry }: { entry: LogEntry }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const lineCount = useMemo(() => getLineCount(entry.message), [entry.message]);
  const collapsible = lineCount > 3;
  const color = LEVEL_COLORS[entry.level];

  return (
    <Pressable
      onPress={() => collapsible && setExpanded((value) => !value)}
      style={({ pressed }) => [
        styles.row,
        {
          borderLeftColor: color,
          backgroundColor: theme.colors.surfaceVariant,
          opacity: pressed ? 0.94 : 1,
        },
      ]}
    >
      <View style={styles.rowHeader}>
        <Text
          style={[styles.timestamp, { color: theme.colors.onSurfaceVariant }]}
        >
          {formatTimestamp(entry.timestamp)}
        </Text>
        <Text style={[styles.level, { color }]}>
          [{entry.level.toUpperCase()}]
        </Text>
      </View>
      <Text
        selectable
        style={[styles.message, { color }]}
        numberOfLines={collapsible && !expanded ? 3 : undefined}
      >
        {entry.message}
      </Text>
      {collapsible && (
        <Text
          style={[styles.toggleHint, { color: theme.colors.onSurfaceVariant }]}
        >
          {expanded ? "Tap to collapse" : "Tap to expand"}
        </Text>
      )}
    </Pressable>
  );
}

export function CameraLogModal({ visible, onClose }: Props) {
  const theme = useTheme();
  const entries = useLogStore((state) => state.entries);
  const clear = useLogStore((state) => state.clear);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
      transparent
    >
      <View style={styles.backdrop}>
        <Surface
          style={[styles.sheet, { backgroundColor: theme.colors.surface }]}
          elevation={4}
        >
          <View style={styles.header}>
            <View>
              <Text variant="titleMedium">Logs</Text>
              <Text
                variant="bodySmall"
                style={{ color: theme.colors.onSurfaceVariant }}
              >
                Console output captured in-app
              </Text>
            </View>
            <View style={styles.headerActions}>
              <Button mode="text" onPress={clear}>
                Clear
              </Button>
              <IconButton icon="close" size={20} onPress={onClose} />
            </View>
          </View>

          <ScrollView
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {entries.length > 0 ? (
              entries.map((entry) => <LogRow key={entry.id} entry={entry} />)
            ) : (
              <Text style={{ color: theme.colors.onSurfaceVariant }}>
                No logs captured yet.
              </Text>
            )}
          </ScrollView>
        </Surface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    padding: 16,
    justifyContent: "center",
  },
  sheet: {
    borderRadius: 20,
    padding: 16,
    maxHeight: "90%",
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  list: {
    gap: 10,
    paddingBottom: 4,
  },
  row: {
    borderLeftWidth: 4,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  timestamp: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  level: {
    fontSize: 12,
    fontWeight: "700",
  },
  message: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: "monospace",
  },
  toggleHint: {
    fontSize: 11,
  },
});
