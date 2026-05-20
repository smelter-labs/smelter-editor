import React from "react";
import { StyleSheet, View } from "react-native";
import { Switch, Text, useTheme } from "react-native-paper";
import { SidePanel } from "./SidePanel";
import { useSettingsStore } from "../../store/settingsStore";

interface Props {
  isVisible: boolean;
  side: "left" | "right";
  onClose: () => void;
  title?: string;
  /** Screen-specific settings rendered below the shared ones */
  children?: React.ReactNode;
}

/**
 * Shared settings panel used by every main screen.
 * Always contains the arrow navigation toggle.
 * Pass screen-specific controls as `children`.
 */
export function SharedSettingsPanel({
  isVisible,
  side,
  onClose,
  title = "Settings",
  children,
}: Props) {
  const theme = useTheme();
  const arrowNavigation = useSettingsStore((s) => s.arrowNavigation);
  const setArrowNavigation = useSettingsStore((s) => s.setArrowNavigation);

  return (
    <SidePanel isVisible={isVisible} side={side} onClose={onClose}>
      <View style={styles.content}>
        <Text variant="titleMedium" style={styles.title}>
          {title}
        </Text>

        {children && <View style={styles.screenSection}>{children}</View>}

        <View
          style={[
            styles.divider,
            { borderTopColor: theme.colors.outlineVariant },
          ]}
        />

        <View style={styles.row}>
          <Text
            variant="bodyMedium"
            style={{ color: theme.colors.onSurfaceVariant }}
          >
            Arrow navigation
          </Text>
          <Switch value={arrowNavigation} onValueChange={setArrowNavigation} />
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
  screenSection: {
    gap: 20,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
