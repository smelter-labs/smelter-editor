import React from "react";
import { View, StyleSheet } from "react-native";
import { IconButton, Text, useTheme } from "react-native-paper";
import { SidePanel } from "../../components/shared/SidePanel";
import { useLayoutStore } from "../../store/layoutStore";

interface SettingsPanelProps {
  isVisible: boolean;
  side: "left" | "right";
  onClose: () => void;
}

/**
 * Settings panel for the Layout screen.
 * Controls grid column and row count.
 */
export function SettingsPanel({
  isVisible,
  side,
  onClose,
}: SettingsPanelProps) {
  const theme = useTheme();
  const { columns, rows, setGridConfig } = useLayoutStore();

  return (
    <SidePanel isVisible={isVisible} side={side} onClose={onClose}>
      <View style={styles.content}>
        <Text variant="titleMedium" style={styles.title}>
          Layout Settings
        </Text>

        <View style={styles.row}>
          <Text
            variant="bodyMedium"
            style={{ color: theme.colors.onSurfaceVariant }}
          >
            Columns
          </Text>
          <View style={styles.controls}>
            <IconButton
              icon="minus"
              mode="contained-tonal"
              size={18}
              onPress={() => setGridConfig(Math.max(1, columns - 1), rows)}
            />
            <Text variant="bodyLarge" style={styles.value}>
              {columns}
            </Text>
            <IconButton
              icon="plus"
              mode="contained-tonal"
              size={18}
              onPress={() => setGridConfig(columns + 1, rows)}
            />
          </View>
        </View>

        <View style={styles.row}>
          <Text
            variant="bodyMedium"
            style={{ color: theme.colors.onSurfaceVariant }}
          >
            Rows
          </Text>
          <View style={styles.controls}>
            <IconButton
              icon="minus"
              mode="contained-tonal"
              size={18}
              onPress={() => setGridConfig(columns, Math.max(1, rows - 1))}
            />
            <Text variant="bodyLarge" style={styles.value}>
              {rows}
            </Text>
            <IconButton
              icon="plus"
              mode="contained-tonal"
              size={18}
              onPress={() => setGridConfig(columns, rows + 1)}
            />
          </View>
        </View>
      </View>
    </SidePanel>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 24,
    gap: 20,
  },
  title: {
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  value: {
    fontWeight: "600",
    minWidth: 24,
    textAlign: "center",
  },
});
