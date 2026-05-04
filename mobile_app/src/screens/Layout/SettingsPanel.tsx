import React, { useEffect, useRef } from "react";
import { View, StyleSheet } from "react-native";
import { IconButton, Text, useTheme } from "react-native-paper";
import { SharedSettingsPanel } from "../../components/shared/SharedSettingsPanel";
import { useLayoutStore } from "../../store/layoutStore";

interface SettingsPanelProps {
  isVisible: boolean;
  side: "left" | "right";
  onClose: () => void;
}

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

  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopHold = () => {
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  };

  const startHold = (callback: () => void) => {
    stopHold();
    callback();
    holdIntervalRef.current = setInterval(callback, 50);
  };

  useEffect(() => stopHold, []);

  const handleColsDecrement = () => {
    startHold(() => {
      const {
        columns: c,
        rows: r,
        resolution: res,
        setGridConfig: set,
      } = useLayoutStore.getState();
      set(Math.max(Math.round(res.width / 100), c - 2), r);
    });
  };

  const handleColsIncrement = () => {
    startHold(() => {
      const {
        columns: c,
        rows: r,
        resolution: res,
        setGridConfig: set,
      } = useLayoutStore.getState();
      set(Math.min(Math.round(res.width / 10), c + 2), r);
    });
  };

  const handleRowsDecrement = () => {
    startHold(() => {
      const {
        columns: c,
        rows: r,
        resolution: res,
        setGridConfig: set,
      } = useLayoutStore.getState();
      set(c, Math.max(Math.round(res.height / 100), r - 2));
    });
  };

  const handleRowsIncrement = () => {
    startHold(() => {
      const {
        columns: c,
        rows: r,
        resolution: res,
        setGridConfig: set,
      } = useLayoutStore.getState();
      set(c, Math.min(Math.round(res.height / 10), r + 2));
    });
  };

  return (
    <SharedSettingsPanel
      isVisible={isVisible}
      side={side}
      onClose={onClose}
      title="Layout Settings"
    >
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
            disabled={columns <= minColSize}
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
            disabled={columns >= maxColSize}
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
            disabled={rows <= minRowSize}
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
            disabled={rows >= maxRowSize}
            onPressIn={handleRowsIncrement}
            onPressOut={stopHold}
          />
        </View>
      </View>
    </SharedSettingsPanel>
  );
}

const styles = StyleSheet.create({
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
