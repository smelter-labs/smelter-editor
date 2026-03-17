import React from "react";
import { View, StyleSheet } from "react-native";
import { Text, useTheme } from "react-native-paper";
import { SidePanel } from "../../components/shared/SidePanel";
import { getPanelSide } from "../../utils/gridUtils";

interface InputSidePanelProps {
  isVisible: boolean;
  cardId: string | null;
  cardIndex: number;
  totalColumns: number;
  onClose: () => void;
}

/**
 * Detail panel for a tapped input card.
 * Opens on the OPPOSITE side from the tapped card to keep it visible.
 */
export function InputSidePanel({
  isVisible,
  cardId,
  cardIndex,
  totalColumns,
  onClose,
}: InputSidePanelProps) {
  const theme = useTheme();
  const side = getPanelSide(cardIndex, totalColumns);

  return (
    <SidePanel isVisible={isVisible} side={side} onClose={onClose}>
      <View style={styles.content}>
        <Text variant="titleMedium">Input Details</Text>
        {cardId && (
          <Text
            variant="bodySmall"
            style={{ color: theme.colors.onSurfaceVariant }}
          >
            ID: {cardId}
          </Text>
        )}
        <Text
          variant="bodyMedium"
          style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}
        >
          Detailed controls and metadata will appear here.
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
