import React from "react";
import { View, StyleSheet } from "react-native";
import { Button, IconButton, Switch, Text, useTheme } from "react-native-paper";
import { SidePanel } from "../../components/shared/SidePanel";
import { useInputsStore } from "../../store/inputsStore";
import type { SortMode, SortAxis, SortDirection } from "../../types/input";
import { appColors } from "../../theme/paperTheme";

interface InputsSettingsPanelProps {
  isVisible: boolean;
  side: "left" | "right";
  onClose: () => void;
}

const SORT_MODES: { value: SortMode; label: string }[] = [
  { value: "prominence", label: "By Prominence" },
  { value: "timeline", label: "By Timeline" },
  { value: "manual", label: "Manual" },
];

/**
 * Settings panel for the Inputs screen.
 * Controls grid column count, sort mode, axis, direction, and removal confirmation.
 */
export function InputsSettingsPanel({
  isVisible,
  side,
  onClose,
}: InputsSettingsPanelProps) {
  const theme = useTheme();
  const {
    gridColumns,
    sortConfig,
    confirmRemoval,
    setGridColumns,
    setSortConfig,
    setConfirmRemoval,
  } = useInputsStore();

  return (
    <SidePanel isVisible={isVisible} side={side} width={340} onClose={onClose}>
      <View style={styles.content}>
        <Text variant="titleMedium" style={styles.title}>
          Input Settings
        </Text>

        {/* Grid columns */}
        <View style={styles.section}>
          <Text
            variant="labelSmall"
            style={[
              styles.sectionLabel,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            GRID COLUMNS
          </Text>
          <View style={styles.controls}>
            <IconButton
              icon="minus"
              mode="contained-tonal"
              size={18}
              onPress={() => setGridColumns(Math.max(1, gridColumns - 1))}
            />
            <Text variant="bodyLarge" style={styles.value}>
              {gridColumns}
            </Text>
            <IconButton
              icon="plus"
              mode="contained-tonal"
              size={18}
              onPress={() => setGridColumns(gridColumns + 1)}
            />
          </View>
        </View>

        {/* Sort mode */}
        <View style={styles.section}>
          <Text
            variant="labelSmall"
            style={[
              styles.sectionLabel,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            SORT MODE
          </Text>
          <View style={styles.optionsList}>
            {SORT_MODES.map(({ value, label }) => (
              <Button
                key={value}
                mode="contained-tonal"
                compact
                buttonColor={
                  sortConfig.mode === value
                    ? theme.colors.primary
                    : appColors.slate
                }
                textColor="#ffffff"
                onPress={() => setSortConfig({ mode: value })}
                style={styles.optionButton}
                labelStyle={styles.optionLabel}
              >
                {label}
              </Button>
            ))}
          </View>
        </View>

        {/* Sort direction */}
        <View style={styles.section}>
          <Text
            variant="labelSmall"
            style={[
              styles.sectionLabel,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            SORT DIRECTION
          </Text>
          <View style={styles.row}>
            <Button
              mode="contained-tonal"
              compact
              buttonColor={
                sortConfig.direction === "asc"
                  ? theme.colors.primary
                  : appColors.slate
              }
              textColor="#ffffff"
              onPress={() => setSortConfig({ direction: "asc" })}
              style={styles.flexButton}
              labelStyle={styles.optionLabel}
            >
              Ascending
            </Button>
            <Button
              mode="contained-tonal"
              compact
              buttonColor={
                sortConfig.direction === "desc"
                  ? theme.colors.primary
                  : appColors.slate
              }
              textColor="#ffffff"
              onPress={() => setSortConfig({ direction: "desc" })}
              style={styles.flexButton}
              labelStyle={styles.optionLabel}
            >
              Descending
            </Button>
          </View>
        </View>

        {/* Sort axis */}
        <View style={styles.section}>
          <Text
            variant="labelSmall"
            style={[
              styles.sectionLabel,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            SORT AXIS
          </Text>
          <View style={styles.row}>
            <Button
              mode="contained-tonal"
              compact
              buttonColor={
                sortConfig.axis === "row"
                  ? theme.colors.primary
                  : appColors.slate
              }
              textColor="#ffffff"
              onPress={() => setSortConfig({ axis: "row" })}
              style={styles.flexButton}
              labelStyle={styles.optionLabel}
            >
              Row first
            </Button>
            <Button
              mode="contained-tonal"
              compact
              buttonColor={
                sortConfig.axis === "col"
                  ? theme.colors.primary
                  : appColors.slate
              }
              textColor="#ffffff"
              onPress={() => setSortConfig({ axis: "col" })}
              style={styles.flexButton}
              labelStyle={styles.optionLabel}
            >
              Column first
            </Button>
          </View>
        </View>

        {/* Confirm removal toggle */}
        <View style={styles.switchRow}>
          <Text
            variant="labelSmall"
            style={[
              styles.sectionLabel,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            CONFIRM ON REMOVE
          </Text>
          <Switch value={confirmRemoval} onValueChange={setConfirmRemoval} />
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
    marginBottom: 4,
  },
  section: {
    gap: 8,
  },
  sectionLabel: {
    letterSpacing: 1,
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
  optionsList: {
    gap: 6,
  },
  optionButton: {
    borderRadius: 6,
  },
  optionLabel: {
    fontSize: 13,
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  flexButton: {
    flex: 1,
    borderRadius: 6,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
});
