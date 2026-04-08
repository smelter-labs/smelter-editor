import React, { useRef } from "react";
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
  const { columns, rows, resolution, setGridConfig } = useLayoutStore();
  const minColSize = Math.round(resolution.width / 100);
  const maxColSize = Math.round(resolution.width / 10);
  const minRowSize = Math.round(resolution.height / 100);
  const maxRowSize = Math.round(resolution.height / 10);

  const holdIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const startHold = (callback: () => void) => {
    callback(); // Immediate first call on press
    holdIntervalRef.current = setInterval(callback, 50);
  };

  const stopHold = () => {
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  };

  const handleColsDecrement = () => {
    startHold(() => setGridConfig(Math.max(minColSize, columns - 1), rows));
  };

  const handleColsIncrement = () => {
    startHold(() => setGridConfig(Math.min(maxColSize, columns + 1), rows));
  };

  const handleRowsDecrement = () => {
    startHold(() => setGridConfig(columns, Math.max(minRowSize, rows - 1)));
  };

  const handleRowsIncrement = () => {
    startHold(() => setGridConfig(columns, Math.min(maxRowSize, rows + 1)));
  };

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
              onPressIn={handleColsDecrement}
              onPressOut={stopHold}
            />
            <Text variant="bodyLarge" style={styles.value}>
              {columns}
            </Text>
            <IconButton
              icon="plus"
              mode="contained-tonal"
              size={18}
              onPressIn={handleColsIncrement}
              onPressOut={stopHold}
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
              onPressIn={handleRowsDecrement}
              onPressOut={stopHold}
            />
            <Text variant="bodyLarge" style={styles.value}>
              {rows}
            </Text>
            <IconButton
              icon="plus"
              mode="contained-tonal"
              size={18}
              onPressIn={handleRowsIncrement}
              onPressOut={stopHold}
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
