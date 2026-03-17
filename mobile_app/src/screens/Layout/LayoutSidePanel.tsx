import React from "react";
import { View, StyleSheet } from "react-native";
import { Text, useTheme } from "react-native-paper";
import { SidePanel } from "../../components/shared/SidePanel";

interface LayoutSidePanelProps {
  isVisible: boolean;
  itemId: string | null;
  onClose: () => void;
}

/**
 * Side panel shown when a grid item is tapped.
 * Currently a placeholder — will display input source details.
 */
export function LayoutSidePanel({
  isVisible,
  itemId,
  onClose,
}: LayoutSidePanelProps) {
  const theme = useTheme();

  return (
    <SidePanel isVisible={isVisible} side="right" onClose={onClose}>
      <View style={styles.content}>
        <Text variant="titleMedium">Input Details</Text>
        {itemId && (
          <Text
            variant="bodySmall"
            style={{ color: theme.colors.onSurfaceVariant }}
          >
            Source: {itemId}
          </Text>
        )}
        <Text
          variant="bodyMedium"
          style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}
        >
          Detailed input source controls will appear here.
        </Text>
      </View>
    </SidePanel>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 24,
    gap: 12,
  },
});
