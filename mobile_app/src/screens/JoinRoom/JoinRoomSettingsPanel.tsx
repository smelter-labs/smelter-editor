import React from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { Surface, Switch, Text, useTheme } from "react-native-paper";
import { useSettingsStore } from "../../store";

interface Props {
  isVisible: boolean;
  onClose: () => void;
}

export function JoinRoomSettingsPanel({ isVisible, onClose }: Props) {
  const theme = useTheme();
  const arrowNavigation = useSettingsStore((s) => s.arrowNavigation);
  const setArrowNavigation = useSettingsStore((s) => s.setArrowNavigation);

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable onPress={() => {}}>
          <Surface style={styles.sheet} elevation={4}>
            <Text variant="titleMedium" style={styles.title}>
              Settings
            </Text>

            <View style={styles.switchRow}>
              <Text variant="bodyMedium">Arrow navigation</Text>
              <Switch
                value={arrowNavigation}
                onValueChange={setArrowNavigation}
              />
            </View>
          </Surface>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  sheet: {
    borderRadius: 16,
    padding: 24,
    width: 300,
    gap: 16,
  },
  title: {
    marginBottom: 4,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
