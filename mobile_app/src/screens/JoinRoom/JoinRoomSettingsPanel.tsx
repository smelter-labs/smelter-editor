import React from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import {
  Button,
  IconButton,
  Surface,
  Switch,
  Text,
  useTheme,
} from "react-native-paper";
import { useNavigation } from "@react-navigation/native";
import { useSettingsStore } from "../../store";
import { SCREEN_NAMES } from "../../navigation/navigationTypes";
import type { RootNavigationProp } from "../../navigation/navigationTypes";

const GRID_FACTOR_MIN = 10;
const GRID_FACTOR_MAX = 100;
const GRID_FACTOR_STEP = 5;

interface Props {
  isVisible: boolean;
  onClose: () => void;
}

export function JoinRoomSettingsPanel({ isVisible, onClose }: Props) {
  const theme = useTheme();
  const navigation = useNavigation<RootNavigationProp>();
  const arrowNavigation = useSettingsStore((s) => s.arrowNavigation);
  const setArrowNavigation = useSettingsStore((s) => s.setArrowNavigation);
  const gridFactor = useSettingsStore((s) => s.gridFactor);
  const setGridFactor = useSettingsStore((s) => s.setGridFactor);

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

            <View style={styles.stepperSection}>
              <Text variant="bodyMedium">Grid factor</Text>
              <View style={styles.stepper}>
                <IconButton
                  icon="minus"
                  mode="contained-tonal"
                  size={16}
                  disabled={gridFactor <= GRID_FACTOR_MIN}
                  onPress={() =>
                    setGridFactor(
                      Math.max(GRID_FACTOR_MIN, gridFactor - GRID_FACTOR_STEP),
                    )
                  }
                />
                <Text variant="bodyLarge" style={styles.stepperValue}>
                  {gridFactor}
                </Text>
                <IconButton
                  icon="plus"
                  mode="contained-tonal"
                  size={16}
                  disabled={gridFactor >= GRID_FACTOR_MAX}
                  onPress={() =>
                    setGridFactor(
                      Math.min(GRID_FACTOR_MAX, gridFactor + GRID_FACTOR_STEP),
                    )
                  }
                />
              </View>
              <Text
                variant="bodySmall"
                style={{ color: theme.colors.onSurfaceVariant }}
              >
                Lower = finer grid. Takes effect on next join.
              </Text>
            </View>

            <Button
              mode="text"
              icon="help-circle-outline"
              onPress={() => {
                onClose();
                navigation.navigate(SCREEN_NAMES.HELP);
              }}
              style={styles.helpButton}
            >
              How does this app work?
            </Button>
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
  stepperSection: {
    gap: 4,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
  },
  stepperValue: {
    fontWeight: "600",
    minWidth: 36,
    textAlign: "center",
  },
  helpButton: {
    alignSelf: "flex-start",
    marginLeft: -8,
    marginBottom: -8,
  },
});
